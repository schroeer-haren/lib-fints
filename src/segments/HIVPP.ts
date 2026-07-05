import { AlphaNumeric } from '../dataElements/AlphaNumeric.js';
import { Binary } from '../dataElements/Binary.js';
import { Dat } from '../dataElements/Dat.js';
import { Numeric } from '../dataElements/Numeric.js';
import { Time } from '../dataElements/Time.js';
import { DataGroup } from '../dataGroups/DataGroup.js';
import type { Segment } from '../segment.js';
import { SegmentDefinition } from '../segmentDefinition.js';

// Result of the Verification of Payee check for a single transaction.
export type VopSingleResult = {
	recipientIban?: string;
	infoIban?: string;
	closeMatchName?: string;
	otherIdentification?: string;
	// RCVC = full match, RVMC = close match, RVNM = no match, RVNA = not available, PDNG = pending
	result?: string;
	naReason?: string;
};

export type HIVPPSegment = Segment & {
	vopId?: string;
	pollingId?: string;
	paymentStatusReportDescriptor?: string;
	paymentStatusReport?: string;
	vopSingleResult?: VopSingleResult;
	manualAuthorizationNotice?: string;
	waitForSeconds?: number;
};

/**
 * Verification of Payee — check result (Namensabgleich Prüfergebnis)
 */
export class HIVPP extends SegmentDefinition {
	static Id = 'HIVPP';
	static Version = 1;
	constructor() {
		super(HIVPP.Id);
	}
	version = HIVPP.Version;
	elements = [
		new Binary('vopId', 0, 1),
		new DataGroup('vopIdValidUntil', [new Dat('date', 1, 1), new Time('time', 1, 1)], 0, 1),
		new Binary('pollingId', 0, 1),
		new AlphaNumeric('paymentStatusReportDescriptor', 0, 1, 256),
		new Binary('paymentStatusReport', 0, 1),
		new DataGroup(
			'vopSingleResult',
			[
				new AlphaNumeric('recipientIban', 0, 1, 34),
				new AlphaNumeric('infoIban', 0, 1, 140),
				new AlphaNumeric('closeMatchName', 0, 1, 140),
				new AlphaNumeric('otherIdentification', 0, 1, 256),
				new AlphaNumeric('result', 0, 1, 4),
				new AlphaNumeric('naReason', 0, 1, 256),
			],
			0,
			1,
		),
		new AlphaNumeric('manualAuthorizationNotice', 0, 1, 65535),
		new Numeric('waitForSeconds', 0, 1, 1),
	];
}
