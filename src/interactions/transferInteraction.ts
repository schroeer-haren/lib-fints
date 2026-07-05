import type { FinTSConfig } from '../config.js';
import type { Message } from '../message.js';
import type { Segment } from '../segment.js';
import { HKCCS, type HKCCSSegment } from '../segments/HKCCS.js';
import { HKIPZ } from '../segments/HKIPZ.js';
import { type ClientResponse, CustomerOrderInteraction } from './customerInteraction.js';

export interface TransferResponse extends ClientResponse {}

export type TransferParams = {
	accountNumber: string;
	painMessage: string;
	painDescriptor: string;
	instant: boolean;
};

/**
 * Initiates a SEPA single credit transfer (HKCCS) or an instant transfer
 * (HKIPZ). Success and bank messages are taken from the base response
 * (HIRMG/HIRMS); no dedicated response segment needs parsing.
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

		const seg: HKCCSSegment = {
			header: { segId: this.segId, segNr: 0, version },
			account: { iban: bankAccount.iban, bic: bankAccount.bic },
			sepaDescriptor: this.params.painDescriptor,
			sepaPainMessage: this.params.painMessage,
		};
		return [seg];
	}

	handleResponse(_response: Message, _clientResponse: TransferResponse): void {
		// Status and bank messages come from HIRMG/HIRMS in the base response.
	}
}
