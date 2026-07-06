import { AlphaNumeric } from '../dataElements/AlphaNumeric.js';
import { Binary } from '../dataElements/Binary.js';
import { YesNo } from '../dataElements/YesNo.js';
import {
	type InternationalAccount,
	InternationalAccountGroup,
} from '../dataGroups/InternationalAccount.js';
import { type Money, MoneyGroup } from '../dataGroups/Money.js';
import type { Segment } from '../segment.js';
import { SegmentDefinition } from '../segmentDefinition.js';

export type HKDMESegment = Segment & {
	account: InternationalAccount;
	// Total of all single direct debits in the batch (Summenfeld).
	sumAmount: Money;
	// "Einzelbuchung gewünscht": J = book each collection separately, N = one
	// collective (Sammel) credit on the statement.
	requestSingleBooking: boolean;
	sepaDescriptor: string;
	sepaPainMessage: string;
};

/**
 * SEPA collective (batch) direct debit — Sammellastschrift einreichen. One order
 * carries a pain.008 with multiple debtors and is authorised with a single TAN.
 */
export class HKDME extends SegmentDefinition {
	static Id = 'HKDME';
	static Version = 1;
	constructor() {
		super(HKDME.Id);
	}
	version = HKDME.Version;
	elements = [
		new InternationalAccountGroup('account', 1, 1),
		new MoneyGroup('sumAmount', 1, 1),
		new YesNo('requestSingleBooking', 1, 1),
		new AlphaNumeric('sepaDescriptor', 1, 1, 256),
		new Binary('sepaPainMessage', 1, 1),
	];
}
