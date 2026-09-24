import { describe, expect, it } from 'vitest';
import { buildSepaCollectiveTransferMessage } from './sepa.js';
import {
	countDirectDebitTx,
	creditTransferTotals,
	parsePain001Namespace,
	parsePain008Namespace,
	sumInstructedAmount,
} from './sepaXml.js';

const XML_02 = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.008.001.02">
 <CstmrDrctDbtInitn><PmtInf>
  <DrctDbtTxInf><InstdAmt Ccy="EUR">10.00</InstdAmt></DrctDbtTxInf>
  <DrctDbtTxInf><InstdAmt Ccy="EUR">5.50</InstdAmt></DrctDbtTxInf>
 </PmtInf></CstmrDrctDbtInitn></Document>`;

const XML_SINGLE_TX = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.008.001.02">
 <CstmrDrctDbtInitn><PmtInf>
  <DrctDbtTxInf><InstdAmt Ccy="EUR">42.00</InstdAmt></DrctDbtTxInf>
 </PmtInf></CstmrDrctDbtInitn></Document>`;

const XML_NO_NAMESPACE = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03">
 <CstmrDrctDbtInitn><PmtInf>
  <DrctDbtTxInf><InstdAmt Ccy="EUR">1.00</InstdAmt></DrctDbtTxInf>
 </PmtInf></CstmrDrctDbtInitn></Document>`;

// Mirrors what the app emits for a run mixing FRST + RCUR sequence types:
// two sibling <PmtInf> blocks under the same <CstmrDrctDbtInitn>.
const XML_MULTI_PMTINF = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.008.001.02">
 <CstmrDrctDbtInitn>
  <PmtInf>
   <DrctDbtTxInf><InstdAmt Ccy="EUR">10.00</InstdAmt></DrctDbtTxInf>
   <DrctDbtTxInf><InstdAmt Ccy="EUR">20.00</InstdAmt></DrctDbtTxInf>
  </PmtInf>
  <PmtInf>
   <DrctDbtTxInf><InstdAmt Ccy="EUR">5.00</InstdAmt></DrctDbtTxInf>
   <DrctDbtTxInf><InstdAmt Ccy="EUR">15.00</InstdAmt></DrctDbtTxInf>
   <DrctDbtTxInf><InstdAmt Ccy="EUR">25.00</InstdAmt></DrctDbtTxInf>
  </PmtInf>
 </CstmrDrctDbtInitn></Document>`;

// 10.10 + 20.20 raw-sums to 30.299999999999997 in JS float arithmetic.
const XML_FLOAT_DRIFT = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.008.001.02">
 <CstmrDrctDbtInitn><PmtInf>
  <DrctDbtTxInf><InstdAmt Ccy="EUR">10.10</InstdAmt></DrctDbtTxInf>
  <DrctDbtTxInf><InstdAmt Ccy="EUR">20.20</InstdAmt></DrctDbtTxInf>
 </PmtInf></CstmrDrctDbtInitn></Document>`;

// Deliberately without any xmlns — note that XML_NO_NAMESPACE above means "no
// pain.008 namespace" and in fact carries a pain.001 one, so it is not usable
// as a negative case for the credit-transfer parser.
const XML_WITHOUT_XMLNS = `<?xml version="1.0" encoding="UTF-8"?>
<Document>
 <CstmrCdtTrfInitn><PmtInf>
  <CdtTrfTxInf><Amt><InstdAmt Ccy="EUR">42.00</InstdAmt></Amt></CdtTrfTxInf>
 </PmtInf></CstmrCdtTrfInitn></Document>`;

const XML_CREDIT_TRANSFER_09 = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09">
 <CstmrCdtTrfInitn><PmtInf>
  <CdtTrfTxInf><Amt><InstdAmt Ccy="EUR">42.00</InstdAmt></Amt></CdtTrfTxInf>
 </PmtInf></CstmrCdtTrfInitn></Document>`;

describe('sepaXml', () => {
	it('reads the pain namespace version', () => {
		expect(parsePain008Namespace(XML_02)).toBe('pain.008.001.02');
	});
	it('counts the direct-debit transactions', () => {
		expect(countDirectDebitTx(XML_02)).toBe(2);
	});
	it('sums the instructed amounts', () => {
		expect(sumInstructedAmount(XML_02)).toEqual({ value: 15.5, currency: 'EUR' });
	});
	it('counts a single direct-debit transaction', () => {
		expect(countDirectDebitTx(XML_SINGLE_TX)).toBe(1);
	});
	it('throws when the pain.008 namespace is missing', () => {
		expect(() => parsePain008Namespace(XML_NO_NAMESPACE)).toThrow(/Kein pain.008-Namespace/);
	});
	it('reads the pain.001 namespace version', () => {
		expect(parsePain001Namespace(XML_CREDIT_TRANSFER_09)).toBe('pain.001.001.09');
	});
	it('throws when the pain.001 namespace is missing', () => {
		expect(() => parsePain001Namespace(XML_WITHOUT_XMLNS)).toThrow(/Kein pain.001-Namespace/);
	});
	it('does not accept a pain.008 document as a credit transfer', () => {
		// Guards against a copy/paste mix-up between the two submit paths.
		expect(() => parsePain001Namespace(XML_02)).toThrow(/Kein pain.001-Namespace/);
	});
	it('aggregates transactions across multiple sibling PmtInf blocks', () => {
		expect(countDirectDebitTx(XML_MULTI_PMTINF)).toBe(5);
		expect(sumInstructedAmount(XML_MULTI_PMTINF)).toEqual({ value: 75, currency: 'EUR' });
	});
	it('rounds away float drift when summing instructed amounts', () => {
		expect(sumInstructedAmount(XML_FLOAT_DRIFT).value).toBe(30.3);
	});
});

const pain001 = (version: string, body: string) =>
	`<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.${version}">
 <CstmrCdtTrfInitn>${body}</CstmrCdtTrfInitn></Document>`;

const cdtTx = (amount: string, ccyAttr = ' Ccy="EUR"') =>
	`<CdtTrfTxInf><Amt><InstdAmt${ccyAttr}>${amount}</InstdAmt></Amt></CdtTrfTxInf>`;

const oneTx = (amount: string) => pain001('03', `<PmtInf>${cdtTx(amount)}</PmtInf>`);

describe('creditTransferTotals', () => {
	it('reads count and control sum from a pain.001.001.03 message', () => {
		const xml = pain001(
			'03',
			`<GrpHdr><NbOfTxs>3</NbOfTxs><CtrlSum>60.60</CtrlSum></GrpHdr>` +
				`<PmtInf><NbOfTxs>3</NbOfTxs><CtrlSum>60.6</CtrlSum>${cdtTx('10.10')}${cdtTx('20.20')}${cdtTx('30.30')}</PmtInf>`,
		);
		expect(creditTransferTotals(xml)).toEqual({
			count: 3,
			value: 60.6,
			currency: 'EUR',
			batchBooking: undefined,
		});
	});

	it('reads count and control sum from a pain.001.001.09 message', () => {
		const xml = pain001('09', `<PmtInf>${cdtTx('0.01')}${cdtTx('1234.99')}</PmtInf>`);
		expect(creditTransferTotals(xml)).toMatchObject({ count: 2, value: 1235, currency: 'EUR' });
	});

	it('handles a single transaction', () => {
		expect(creditTransferTotals(oneTx('42.00'))).toMatchObject({ count: 1, value: 42 });
	});

	it('aggregates transactions across multiple PmtInf blocks', () => {
		const xml = pain001(
			'09',
			`<PmtInf><NbOfTxs>2</NbOfTxs><CtrlSum>30.00</CtrlSum>${cdtTx('10.00')}${cdtTx('20.00')}</PmtInf>` +
				`<PmtInf><NbOfTxs>1</NbOfTxs><CtrlSum>5.55</CtrlSum>${cdtTx('5.55')}</PmtInf>`,
		);
		expect(creditTransferTotals(xml)).toMatchObject({ count: 3, value: 35.55 });
	});

	it('sums in cents without float drift', () => {
		// 0.1 + 0.2 is 0.30000000000000004 in float arithmetic.
		const xml = pain001('03', `<PmtInf>${cdtTx('0.10')}${cdtTx('0.20')}</PmtInf>`);
		expect(creditTransferTotals(xml).value).toBe(0.3);
	});

	it('accepts the amount bounds and plain decimals of DK Anlage 3', () => {
		expect(creditTransferTotals(oneTx('0.01')).value).toBe(0.01);
		expect(creditTransferTotals(oneTx('999999999.99')).value).toBe(999999999.99);
		// xs:decimal: the fraction part is optional.
		expect(creditTransferTotals(oneTx('5')).value).toBe(5);
		expect(creditTransferTotals(oneTx('5.5')).value).toBe(5.5);
		expect(creditTransferTotals(oneTx('0.50')).value).toBe(0.5);
		// Surrounding whitespace inside the element is insignificant.
		expect(creditTransferTotals(oneTx(' 7.00 ')).value).toBe(7);
	});

	it.each([
		'1e3',
		'1.5e2',
		'+5.00',
		'-5.00',
		'0x10',
		'007.50',
		'5.',
		'.5',
		'1,50',
		'1.234',
		'12345678901234567.89',
		'1000000000.00',
		'0',
		'0.00',
		'abc',
		'',
	])('rejects the amount %j', (amount) => {
		expect(() => creditTransferTotals(oneTx(amount))).toThrow(/Ungültiger Betrag in Überweisung 1/);
	});

	it('names the empty and the missing amount', () => {
		expect(() => creditTransferTotals(oneTx(''))).toThrow(/: leer \(erwartet/);
		expect(() =>
			creditTransferTotals(pain001('03', '<PmtInf><CdtTrfTxInf></CdtTrfTxInf></PmtInf>')),
		).toThrow(/Überweisung 1 der pain.001: fehlt/);
		expect(() =>
			creditTransferTotals(pain001('03', `<PmtInf>${cdtTx('1.00')}${cdtTx('x')}</PmtInf>`)),
		).toThrow(/Ungültiger Betrag in Überweisung 2/);
	});

	it('explains an EqvtAmt instead of an InstdAmt', () => {
		const xml = pain001(
			'03',
			'<PmtInf><CdtTrfTxInf><Amt><EqvtAmt><Amt Ccy="USD">1.00</Amt><CcyOfTrf>EUR</CcyOfTrf></EqvtAmt></Amt></CdtTrfTxInf></PmtInf>',
		);
		expect(() => creditTransferTotals(xml)).toThrow(/nutzt EqvtAmt/);
	});

	it.each([
		[' Ccy="CHF"', /Währung "CHF"/],
		[' Ccy="eur"', /Währung "eur"/],
		['', /Währung \(keine\)/],
	])('rejects a non-EUR currency attribute %j', (attr, message) => {
		const xml = pain001('03', `<PmtInf>${cdtTx('1.00', attr)}</PmtInf>`);
		expect(() => creditTransferTotals(xml)).toThrow(message);
	});

	it('rejects mixed currencies at the first non-EUR transaction', () => {
		const xml = pain001('03', `<PmtInf>${cdtTx('1.00')}${cdtTx('1.00', ' Ccy="USD"')}</PmtInf>`);
		expect(() => creditTransferTotals(xml)).toThrow(/Überweisung 2 .*"USD"/);
	});

	it('reads a document whose namespace is bound to a prefix', () => {
		const xml = `<?xml version="1.0" encoding="UTF-8"?>
<p:Document xmlns:p="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09">
 <p:CstmrCdtTrfInitn><p:GrpHdr><p:NbOfTxs>2</p:NbOfTxs><p:CtrlSum>3.00</p:CtrlSum></p:GrpHdr>
 <p:PmtInf><p:BtchBookg>true</p:BtchBookg>
  <p:CdtTrfTxInf><p:Amt><p:InstdAmt Ccy="EUR">1.00</p:InstdAmt></p:Amt></p:CdtTrfTxInf>
  <p:CdtTrfTxInf><p:Amt><p:InstdAmt Ccy="EUR">2.00</p:InstdAmt></p:Amt></p:CdtTrfTxInf>
 </p:PmtInf></p:CstmrCdtTrfInitn></p:Document>`;
		expect(parsePain001Namespace(xml)).toBe('pain.001.001.09');
		expect(creditTransferTotals(xml)).toEqual({
			count: 2,
			value: 3,
			currency: 'EUR',
			batchBooking: true,
		});
	});

	it('agrees with the collective-transfer builder for both versions', () => {
		for (const version of ['03', '09']) {
			const xml = buildSepaCollectiveTransferMessage({
				painDescriptor: `urn:iso:std:iso:20022:tech:xsd:pain.001.001.${version}`,
				debtorName: 'Test User',
				debtorIban: 'DE89370400440532013000',
				singleBooking: false,
				payments: [
					{ creditorName: 'A', creditorIban: 'DE02120300000000202051', amount: 10.1 },
					{ creditorName: 'B', creditorIban: 'DE02500105170137075030', amount: 20.2 },
					{ creditorName: 'C', creditorIban: 'DE02100100100006820101', amount: 0.05 },
				],
			});
			expect(creditTransferTotals(xml)).toEqual({
				count: 3,
				value: 30.35,
				currency: 'EUR',
				batchBooking: true,
			});
		}
	});

	it('reads BtchBookg, including the xs:boolean digits', () => {
		const withBooking = (v: string) =>
			pain001('03', `<PmtInf><BtchBookg>${v}</BtchBookg>${cdtTx('1.00')}</PmtInf>`);
		expect(creditTransferTotals(withBooking('true')).batchBooking).toBe(true);
		expect(creditTransferTotals(withBooking('1')).batchBooking).toBe(true);
		expect(creditTransferTotals(withBooking('false')).batchBooking).toBe(false);
		expect(creditTransferTotals(withBooking('0')).batchBooking).toBe(false);
		expect(() => creditTransferTotals(withBooking('yes'))).toThrow(
			/Ungültiges BtchBookg in PmtInf 1/,
		);
	});

	it('rejects PmtInf blocks that disagree about BtchBookg', () => {
		const xml = pain001(
			'03',
			`<PmtInf><BtchBookg>true</BtchBookg>${cdtTx('1.00')}</PmtInf>` +
				`<PmtInf><BtchBookg>false</BtchBookg>${cdtTx('1.00')}</PmtInf>`,
		);
		expect(() => creditTransferTotals(xml)).toThrow(/widersprechen sich im BtchBookg/);
	});

	it('rejects a pain.008 document', () => {
		expect(() => creditTransferTotals(XML_02)).toThrow(/Kein pain.001-Namespace/);
	});

	it('rejects input that is empty or not XML at all', () => {
		expect(() => creditTransferTotals('')).toThrow(/pain.001 ist leer/);
		expect(() => creditTransferTotals('  ')).toThrow(/pain.001 ist leer/);
		expect(() => creditTransferTotals('not xml')).toThrow(/Kein pain.001-Namespace/);
	});

	it('rejects a message without transactions', () => {
		expect(() => creditTransferTotals(pain001('03', '<PmtInf></PmtInf>'))).toThrow(
			/keine Überweisungen/,
		);
		expect(() => creditTransferTotals(pain001('09', ''))).toThrow(/keine Überweisungen/);
	});

	describe('declared NbOfTxs / CtrlSum', () => {
		const txs = `${cdtTx('10.00')}${cdtTx('5.00')}`;
		const header = (inner: string) =>
			pain001('03', `<GrpHdr>${inner}</GrpHdr><PmtInf>${txs}</PmtInf>`);
		const block = (inner: string) => pain001('03', `<PmtInf>${inner}${txs}</PmtInf>`);

		it('rejects a group header that contradicts the transactions', () => {
			expect(() => creditTransferTotals(header('<NbOfTxs>3</NbOfTxs>'))).toThrow(
				/NbOfTxs im Gruppen-Header \(3\) passt nicht zu den 2/,
			);
			expect(() => creditTransferTotals(header('<CtrlSum>15.01</CtrlSum>'))).toThrow(
				/CtrlSum im Gruppen-Header \(15.01\) passt nicht .*15\.00/,
			);
		});

		it('rejects a PmtInf block that contradicts its own transactions', () => {
			expect(() => creditTransferTotals(block('<NbOfTxs>1</NbOfTxs>'))).toThrow(
				/NbOfTxs in PmtInf 1 \(1\)/,
			);
			expect(() => creditTransferTotals(block('<CtrlSum>14.99</CtrlSum>'))).toThrow(
				/CtrlSum in PmtInf 1 \(14.99\)/,
			);
			const second = pain001(
				'03',
				`<PmtInf>${cdtTx('1.00')}</PmtInf><PmtInf><CtrlSum>1.00</CtrlSum>${txs}</PmtInf>`,
			);
			expect(() => creditTransferTotals(second)).toThrow(/CtrlSum in PmtInf 2 \(1.00\)/);
		});

		it.each([
			'01',
			'0',
			'1e0',
			'+2',
			'2.0',
			' ',
			'1234567890123456',
		])('rejects the NbOfTxs %j', (value) => {
			expect(() => creditTransferTotals(header(`<NbOfTxs>${value}</NbOfTxs>`))).toThrow(
				/Ungültige NbOfTxs im Gruppen-Header/,
			);
			expect(() => creditTransferTotals(block(`<NbOfTxs>${value}</NbOfTxs>`))).toThrow(
				/Ungültige NbOfTxs in PmtInf 1/,
			);
		});

		it.each([
			'1e1',
			'15.000',
			'+15.00',
			'015.00',
			'15.',
			'12345678901234567.89',
			'x',
		])('rejects the CtrlSum %j', (value) => {
			expect(() => creditTransferTotals(header(`<CtrlSum>${value}</CtrlSum>`))).toThrow(
				/Ungültige CtrlSum im Gruppen-Header/,
			);
			expect(() => creditTransferTotals(block(`<CtrlSum>${value}</CtrlSum>`))).toThrow(
				/Ungültige CtrlSum in PmtInf 1/,
			);
		});

		it('names empty header values instead of printing "()"', () => {
			expect(() => creditTransferTotals(header('<NbOfTxs></NbOfTxs>'))).toThrow(
				/Ungültige NbOfTxs im Gruppen-Header: leer\./,
			);
			expect(() => creditTransferTotals(block('<CtrlSum/>'))).toThrow(
				/Ungültige CtrlSum in PmtInf 1: leer\./,
			);
		});

		it('accepts consistent totals at both levels, CtrlSum with or without decimals', () => {
			const xml = pain001(
				'03',
				`<GrpHdr><NbOfTxs>2</NbOfTxs><CtrlSum>15</CtrlSum></GrpHdr>` +
					`<PmtInf><NbOfTxs>2</NbOfTxs><CtrlSum>15.0</CtrlSum>${txs}</PmtInf>`,
			);
			expect(creditTransferTotals(xml)).toMatchObject({ count: 2, value: 15 });
		});
	});

	it('rejects a sum beyond exact number precision', () => {
		// 90073 × 999999999.99 exceeds Number.MAX_SAFE_INTEGER cents.
		const tx = cdtTx('999999999.99');
		const xml = pain001('03', `<PmtInf>${tx.repeat(90073)}</PmtInf>`);
		expect(() => creditTransferTotals(xml)).toThrow(/nicht exakt darstellbar/);
	});
});
