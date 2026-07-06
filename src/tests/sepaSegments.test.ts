import { describe, expect, it } from 'vitest';
import { getSegmentDefinition, registerSegments } from '../segments/registry.js';

registerSegments();

const base = {
	account: { iban: 'DE02120300000000202051', bic: 'BYLADEM1001' },
	sumAmount: { value: 0.02, currency: 'EUR' },
	sepaDescriptor: 'urn:iso:std:iso:20022:tech:xsd:pain.001.001.09',
	sepaPainMessage: '<xml/>',
};

function encode(segId: string, extra: Record<string, unknown> = {}): string {
	const def = getSegmentDefinition(segId)!;
	return def.encode({ ...base, ...extra, header: { segId, segNr: 3, version: 1 } });
}

describe('SEPA transfer/debit segment layouts', () => {
	// Regression: HKIPM (instant collective) has NO "Einzelbuchung gewünscht"
	// (jn) element — unlike HKCCM. Emitting it shifts the binary pain by one
	// field and the bank rejects with 9130 "kein Binärfeld gefunden".
	it('HKIPM has no Einzelbuchung field; binary follows the descriptor', () => {
		const wire = encode('HKIPM');
		expect(wire).toBe(
			"HKIPM:3:1+DE02120300000000202051:BYLADEM1001+0,02:EUR+urn?:iso?:std?:iso?:20022?:tech?:xsd?:pain.001.001.09+@6@<xml/>'",
		);
		// No stray "+J+" (the Einzelbuchung flag) between Summenfeld and descriptor.
		expect(wire).not.toMatch(/EUR\+[JN]\+urn/);
	});

	it('HKCCM keeps the Einzelbuchung (jn) field before the descriptor', () => {
		const wire = encode('HKCCM', { requestSingleBooking: true });
		expect(wire).toMatch(/EUR\+J\+urn/);
	});

	// HKIPZ (instant single) has no Summenfeld at all.
	it('HKIPZ has no Summenfeld', () => {
		const wire = getSegmentDefinition('HKIPZ')!.encode({
			account: base.account,
			sepaDescriptor: base.sepaDescriptor,
			sepaPainMessage: base.sepaPainMessage,
			header: { segId: 'HKIPZ', segNr: 3, version: 1 },
		});
		expect(wire).not.toMatch(/0,02:EUR/);
	});
});
