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

export type HKIPMSegment = Segment & {
	account: InternationalAccount;
	// Total of all single transfers in the batch (Summenfeld).
	sumAmount: Money;
	// "Einzelbuchung gewünscht": J = book each transfer separately, N = one
	// collective (Sammel) booking on the statement.
	requestSingleBooking: boolean;
	sepaDescriptor: string;
	sepaPainMessage: string;
};

/**
 * SEPA instant collective (batch) credit transfer — Echtzeit-Sammelüberweisung.
 * Same structure as HKCCM but executed as instant payments (SEPA-IP).
 */
export class HKIPM extends SegmentDefinition {
	static Id = 'HKIPM';
	static Version = 1;
	constructor() {
		super(HKIPM.Id);
	}
	version = HKIPM.Version;
	elements = [
		new InternationalAccountGroup('account', 1, 1),
		new MoneyGroup('sumAmount', 1, 1),
		new YesNo('requestSingleBooking', 1, 1),
		new AlphaNumeric('sepaDescriptor', 1, 1, 256),
		new Binary('sepaPainMessage', 1, 1),
	];
}
