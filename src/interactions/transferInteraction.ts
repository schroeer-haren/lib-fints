import type { FinTSConfig } from '../config.js';
import type { Message } from '../message.js';
import type { Segment } from '../segment.js';
import { HKCCS, type HKCCSSegment } from '../segments/HKCCS.js';
import { HKIPZ } from '../segments/HKIPZ.js';
import { HIVPP, type HIVPPSegment } from '../segments/HIVPP.js';
import { HKVPA, type HKVPASegment } from '../segments/HKVPA.js';
import { HKVPP, type HKVPPSegment } from '../segments/HKVPP.js';
import { type ClientResponse, CustomerOrderInteraction } from './customerInteraction.js';

export type VopInfo = {
	result?: string;
	closeMatchName?: string;
	recipientIban?: string;
	otherIdentification?: string;
	naReason?: string;
	vopId?: string;
	manualAuthorizationNotice?: string;
	// Async polling: the check is not done yet; poll again with these.
	pollingId?: string;
	waitForSeconds?: number;
	aufsetzpunkt?: string;
};

export interface TransferResponse extends ClientResponse {
	vop?: VopInfo;
	// The exact pain.001 message used, so the approval step can re-send it verbatim
	// (the bank rejects a differing order: "Auftrag weicht vom Ursprungsauftrag ab").
	painMessage?: string;
}

const DEFAULT_VOP_REPORT = 'urn:iso:std:iso:20022:tech:xsd:pain.002.001.14';

export type TransferParams = {
	accountNumber: string;
	painMessage: string;
	painDescriptor: string;
	instant: boolean;
	vopReportDescriptor?: string;
	// When set, this is the approval step: send HKVPA (with vopId) with the transfer.
	vopId?: string;
};

// Extracts the VoP result / polling info from a response's HIVPP segment and the
// 3040 "more information" continuation mark (Aufsetzpunkt) in the bank answers.
function parseVop(message: Message): VopInfo | undefined {
	const hivpp = message.findSegment<HIVPPSegment>(HIVPP.Id);
	if (!hivpp) return undefined;
	const cont = message.getBankAnswers().find((a) => a.code === 3040);

	// The result may come as the simple single result (EVPE) or as a pain.002
	// payment status report (XML) whose <GrpSts>/<TxSts> carries the code.
	let result = hivpp.vopSingleResult?.result;
	let closeMatchName = hivpp.vopSingleResult?.closeMatchName;
	let report = hivpp.paymentStatusReport;
	// The report XML is UTF-8 but was decoded as latin1; re-decode so names with
	// umlauts read correctly.
	if (report && /<\?xml[^>]*encoding=['"]UTF-8['"][^>]*\?>/i.test(report)) {
		report = Buffer.from(report, 'latin1').toString('utf8');
	}
	if (!result && report) {
		const status = report.match(/<(?:Grp|Tx|Pmt)Sts>\s*([A-Z]{4})\s*<\//);
		if (status) result = status[1];
		if (!closeMatchName) {
			// A close match may include the payee's actual registered name.
			const nm = report.match(/<Nm>([^<]+)<\/Nm>/);
			if (nm) closeMatchName = nm[1];
		}
	}

	return {
		result,
		closeMatchName,
		recipientIban: hivpp.vopSingleResult?.recipientIban,
		otherIdentification: hivpp.vopSingleResult?.otherIdentification,
		naReason: hivpp.vopSingleResult?.naReason,
		vopId: hivpp.vopId,
		manualAuthorizationNotice: hivpp.manualAuthorizationNotice,
		pollingId: hivpp.pollingId,
		waitForSeconds: hivpp.waitForSeconds,
		aufsetzpunkt: cont?.params?.[0],
	};
}

/**
 * Initiates a SEPA transfer (HKCCS/HKIPZ) with a Verification of Payee check
 * (HKVPP), or — on approval — the execution order (HKVPA). The VoP result/polling
 * info (HIVPP) is parsed onto the response.
 */
export class TransferInteraction extends CustomerOrderInteraction {
	constructor(public params: TransferParams) {
		super(
			params.instant ? HKIPZ.Id : HKCCS.Id,
			params.instant ? 'HIIPZ' : 'HICCS',
		);
	}

	createSegments(init: FinTSConfig): Segment[] {
		if (!init.isAccountTransactionSupported(this.params.accountNumber, this.segId)) {
			throw Error(
				`Account ${this.params.accountNumber} does not support business transaction '${this.segId}'`,
			);
		}
		const version = init.getMaxSupportedTransactionVersion(this.segId);
		if (!version) {
			throw Error(`There is no supported version for business transaction '${this.segId}'`);
		}
		const bankAccount = init.getBankAccount(this.params.accountNumber);

		const transferSeg: HKCCSSegment = {
			header: { segId: this.segId, segNr: 0, version },
			account: { iban: bankAccount.iban, bic: bankAccount.bic },
			sepaDescriptor: this.params.painDescriptor,
			sepaPainMessage: this.params.painMessage,
		};

		if (this.params.vopId) {
			// Approval step: execution order (HKVPA) with the transfer.
			const vpa: HKVPASegment = {
				header: { segId: HKVPA.Id, segNr: 0, version: HKVPA.Version },
				vopId: this.params.vopId,
			};
			return [vpa, transferSeg];
		}

		// Initial step: name-check request (HKVPP) with the transfer.
		const vpp: HKVPPSegment = {
			header: { segId: HKVPP.Id, segNr: 0, version: HKVPP.Version },
			supportedReports: [this.params.vopReportDescriptor ?? DEFAULT_VOP_REPORT],
		};
		return [vpp, transferSeg];
	}

	handleClientResponse(message: Message): ClientResponse {
		const clientResponse = super.handleClientResponse(message) as TransferResponse;
		clientResponse.vop = parseVop(message);
		return clientResponse;
	}

	handleResponse(): void {
		// Status and bank messages come from HIRMG/HIRMS in the base response.
	}
}

/**
 * Polls for an asynchronous Verification of Payee result (HKVPP with a pollingId
 * and continuation point), until the bank returns the actual check result.
 */
export class VopPollInteraction extends CustomerOrderInteraction {
	constructor(
		public pollingId: string,
		public aufsetzpunkt: string | undefined,
		public reportDescriptor: string,
	) {
		super(HKVPP.Id, HIVPP.Id);
	}

	createSegments(): Segment[] {
		const vpp: HKVPPSegment = {
			header: { segId: HKVPP.Id, segNr: 0, version: HKVPP.Version },
			supportedReports: [this.reportDescriptor],
			pollingId: this.pollingId,
			aufsetzpunkt: this.aufsetzpunkt,
		};
		return [vpp];
	}

	handleClientResponse(message: Message): ClientResponse {
		const clientResponse = super.handleClientResponse(message) as TransferResponse;
		clientResponse.vop = parseVop(message);
		return clientResponse;
	}

	handleResponse(): void {}
}
