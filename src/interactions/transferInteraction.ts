import type { FinTSConfig } from '../config.js';
import type { Message } from '../message.js';
import type { Segment } from '../segment.js';
import { HKCCS, type HKCCSSegment } from '../segments/HKCCS.js';
import { HKIPZ } from '../segments/HKIPZ.js';
import { HIVPP, type HIVPPSegment, type VopSingleResult } from '../segments/HIVPP.js';
import { HKVPA, type HKVPASegment } from '../segments/HKVPA.js';
import { HKVPP, type HKVPPSegment } from '../segments/HKVPP.js';
import { type ClientResponse, CustomerOrderInteraction } from './customerInteraction.js';

export interface TransferResponse extends ClientResponse {
	// Verification of Payee result (present when the bank performed a name check).
	vop?: VopSingleResult & { vopId?: string; manualAuthorizationNotice?: string };
}

// Default pain.002 payment status report format advertised in the check request.
const DEFAULT_VOP_REPORT = 'urn:iso:std:iso:20022:tech:xsd:pain.002.001.14';

export type TransferParams = {
	accountNumber: string;
	painMessage: string;
	painDescriptor: string;
	instant: boolean;
	vopReportDescriptor?: string;
};

/**
 * Initiates a SEPA single credit transfer (HKCCS) or an instant transfer (HKIPZ).
 * Includes the Verification of Payee check segment (HKVPP), or — on approval — the
 * execution segment (HKVPA). The VoP result (HIVPP) is parsed onto the response.
 */
export class TransferInteraction extends CustomerOrderInteraction {
	// When set (after the user approved a VoP result), the TAN continuation also
	// carries the HKVPA execution order with this vopId.
	approvalVopId?: string;

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

		// Request a name check (HKVPP) alongside the transfer.
		const vpp: HKVPPSegment = {
			header: { segId: HKVPP.Id, segNr: 0, version: HKVPP.Version },
			supportedReports: {
				psrd: [this.params.vopReportDescriptor ?? DEFAULT_VOP_REPORT],
			},
		};
		return [vpp, transferSeg];
	}

	// After VoP approval, the TAN continuation also carries the HKVPA order.
	getTanContinuationSegments(): Segment[] {
		if (!this.approvalVopId) return [];
		const vpa: HKVPASegment = {
			header: { segId: HKVPA.Id, segNr: 0, version: HKVPA.Version },
			vopId: this.approvalVopId,
		};
		return [vpa];
	}

	// Parse the HIVPP result even when the response also requires a TAN.
	handleClientResponse(message: Message): ClientResponse {
		const clientResponse = super.handleClientResponse(message) as TransferResponse;
		const hivpp = message.findSegment<HIVPPSegment>(HIVPP.Id);
		if (hivpp) {
			clientResponse.vop = {
				...(hivpp.vopSingleResult ?? {}),
				vopId: hivpp.vopId,
				manualAuthorizationNotice: hivpp.manualAuthorizationNotice,
			};
		}
		return clientResponse;
	}

	handleResponse(): void {
		// Status and bank messages come from HIRMG/HIRMS in the base response.
	}
}
