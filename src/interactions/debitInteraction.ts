import type { FinTSConfig } from '../config.js';
import type { Money } from '../dataGroups/Money.js';
import type { Segment } from '../segment.js';
import { HKDME, type HKDMESegment } from '../segments/HKDME.js';
import { HKDSE, type HKDSESegment } from '../segments/HKDSE.js';
import { CustomerOrderInteraction } from './customerInteraction.js';

export type DirectDebitParams = {
	accountNumber: string;
	painMessage: string;
	painDescriptor: string;
};

/**
 * Submits a SEPA single direct debit (HKDSE) carrying a pain.008. Authorised with
 * a single strong authentication (one TAN).
 */
export class DirectDebitInteraction extends CustomerOrderInteraction {
	constructor(public params: DirectDebitParams) {
		super(HKDSE.Id, 'HIDSE');
	}

	createSegments(init: FinTSConfig): Segment[] {
		if (!init.isAccountTransactionSupported(this.params.accountNumber, HKDSE.Id)) {
			throw Error(`Account ${this.params.accountNumber} does not support '${HKDSE.Id}'`);
		}
		const version = init.getMaxSupportedTransactionVersion(HKDSE.Id);
		if (!version) {
			throw Error(`There is no supported version for business transaction '${HKDSE.Id}'`);
		}
		const bankAccount = init.getBankAccount(this.params.accountNumber);
		const seg: HKDSESegment = {
			header: { segId: HKDSE.Id, segNr: 0, version },
			account: { iban: bankAccount.iban, bic: bankAccount.bic },
			sepaDescriptor: this.params.painDescriptor,
			sepaPainMessage: this.params.painMessage,
		};
		return [seg];
	}

	handleResponse(): void {}
}

export type CollectiveDirectDebitParams = {
	accountNumber: string;
	painMessage: string;
	painDescriptor: string;
	// Total of all collections (Summenfeld).
	sumAmount: Money;
	// N = each collection booked individually, one collective (Sammel) credit else.
	requestSingleBooking: boolean;
};

/**
 * Submits a SEPA collective (batch) direct debit (HKDME) carrying a pain.008 with
 * multiple debtors. The whole batch is authorised with a single TAN.
 */
export class CollectiveDirectDebitInteraction extends CustomerOrderInteraction {
	constructor(public params: CollectiveDirectDebitParams) {
		super(HKDME.Id, 'HIDME');
	}

	createSegments(init: FinTSConfig): Segment[] {
		if (!init.isAccountTransactionSupported(this.params.accountNumber, HKDME.Id)) {
			throw Error(`Account ${this.params.accountNumber} does not support '${HKDME.Id}'`);
		}
		const version = init.getMaxSupportedTransactionVersion(HKDME.Id);
		if (!version) {
			throw Error(`There is no supported version for business transaction '${HKDME.Id}'`);
		}
		const bankAccount = init.getBankAccount(this.params.accountNumber);
		const seg: HKDMESegment = {
			header: { segId: HKDME.Id, segNr: 0, version },
			account: { iban: bankAccount.iban, bic: bankAccount.bic },
			sumAmount: this.params.sumAmount,
			requestSingleBooking: this.params.requestSingleBooking,
			sepaDescriptor: this.params.painDescriptor,
			sepaPainMessage: this.params.painMessage,
		};
		return [seg];
	}

	handleResponse(): void {}
}
