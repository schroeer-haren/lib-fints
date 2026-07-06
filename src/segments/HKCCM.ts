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

export type HKCCMSegment = Segment & {
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
 * SEPA collective (batch) credit transfer — Sammelüberweisung. One order carries
 * a pain.001 with multiple CdtTrfTxInf and is authorised with a single SCA/TAN.
 */
export class HKCCM extends SegmentDefinition {
	static Id = 'HKCCM';
	static Version = 1;
	constructor() {
		super(HKCCM.Id);
	}
	version = HKCCM.Version;
	elements = [
		new InternationalAccountGroup('account', 1, 1),
		new MoneyGroup('sumAmount', 1, 1),
		new YesNo('requestSingleBooking', 1, 1),
		new AlphaNumeric('sepaDescriptor', 1, 1, 256),
		new Binary('sepaPainMessage', 1, 1),
	];
}
