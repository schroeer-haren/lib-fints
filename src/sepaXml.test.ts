import { describe, expect, it } from 'vitest';
import { countDirectDebitTx, parsePain008Namespace, sumInstructedAmount } from './sepaXml.js';

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
	it('aggregates transactions across multiple sibling PmtInf blocks', () => {
		expect(countDirectDebitTx(XML_MULTI_PMTINF)).toBe(5);
		expect(sumInstructedAmount(XML_MULTI_PMTINF)).toEqual({ value: 75, currency: 'EUR' });
	});
	it('rounds away float drift when summing instructed amounts', () => {
		expect(sumInstructedAmount(XML_FLOAT_DRIFT).value).toBe(30.3);
	});
});
