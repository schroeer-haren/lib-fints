import { TanMediaRequirement, TanProcess } from './codes.js';
import type { FinTSConfig } from './config.js';
import { HttpClient } from './httpClient.js';
import {
	type ClientResponse,
	type CustomerInteraction,
	CustomerOrderInteraction,
} from './interactions/customerInteraction.js';
import { EndDialogInteraction } from './interactions/endDialogInteraction.js';
import { InitDialogInteraction } from './interactions/initDialogInteraction.js';
import { CustomerMessage, CustomerOrderMessage, type Message } from './message.js';
import { PARTED, type PartedSegment } from './partedSegment.js';
import type { Segment, SegmentWithContinuationMark } from './segment.js';
import { decode } from './segment.js';
import { HICAZ } from './segments/HICAZ.js';
import { HIKAZ } from './segments/HIKAZ.js';
import { HKEND } from './segments/HKEND.js';
import { HKTAN, type HKTANSegment } from './segments/HKTAN.js';
import { HNHBK, type HNHBKSegment } from './segments/HNHBK.js';

export class Dialog {
	dialogId: string = '0';
	lastMessageNumber = 0;
	interactions: CustomerInteraction[] = [];
	responses: Map<string, ClientResponse> = new Map();
	currentInteractionIndex = 0;
	isInitialized = false;
	hasEnded = false;
	httpClient: HttpClient;

	constructor(
		public config: FinTSConfig,
		syncSystemId: boolean = false,
	) {
		if (!this.config) {
			throw new Error('configuration must be provided');
		}

		this.httpClient = this.getHttpClient();
		this.interactions.push(new InitDialogInteraction(this.config, syncSystemId));
		this.interactions.push(new EndDialogInteraction());
		this.interactions.forEach((interaction) => {
			interaction.dialog = this;
		});
	}

	get currentInteraction(): CustomerInteraction {
		return this.interactions[this.currentInteractionIndex];
	}

	async start(): Promise<Map<string, ClientResponse>> {
		if (this.isInitialized) {
			throw new Error('dialog has already been initialized');
		}

		if (this.hasEnded) {
			throw Error('cannot start a dialog that has already ended');
		}

		if (this.lastMessageNumber > 0) {
			throw new Error('dialog start can only be called on a new dialog');
		}

		let clientResponse: ClientResponse;

		do {
			const message = this.createCurrentCustomerMessage();
			const responseMessage = await this.httpClient.sendMessage(message);
			await this.handlePartedMessages(message, responseMessage, this.currentInteraction);
			await this.handleStatementContinuation(responseMessage, this.currentInteraction);
			clientResponse = this.currentInteraction.handleClientResponse(responseMessage);
			this.checkEnded(clientResponse);
			this.dialogId = clientResponse.dialogId;
			this.responses.set(this.currentInteraction.segId, clientResponse);

			if (clientResponse.success && !clientResponse.requiresTan) {
				this.currentInteractionIndex++;

				if (this.currentInteractionIndex > 0) {
					this.isInitialized = true;
				}
			}
		} while (
			!this.hasEnded &&
			this.currentInteractionIndex < this.interactions.length &&
			clientResponse.success &&
			!clientResponse.requiresTan
		);

		return this.responses;
	}

	async continue(tanOrderReference: string, tan?: string): Promise<Map<string, ClientResponse>> {
		if (!tanOrderReference) {
			throw Error('tanOrderReference must be provided to continue a customer order with a TAN');
		}

		if (!this.config.selectedTanMethod?.isDecoupled && !tan) {
			throw Error('TAN must be provided for non-decoupled TAN methods');
		}

		if (this.hasEnded) {
			throw Error('cannot continue a customer order when dialog has already ended');
		}

		if (!this.currentInteraction) {
			throw new Error('there is no running customer interaction in this dialog to continue');
		}

		let clientResponse: ClientResponse;

		let isFirstMessage = true;

		do {
			const message = isFirstMessage
				? this.createCurrentTanMessage(tanOrderReference, tan)
				: this.createCurrentCustomerMessage();
			const responseMessage = await this.httpClient.sendMessage(message);
			await this.handlePartedMessages(message, responseMessage, this.currentInteraction);
			await this.handleStatementContinuation(responseMessage, this.currentInteraction);
			clientResponse = this.currentInteraction.handleClientResponse(responseMessage);
			this.checkEnded(clientResponse);
			this.dialogId = clientResponse.dialogId;
			this.responses.set(this.currentInteraction.segId, clientResponse);

			if (clientResponse.success && !clientResponse.requiresTan) {
				this.currentInteractionIndex++;

				if (this.currentInteractionIndex > 0) {
					this.isInitialized = true;
				}
			}

			isFirstMessage = false;
		} while (
			!this.hasEnded &&
			this.currentInteractionIndex < this.interactions.length &&
			clientResponse.success &&
			!clientResponse.requiresTan
		);

		return this.responses;
	}

	addCustomerInteraction(interaction: CustomerInteraction, afterCurrent = false): void {
		if (this.hasEnded) {
			throw Error('cannot queue another customer interaction when dialog has already ended');
		}

		const isCustomerOrder = interaction instanceof CustomerOrderInteraction;

		if (isCustomerOrder && !this.config.isTransactionSupported(interaction.segId)) {
			throw Error(
				`customer order transaction ${interaction.segId} is not supported according to the BPD`,
			);
		}

		interaction.dialog = this;

		if (afterCurrent) {
			this.interactions.splice(this.currentInteractionIndex + 1, 0, interaction);
			return;
		}

		this.interactions.splice(this.interactions.length - 1, 0, interaction);
	}

	private createCurrentCustomerMessage(): CustomerMessage {
		this.lastMessageNumber++;

		const isCustomerOrder = this.currentInteraction instanceof CustomerOrderInteraction;
		const message = isCustomerOrder
			? new CustomerOrderMessage(
					this.currentInteraction.segId,
					this.currentInteraction.responseSegId,
					this.dialogId,
					this.lastMessageNumber,
				)
			: new CustomerMessage(this.dialogId, this.lastMessageNumber);

		const tanMethod = this.config.selectedTanMethod;
		const isScaSupported = tanMethod && tanMethod.version >= 6;
		let isTanMethodNeeded = isScaSupported && this.currentInteraction.segId !== HKEND.Id;

		if (isCustomerOrder) {
			const bankTransaction = this.config.bankingInformation.bpd?.allowedTransactions.find(
				(t) => t.transId === this.currentInteraction.segId,
			);

			isTanMethodNeeded = isTanMethodNeeded && bankTransaction?.tanRequired;
		}

		if (this.config.userId && this.config.pin) {
			message.sign(
				this.config.countryCode,
				this.config.bankId,
				this.config.userId,
				this.config.pin,
				this.config.bankingInformation.systemId,
				isScaSupported ? this.config.tanMethodId : undefined,
			);
		}

		const segments = this.currentInteraction.getSegments(this.config);
		segments.forEach((segment) => {
			message.addSegment(segment);
		});

		if (this.config.userId && this.config.pin && isTanMethodNeeded) {
			const hktan: HKTANSegment = {
				header: { segId: HKTAN.Id, segNr: 0, version: tanMethod?.version ?? 0 },
				tanProcess: TanProcess.Process4,
				segId: this.currentInteraction.segId,
				tanMedia: this.getTanMediaName(),
			};

			message.addSegment(hktan);
		}

		return message;
	}

	private createCurrentTanMessage(tanOrderReference: string, tan?: string): CustomerMessage {
		this.lastMessageNumber++;
		const message = new CustomerMessage(this.dialogId, this.lastMessageNumber);

		if (this.config.userId && this.config.pin) {
			message.sign(
				this.config.countryCode,
				this.config.bankId,
				this.config.userId,
				this.config.pin,
				this.config.bankingInformation?.systemId,
				this.config.tanMethodId,
				tan,
			);
		}

		// Extra order segments for the continuation (e.g. HKVPA for VoP approval),
		// added before the HKTAN.
		for (const segment of this.currentInteraction.getTanContinuationSegments()) {
			message.addSegment(segment);
		}

		if (this.config.userId && this.config.pin && this.config.tanMethodId) {
			const hktan: HKTANSegment = {
				header: { segId: HKTAN.Id, segNr: 0, version: this.config.selectedTanMethod?.version ?? 0 },
				tanProcess: this.config.selectedTanMethod?.isDecoupled
					? TanProcess.Status
					: TanProcess.Process2,
				segId: this.currentInteraction.segId,
				orderRef: tanOrderReference,
				nextTan: false,
				tanMedia: this.getTanMediaName(),
			};

			message.addSegment(hktan);
		}
		return message;
	}

	private getTanMediaName(): string | undefined {
		const requirement =
			this.config.selectedTanMethod?.tanMediaRequirement ?? TanMediaRequirement.NotAllowed;

		if (requirement === TanMediaRequirement.NotAllowed) {
			return undefined;
		}

		if (requirement === TanMediaRequirement.Required) {
			// When a TAN medium is required but none was explicitly selected, send an
			// empty designation instead of a made-up 'default'. Banks reject an unknown
			// device name (e.g. "9955 Die Gerätebezeichnung ist unbekannt"), whereas an
			// empty medium lets the bank use the user's registered device (works for
			// single-device methods such as pushTAN).
			return this.config.tanMediaName ?? '';
		}

		return this.config.tanMediaName;
	}

	private async handlePartedMessages(
		message: CustomerMessage,
		responseMessage: Message,
		interaction: CustomerInteraction,
	) {
		let partedSegment = responseMessage.findSegment<PartedSegment>(PARTED.Id);

		if (partedSegment) {
			while (responseMessage.hasReturnCode(3040)) {
				const answers = responseMessage.getBankAnswers();
				const segmentWithContinuation = message.segments.find(
					(s) => s.header.segId === interaction.segId,
				) as SegmentWithContinuationMark;
				if (!segmentWithContinuation) {
					throw new Error(
						`Response contains segment with further information, but corresponding segment could not be found or is not specified`,
					);
				}

				const answer = answers.find((a) => a.code === 3040);

				if (!answer || !answer.params || answer.params.length === 0) {
					throw new Error(
						'Expected bank answer to contain continuation mark parameters (code 3040)',
					);
				}

				segmentWithContinuation.continuationMark = answer.params[0];
				const hnhbkSegment = message.findSegment<HNHBKSegment>(HNHBK.Id);
				if (!hnhbkSegment) {
					throw new Error('HNHBK segment not found in message');
				}
				hnhbkSegment.msgNr = ++this.lastMessageNumber;
				const nextResponseMessage = await this.httpClient.sendMessage(message);
				const nextPartedSegment = nextResponseMessage.findSegment<PartedSegment>(PARTED.Id);

				if (nextPartedSegment) {
					nextPartedSegment.rawData =
						partedSegment.rawData +
						nextPartedSegment.rawData.slice(nextPartedSegment.rawData.indexOf('+') + 1);
					partedSegment = nextPartedSegment;
				}

				responseMessage = nextResponseMessage;
			}

			const completeSegment = decode(partedSegment.rawData);
			const index = responseMessage.segments.indexOf(partedSegment);
			responseMessage.segments.splice(index, 1, completeSegment);
		}
	}

	/**
	 * Follows the "Aufsetzpunkt" (continuation point, return code 3040) for
	 * account statement orders (HKKAZ/HKCAZ). Many banks cap a single statement
	 * response (e.g. 150 bookings) and signal that more data is available via a
	 * 3040 answer with a continuation mark, WITHOUT splitting the message (so the
	 * PARTED mechanism above does not apply). We re-send the same order within the
	 * SAME dialog (no new strong authentication) and merge the additional booked
	 * (and noted) transactions into the first response segment, until the bank
	 * reports no further continuation. This yields the full history with a single TAN.
	 */
	private async handleStatementContinuation(
		responseMessage: Message,
		interaction: CustomerInteraction,
	) {
		if (!(interaction instanceof CustomerOrderInteraction)) {
			return;
		}
		// Only statement orders carry booked/noted transaction lists to merge.
		const responseSegId = interaction.responseSegId;
		if (responseSegId !== HIKAZ.Id && responseSegId !== HICAZ.Id) {
			return;
		}
		// A split (PARTED) first response is already fully assembled above.
		if (responseMessage.findSegment(PARTED.Id)) {
			return;
		}
		if (!responseMessage.hasReturnCode(3040)) {
			return;
		}

		const accumulator = responseMessage.findSegment<StatementSegment>(responseSegId);
		if (!accumulator) {
			return;
		}

		let latest: Message = responseMessage;

		while (latest.hasReturnCode(3040)) {
			const answer = latest.getBankAnswers().find((a) => a.code === 3040);
			if (!answer || !answer.params || answer.params.length === 0) {
				throw new Error(
					'Expected bank answer to contain continuation mark parameters (code 3040)',
				);
			}

			const continuationMessage = this.createContinuationMessage(interaction, answer.params[0]);
			const nextResponseMessage = await this.httpClient.sendMessage(continuationMessage);
			// The continuation page often arrives as a PARTED (binary-deferred) segment
			// that must be decoded into the real HIKAZ/HICAZ before we can read it.
			let nextSegment = nextResponseMessage.findSegment<StatementSegment>(responseSegId);
			if (!nextSegment) {
				const parted = nextResponseMessage.findSegment<PartedSegment>(PARTED.Id);
				if (parted) {
					const decoded = decode(parted.rawData);
					if (decoded.header.segId === responseSegId) {
						nextSegment = decoded as unknown as StatementSegment;
					}
				}
			}
			if (nextSegment) {
				mergeStatementSegments(accumulator, nextSegment);
			}

			latest = nextResponseMessage;
		}
	}

	/**
	 * Builds a statement order message for an Aufsetzpunkt continuation: the same
	 * order as the normal request (including the HKTAN segment, which the bank
	 * requires per BPD — otherwise it rejects with 9370 "insufficient signatures")
	 * but with the continuation mark set. Because strong authentication was already
	 * completed earlier in this dialog, the bank grants it without a new challenge
	 * (return code 3076). This relies on `currentInteraction` still being the
	 * statement order (the index only advances after a fully successful response).
	 */
	private createContinuationMessage(
		interaction: CustomerOrderInteraction,
		continuationMark: string,
	): CustomerMessage {
		const message = this.createCurrentCustomerMessage();
		const orderSegment = message.segments.find(
			(s) => s.header.segId === interaction.segId,
		) as SegmentWithContinuationMark | undefined;
		if (orderSegment) {
			orderSegment.continuationMark = continuationMark;
		}
		return message;
	}

	private checkEnded(response: ClientResponse) {
		if (
			response.bankAnswers.some((answer) => answer.code === 100) ||
			response.bankAnswers.some((answer) => answer.code === 9000)
		) {
			this.hasEnded = true;
		}
	}

	private getHttpClient(): HttpClient {
		return new HttpClient(this.config.bankingUrl, this.config.debugEnabled);
	}
}

/**
 * Statement response segment (HIKAZ/HICAZ). For MT940 the transaction lists are
 * a single raw string; for CAMT they are arrays of camt message strings.
 */
type StatementSegment = Segment & {
	bookedTransactions?: string | string[];
	notedTransactions?: string | string[];
};

/** Appends the transactions of a continuation page onto the accumulated segment. */
function mergeStatementSegments(accumulator: StatementSegment, next: StatementSegment): void {
	accumulator.bookedTransactions = appendTransactions(
		accumulator.bookedTransactions,
		next.bookedTransactions,
	);
	accumulator.notedTransactions = appendTransactions(
		accumulator.notedTransactions,
		next.notedTransactions,
	);
}

function appendTransactions(
	base: string | string[] | undefined,
	extra: string | string[] | undefined,
): string | string[] | undefined {
	if (extra === undefined) {
		return base;
	}
	if (base === undefined) {
		return Array.isArray(extra) ? [...extra] : extra;
	}
	if (typeof base === 'string' && typeof extra === 'string') {
		return base + extra;
	}
	if (Array.isArray(base) && Array.isArray(extra)) {
		return [...base, ...extra];
	}
	// Mismatched shapes (should not happen for a given format) — keep the base.
	return base;
}
