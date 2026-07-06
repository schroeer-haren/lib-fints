import type { FinTSConfig } from '../config.js';
import type { Money } from '../dataGroups/Money.js';
import type { Message } from '../message.js';
import type { Segment } from '../segment.js';
import { HIVPP, type HIVPPSegment } from '../segments/HIVPP.js';
import { HKCCM, type HKCCMSegment } from '../segments/HKCCM.js';
import { HKCCS, type HKCCSSegment } from '../segments/HKCCS.js';
import { HKIPM, type HKIPMSegment } from '../segments/HKIPM.js';
import { HKIPZ } from '../segments/HKIPZ.js';
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
	// For a collective (batch) check: how many transactions ended in each status
	// (e.g. { RCVC: 3, RVNM: 1 }), parsed from the pain.002 NbOfTxsPerSts summary.
	statusCounts?: Record<string, number>;
	// Async polling: the check is not done yet; poll again with these.
	pollingId?: string;
	waitForSeconds?: number;
	aufsetzpunkt?: string;
};

// VoP match-result codes ordered by severity (higher = needs more attention).
// Used to pick a single headline result for a batch pain.002 with many statuses.
const VOP_SEVERITY: Record<string, number> = {
	RCVC: 1, // full match
	PDNG: 2,
	PNDG: 2, // pending
	RVMC: 3,
	RVCM: 3, // close match
	RVNA: 4, // not available
	RVNM: 5, // no match
};

// The worst (highest-severity) VoP result across all group/transaction statuses
// in a pain.002. For a single transfer this is simply that one status.
function worstVopResult(report: string): string | undefined {
	const re = /<(?:Grp|Tx|Pmt)Sts>\s*([A-Z]{4})\s*<\//g;
	let worst: string | undefined;
	let worstSev = 0;
	for (const m of report.matchAll(re)) {
		const sev = VOP_SEVERITY[m[1]];
		if (sev && sev > worstSev) {
			worstSev = sev;
			worst = m[1];
		}
	}
	return worst;
}

// Per-status transaction counts from the pain.002 NbOfTxsPerSts summary
// (<DtldNbOfTxs>n</DtldNbOfTxs><DtldSts>CODE</DtldSts>, either element order).
function vopStatusCounts(report: string): Record<string, number> | undefined {
	const counts: Record<string, number> = {};
	const a = /<DtldNbOfTxs>\s*(\d+)\s*<\/DtldNbOfTxs>\s*<DtldSts>\s*([A-Z]{4})\s*<\/DtldSts>/g;
	const b = /<DtldSts>\s*([A-Z]{4})\s*<\/DtldSts>\s*<DtldNbOfTxs>\s*(\d+)\s*<\/DtldNbOfTxs>/g;
	for (const m of report.matchAll(a)) counts[m[2]] = (counts[m[2]] ?? 0) + Number(m[1]);
	for (const m of report.matchAll(b)) counts[m[1]] = (counts[m[1]] ?? 0) + Number(m[2]);
	return Object.keys(counts).length > 0 ? counts : undefined;
}

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
	const closeMatchName = hivpp.vopSingleResult?.closeMatchName;
	let report = hivpp.paymentStatusReport;
	let statusCounts: Record<string, number> | undefined;
	// The report XML is UTF-8 but was decoded as latin1; re-decode so names with
	// umlauts read correctly.
	if (report && /<\?xml[^>]*encoding=['"]UTF-8['"][^>]*\?>/i.test(report)) {
		report = Buffer.from(report, 'latin1').toString('utf8');
	}
	if (report) {
		statusCounts = vopStatusCounts(report);
		if (!result) {
			// For a batch the report holds many statuses — take the worst as the
			// headline. Ignore generic statuses (PART/ACSP) unless nothing else fits.
			const anyStatus = report.match(/<(?:Grp|Tx|Pmt)Sts>\s*([A-Z]{4})\s*<\//);
			result = worstVopResult(report) ?? anyStatus?.[1];
		}
		// Note: this bank does not disclose the payee's actual name in the report,
		// so closeMatchName is left from the EVPE group only (usually empty).
	}

	return {
		result,
		closeMatchName,
		recipientIban: hivpp.vopSingleResult?.recipientIban,
		otherIdentification: hivpp.vopSingleResult?.otherIdentification,
		naReason: hivpp.vopSingleResult?.naReason,
		vopId: hivpp.vopId,
		manualAuthorizationNotice: hivpp.manualAuthorizationNotice,
		statusCounts,
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
		super(params.instant ? HKIPZ.Id : HKCCS.Id, params.instant ? 'HIIPZ' : 'HICCS');
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

export type CollectiveTransferParams = {
	accountNumber: string;
	painMessage: string;
	painDescriptor: string;
	instant: boolean;
	// Total of all payments (Summenfeld).
	sumAmount: Money;
	// N = one collective (Sammel) booking, J = each payment booked individually.
	requestSingleBooking: boolean;
	// When set, the bank offers Verification of Payee: an HKVPP check is sent
	// alongside the order (unless vopId is set, then it's the HKVPA approval).
	vopReportDescriptor?: string;
	// When set, this is the approval step: send HKVPA (with vopId) with the batch.
	vopId?: string;
};

/**
 * Submits a SEPA collective (batch) transfer — HKCCM (or HKIPM for instant) —
 * carrying a pain.001 with multiple payments. The whole batch is authorised with
 * a single strong authentication (one TAN). When the bank offers Verification of
 * Payee, an HKVPP check (or HKVPA approval) is sent together with the order.
 */
export class CollectiveTransferInteraction extends CustomerOrderInteraction {
	constructor(public params: CollectiveTransferParams) {
		super(params.instant ? HKIPM.Id : HKCCM.Id, params.instant ? 'HIIPM' : 'HICCM');
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

		// HKIPM (instant) has no "Einzelbuchung gewünscht" element; only HKCCM does.
		// The individual-vs-collective wish is carried in the pain (BtchBookg) too.
		const seg: HKCCMSegment | HKIPMSegment = this.params.instant
			? {
					header: { segId: this.segId, segNr: 0, version },
					account: { iban: bankAccount.iban, bic: bankAccount.bic },
					sumAmount: this.params.sumAmount,
					sepaDescriptor: this.params.painDescriptor,
					sepaPainMessage: this.params.painMessage,
				}
			: {
					header: { segId: this.segId, segNr: 0, version },
					account: { iban: bankAccount.iban, bic: bankAccount.bic },
					sumAmount: this.params.sumAmount,
					requestSingleBooking: this.params.requestSingleBooking,
					sepaDescriptor: this.params.painDescriptor,
					sepaPainMessage: this.params.painMessage,
				};

		if (this.params.vopId) {
			// Approval step: execution order (HKVPA) with the batch.
			const vpa: HKVPASegment = {
				header: { segId: HKVPA.Id, segNr: 0, version: HKVPA.Version },
				vopId: this.params.vopId,
			};
			return [vpa, seg];
		}

		if (this.params.vopReportDescriptor) {
			// Initial step with name-check: HKVPP request alongside the batch.
			const vpp: HKVPPSegment = {
				header: { segId: HKVPP.Id, segNr: 0, version: HKVPP.Version },
				supportedReports: [this.params.vopReportDescriptor],
			};
			return [vpp, seg];
		}

		// Bank does not offer VoP: submit the batch on its own.
		return [seg];
	}

	handleClientResponse(message: Message): ClientResponse {
		const clientResponse = super.handleClientResponse(message) as TransferResponse;
		clientResponse.vop = parseVop(message);
		return clientResponse;
	}

	handleResponse(): void {}
}
