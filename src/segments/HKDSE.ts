import { AlphaNumeric } from '../dataElements/AlphaNumeric.js';
import { Binary } from '../dataElements/Binary.js';
import {
	type InternationalAccount,
	InternationalAccountGroup,
} from '../dataGroups/InternationalAccount.js';
import type { Segment } from '../segment.js';
import { SegmentDefinition } from '../segmentDefinition.js';

export type HKDSESegment = Segment & {
	account: InternationalAccount;
	sepaDescriptor: string;
	sepaPainMessage: string;
};

/**
 * SEPA single direct debit (Einzellastschrift einreichen). The account holder is
 * the creditor pulling money from a debtor; the pain.008 carries the mandate and
 * the creditor scheme id (Gläubiger-ID).
 */
export class HKDSE extends SegmentDefinition {
	static Id = 'HKDSE';
	static Version = 1;
	constructor() {
		super(HKDSE.Id);
	}
	version = HKDSE.Version;
	elements = [
		new InternationalAccountGroup('account', 1, 1),
		new AlphaNumeric('sepaDescriptor', 1, 1, 256),
		new Binary('sepaPainMessage', 1, 1),
	];
}
