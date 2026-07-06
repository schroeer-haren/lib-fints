import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	buildSepaCollectiveTransferMessage,
	buildSepaDirectDebitMessage,
	buildSepaTransferMessage,
} from '../sepa.js';

// Validates the generated SEPA pain messages against the official ISO 20022 XSD
// schemas (bundled under ./schema). Uses the system `xmllint`; if it is not
// installed the suite is skipped rather than failing (e.g. minimal CI images).
const SCHEMA_DIR = fileURLToPath(new URL('./schema', import.meta.url));
const urn = (v: string) => `urn:iso:std:iso:20022:tech:xsd:${v}`;

function hasXmllint(): boolean {
	try {
		return spawnSync('xmllint', ['--version']).status === 0;
	} catch {
		return false;
	}
}

function validate(xml: string, schema: string): { ok: boolean; output: string } {
	const dir = mkdtempSync(join(tmpdir(), 'sepa-xsd-'));
	const file = join(dir, 'msg.xml');
	writeFileSync(file, xml);
	const res = spawnSync('xmllint', [
		'--noout',
		'--schema',
		join(SCHEMA_DIR, schema),
		file,
	]);
	return {
		ok: res.status === 0,
		output: `${res.stdout ?? ''}${res.stderr ?? ''}`,
	};
}

describe.skipIf(!hasXmllint())('SEPA pain messages validate against ISO XSDs', () => {
	it('SEPA credit transfer pain.001.001.03', () => {
		const xml = buildSepaTransferMessage({
			painDescriptor: urn('pain.001.001.03'),
			debtorName: 'Muster GmbH',
			debtorIban: 'DE02120300000000202051',
			debtorBic: 'BYLADEM1001',
			creditorName: 'Max Müller',
			creditorIban: 'DE02100500000054540402',
			creditorBic: 'BELADEBEXXX',
			amount: 12.34,
			purpose: 'Rechnung 1',
			endToEndId: 'E2E-1',
		});
		const r = validate(xml, 'pain.001.001.03.xsd');
		expect(r.ok ? true : r.output).toBe(true);
	});

	it('SEPA credit transfer pain.001.001.09', () => {
		const xml = buildSepaTransferMessage({
			painDescriptor: urn('pain.001.001.09'),
			debtorName: 'Muster GmbH',
			debtorIban: 'DE02120300000000202051',
			debtorBic: 'BYLADEM1001',
			creditorName: 'Max Müller',
			creditorIban: 'DE02100500000054540402',
			amount: 7.5,
			endToEndId: 'E2E-2',
		});
		const r = validate(xml, 'pain.001.001.09.xsd');
		expect(r.ok ? true : r.output).toBe(true);
	});

	it('SEPA collective credit transfer pain.001.001.09', () => {
		const xml = buildSepaCollectiveTransferMessage({
			painDescriptor: urn('pain.001.001.09'),
			debtorName: 'Muster GmbH',
			debtorIban: 'DE02120300000000202051',
			debtorBic: 'BYLADEM1001',
			singleBooking: true,
			payments: [
				{ creditorName: 'Max Müller', creditorIban: 'DE02100500000054540402', creditorBic: 'BELADEBEXXX', amount: 10, purpose: 'A', endToEndId: 'E1' },
				{ creditorName: 'Erika Öl', creditorIban: 'DE02300209000106531065', amount: 5.5, endToEndId: 'E2' },
			],
		});
		const r = validate(xml, 'pain.001.001.09.xsd');
		expect(r.ok ? true : r.output).toBe(true);
	});

	it('SEPA direct debit pain.008.001.02', () => {
		const xml = buildSepaDirectDebitMessage({
			painDescriptor: urn('pain.008.001.02'),
			creditorName: 'Muster GmbH',
			creditorIban: 'DE02120300000000202051',
			creditorBic: 'BYLADEM1001',
			creditorId: 'DE98ZZZ09999999999',
			sequenceType: 'OOFF',
			localInstrument: 'CORE',
			requestedCollectionDate: '2026-07-15',
			singleBooking: true,
			payments: [
				{ debtorName: 'Max Mustermann', debtorIban: 'DE02100500000054540402', debtorBic: 'BELADEBEXXX', amount: 49.99, purpose: 'Rechnung', endToEndId: 'E1', mandateId: 'M-1', mandateSignatureDate: '2026-06-01' },
			],
		});
		const r = validate(xml, 'pain.008.001.02.xsd');
		expect(r.ok ? true : r.output).toBe(true);
	});

	it('SEPA collective direct debit pain.008.001.08 (BICFI)', () => {
		const xml = buildSepaDirectDebitMessage({
			painDescriptor: urn('pain.008.001.08'),
			creditorName: 'Muster GmbH',
			creditorIban: 'DE02120300000000202051',
			creditorBic: 'BYLADEM1001',
			creditorId: 'DE98ZZZ09999999999',
			sequenceType: 'RCUR',
			localInstrument: 'B2B',
			requestedCollectionDate: '2026-07-15',
			singleBooking: false,
			payments: [
				{ debtorName: 'Max Mustermann', debtorIban: 'DE02100500000054540402', debtorBic: 'BELADEBEXXX', amount: 49.99, purpose: 'Rechnung', endToEndId: 'E1', mandateId: 'M-1', mandateSignatureDate: '2026-06-01' },
				{ debtorName: 'Erika Öl', debtorIban: 'DE02300209000106531065', amount: 5, endToEndId: 'E2', mandateId: 'M-2', mandateSignatureDate: '2025-01-01' },
			],
		});
		const r = validate(xml, 'pain.008.001.08.xsd');
		expect(r.ok ? true : r.output).toBe(true);
	});
});
