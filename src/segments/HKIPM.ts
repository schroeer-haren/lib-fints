import { AlphaNumeric } from '../dataElements/AlphaNumeric.js';
import { Binary } from '../dataElements/Binary.js';
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
	sepaDescriptor: string;
	sepaPainMessage: string;
};

/**
 * SEPA instant collective (batch) credit transfer — Echtzeit-Sammelüberweisung.
 *
 * NOTE: unlike HKCCM, the instant collective segment has NO "Einzelbuchung
 * gewünscht" (jn) element — its layout is Konto, Summenfeld, SEPA-Descriptor,
 * pain message. Adding the extra jn field shifts the binary pain message by one
 * position and the bank rejects it ("9130 kein Binärfeld gefunden"). The
 * individual-vs-collective booking wish is carried only in the pain (BtchBookg).
 * (FinTS 3.0 Messages Geschäftsvorfälle 2022-04-15, C.10.3.5.)
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
		new AlphaNumeric('sepaDescriptor', 1, 1, 256),
		new Binary('sepaPainMessage', 1, 1),
	];
}
