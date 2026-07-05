import { AlphaNumeric } from '../dataElements/AlphaNumeric.js';
import { Binary } from '../dataElements/Binary.js';
import { Numeric } from '../dataElements/Numeric.js';
import { DataGroup } from '../dataGroups/DataGroup.js';
import type { Segment } from '../segment.js';
import { SegmentDefinition } from '../segmentDefinition.js';

export type HKVPPSegment = Segment & {
	supportedReports: { psrd: string[] };
	pollingId?: string;
	maxQueries?: number;
	aufsetzpunkt?: string;
};

/**
 * Verification of Payee — check request (Namensabgleich Prüfauftrag)
 */
export class HKVPP extends SegmentDefinition {
	static Id = 'HKVPP';
	static Version = 1;
	constructor() {
		super(HKVPP.Id);
	}
	version = HKVPP.Version;
	elements = [
		new DataGroup('supportedReports', [new AlphaNumeric('psrd', 1, 99, 256)], 1, 1),
		new Binary('pollingId', 0, 1),
		new Numeric('maxQueries', 0, 1, 4),
		new AlphaNumeric('aufsetzpunkt', 0, 1, 35),
	];
}
