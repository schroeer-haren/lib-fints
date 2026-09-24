import { describe, expect, it } from 'vitest';
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

const cdtTx = (amount: string, ccy = 'EUR') =>
	`<CdtTrfTxInf><Amt><InstdAmt Ccy="${ccy}">${amount}</InstdAmt></Amt></CdtTrfTxInf>`;

describe('creditTransferTotals', () => {
	it('reads count and control sum from a pain.001.001.03 message', () => {
		const xml = pain001(
			'03',
			`<GrpHdr><NbOfTxs>3</NbOfTxs><CtrlSum>60.60</CtrlSum></GrpHdr>` +
				`<PmtInf><NbOfTxs>3</NbOfTxs>${cdtTx('10.10')}${cdtTx('20.20')}${cdtTx('30.30')}</PmtInf>`,
		);
		expect(creditTransferTotals(xml)).toEqual({ count: 3, value: 60.6, currency: 'EUR' });
	});

	it('reads count and control sum from a pain.001.001.09 message', () => {
		const xml = pain001('09', `<PmtInf>${cdtTx('0.01')}${cdtTx('1234.99')}</PmtInf>`);
		expect(creditTransferTotals(xml)).toEqual({ count: 2, value: 1235, currency: 'EUR' });
	});

	it('handles a single transaction', () => {
		expect(creditTransferTotals(pain001('03', `<PmtInf>${cdtTx('42.00')}</PmtInf>`))).toEqual({
			count: 1,
			value: 42,
			currency: 'EUR',
		});
	});

	it('aggregates transactions across multiple PmtInf blocks', () => {
		const xml = pain001(
			'09',
			`<PmtInf>${cdtTx('10.00')}${cdtTx('20.00')}</PmtInf><PmtInf>${cdtTx('5.55')}</PmtInf>`,
		);
		expect(creditTransferTotals(xml)).toEqual({ count: 3, value: 35.55, currency: 'EUR' });
	});

	it('sums in cents without float drift', () => {
		// 0.1 + 0.2 is 0.30000000000000004 in float arithmetic.
		const xml = pain001('03', `<PmtInf>${cdtTx('0.10')}${cdtTx('0.20')}</PmtInf>`);
		expect(creditTransferTotals(xml).value).toBe(0.3);
	});

	it('keeps a non-EUR currency', () => {
		const xml = pain001('03', `<PmtInf>${cdtTx('1.00', 'CHF')}</PmtInf>`);
		expect(creditTransferTotals(xml).currency).toBe('CHF');
	});

	it('rejects a pain.008 document', () => {
		expect(() => creditTransferTotals(XML_02)).toThrow(/Kein pain.001-Namespace/);
	});

	it('rejects a document that is not XML at all', () => {
		expect(() => creditTransferTotals('not xml')).toThrow(/Kein pain.001-Namespace/);
	});

	it('rejects a message without transactions', () => {
		expect(() => creditTransferTotals(pain001('03', '<PmtInf></PmtInf>'))).toThrow(
			/keine Überweisungen/,
		);
		expect(() => creditTransferTotals(pain001('09', ''))).toThrow(/keine Überweisungen/);
	});

	it('rejects a missing or malformed amount', () => {
		expect(() =>
			creditTransferTotals(pain001('03', '<PmtInf><CdtTrfTxInf></CdtTrfTxInf></PmtInf>')),
		).toThrow(/Ungültiger Betrag in Überweisung 1/);
		expect(() =>
			creditTransferTotals(pain001('03', `<PmtInf>${cdtTx('1.00')}${cdtTx('abc')}</PmtInf>`)),
		).toThrow(/Ungültiger Betrag in Überweisung 2/);
		expect(() => creditTransferTotals(pain001('03', `<PmtInf>${cdtTx('1.234')}</PmtInf>`))).toThrow(
			/Ungültiger Betrag/,
		);
		expect(() => creditTransferTotals(pain001('03', `<PmtInf>${cdtTx('-5.00')}</PmtInf>`))).toThrow(
			/Ungültiger Betrag/,
		);
	});

	it('rejects mixed currencies', () => {
		const xml = pain001('03', `<PmtInf>${cdtTx('1.00')}${cdtTx('1.00', 'USD')}</PmtInf>`);
		expect(() => creditTransferTotals(xml)).toThrow(/mischt Währungen/);
	});

	it('rejects a group header that contradicts the transactions', () => {
		const tx = `<PmtInf>${cdtTx('10.00')}${cdtTx('5.00')}</PmtInf>`;
		expect(() =>
			creditTransferTotals(pain001('03', `<GrpHdr><NbOfTxs>3</NbOfTxs></GrpHdr>${tx}`)),
		).toThrow(/NbOfTxs im Gruppen-Header \(3\)/);
		expect(() =>
			creditTransferTotals(pain001('03', `<GrpHdr><CtrlSum>15.01</CtrlSum></GrpHdr>${tx}`)),
		).toThrow(/CtrlSum im Gruppen-Header \(15.01\).*15\.00/);
	});
});
