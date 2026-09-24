import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

function parseDoc(xml: string): Record<string, unknown> {
	return parser.parse(xml) as Record<string, unknown>;
}

/**
 * The namespace URN of the root <Document>, whether it is declared as the
 * default namespace (`<Document xmlns="…">`) or bound to a prefix
 * (`<p:Document xmlns:p="…">`). Empty if there is none.
 */
function documentNamespace(xml: string): string {
	const doc = parseDoc(xml);
	for (const [key, value] of Object.entries(doc)) {
		const m = key.match(/^(?:([^:]+):)?Document$/);
		if (!m || !value || typeof value !== 'object') continue;
		const attrs = value as Record<string, unknown>;
		const ns = attrs[m[1] ? `@_xmlns:${m[1]}` : '@_xmlns'];
		return typeof ns === 'string' ? ns : '';
	}
	return '';
}

/** Extract e.g. "pain.001.001.09" from the <Document> namespace URN (default or prefixed). */
export function parsePain001Namespace(xml: string): string {
	const ns = documentNamespace(xml);
	const m = ns.match(/pain\.001\.001\.\d{2}/);
	if (!m) throw new Error(`Kein pain.001-Namespace in der XML gefunden (xmlns="${ns}").`);
	return m[0];
}

/** Extract e.g. "pain.008.001.02" from the <Document> xmlns URN. */
export function parsePain008Namespace(xml: string): string {
	const doc = parseDoc(xml) as { Document?: { '@_xmlns'?: string } };
	const ns = doc.Document?.['@_xmlns'] ?? '';
	const m = ns.match(/pain\.008\.001\.\d{2}/);
	if (!m) throw new Error(`Kein pain.008-Namespace in der XML gefunden (xmlns="${ns}").`);
	return m[0];
}

type TxNode = { InstdAmt?: { '#text'?: number | string; '@_Ccy'?: string } };

function txNodes(xml: string): TxNode[] {
	const doc = parseDoc(xml) as {
		Document?: { CstmrDrctDbtInitn?: { PmtInf?: unknown } };
	};
	const pmtInf = doc.Document?.CstmrDrctDbtInitn?.PmtInf;
	const blocks = Array.isArray(pmtInf) ? pmtInf : pmtInf ? [pmtInf] : [];
	const txs: TxNode[] = [];
	for (const b of blocks as Array<{ DrctDbtTxInf?: TxNode | TxNode[] }>) {
		const t = b.DrctDbtTxInf;
		if (Array.isArray(t)) txs.push(...t);
		else if (t) txs.push(t);
	}
	return txs;
}

export function countDirectDebitTx(xml: string): number {
	return txNodes(xml).length;
}

export function sumInstructedAmount(xml: string): { value: number; currency: string } {
	const txs = txNodes(xml);
	let value = 0;
	let currency = 'EUR';
	for (const t of txs) {
		value += Number(t.InstdAmt?.['#text'] ?? 0);
		currency = t.InstdAmt?.['@_Ccy'] ?? currency;
	}
	return { value: Math.round(value * 100) / 100, currency };
}

/** The totals of a pain.001 credit transfer, as announced on a FinTS collective order. */
export type CreditTransferTotals = {
	/** Number of <CdtTrfTxInf> across all <PmtInf> blocks. */
	count: number;
	/** Sum of all <InstdAmt>, exact to the cent. */
	value: number;
	/** Always "EUR": a SEPA pain.001 carries euro amounts only. */
	currency: 'EUR';
	/**
	 * The document's <BtchBookg> (true = one collective booking), or undefined
	 * when no <PmtInf> carries the element.
	 */
	batchBooking: boolean | undefined;
};

// A dedicated parser: values stay raw strings (parseTagValue: false) so an
// amount is validated exactly as written — the shared parser would turn "1e3",
// "0x10" or "007.50" into numbers first and lose digits beyond 2^53. Namespace
// prefixes are dropped so `<p:Document xmlns:p="…">` reads like the default form.
const rawParser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: '@_',
	parseTagValue: false,
	parseAttributeValue: false,
	trimValues: true,
	removeNSPrefix: true,
});

// Formats per DK "Spezifikation der Datenformate" (DFÜ-Abkommen Anlage 3,
// V 3.5, Teil 2):
// - InstdAmt is ActiveOrHistoricCurrencyAndAmountSEPA — at most 11 digits of
//   which 2 fraction digits, 0.01 … 999999999.99, decimal separator a point
//   (§2.3.3 "Dezimal-Typen", S. 164; InstdAmt, S. 35). Like xs:decimal, the
//   fraction part is optional ("5" is a valid 5.00); what is rejected is
//   anything that is not a plain decimal: signs, exponents, hex, leading zeros,
//   a dangling or leading point.
// - CtrlSum is DecimalNumber (18 digits) with "maximal zwei Nachkommastellen"
//   (GrpHdr S. 19, PmtInf S. 25) — hence at most 16 integer digits.
// - NbOfTxs is Max15NumericText, [0-9]{1,15} (§2.3 S. 163); a count here is
//   positive and written without leading zeros.
const AMOUNT = /^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/;
const CONTROL_SUM = /^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/;
const TX_COUNT = /^[1-9]\d{0,14}$/;

/** A validated decimal string as exact integer cents. */
function cents(text: string): bigint {
	const [int, frac = ''] = text.split('.');
	return BigInt(int) * 100n + BigInt(frac.padEnd(2, '0'));
}

function formatCents(value: bigint): string {
	const abs = value.toString().padStart(3, '0');
	return `${abs.slice(0, -2)}.${abs.slice(-2)}`;
}

/** The text content of an element: '' when empty, undefined when missing. */
function elementText(node: unknown): string | undefined {
	if (node === undefined || node === null) return undefined;
	if (typeof node === 'object') {
		const text = (node as Record<string, unknown>)['#text'];
		return text === undefined ? '' : String(text);
	}
	return String(node);
}

function shown(text: string): string {
	return text === '' ? 'leer' : `"${text}"`;
}

function asArray<T>(node: T | T[] | undefined): T[] {
	if (Array.isArray(node)) return node;
	// An empty element parses to '' and is kept: an empty <CdtTrfTxInf/> is a
	// transaction without an amount, not "no transaction".
	return node === undefined || node === null ? [] : [node];
}

type Rec = Record<string, unknown>;

function field(node: unknown, key: string): unknown {
	return node && typeof node === 'object' ? (node as Rec)[key] : undefined;
}

/**
 * Checks an optional NbOfTxs/CtrlSum pair of a group header or <PmtInf> against
 * the transactions it describes. Both are mandatory per DK Anlage 3, but only
 * validated when present so that minimal documents keep working.
 */
function checkDeclaredTotals(node: unknown, where: string, count: number, sum: bigint): void {
	const nbOfTxs = elementText(field(node, 'NbOfTxs'));
	if (nbOfTxs !== undefined) {
		if (!TX_COUNT.test(nbOfTxs)) {
			throw new Error(`Ungültige NbOfTxs ${where}: ${shown(nbOfTxs)}.`);
		}
		if (Number(nbOfTxs) !== count) {
			throw new Error(
				`NbOfTxs ${where} (${nbOfTxs}) passt nicht zu den ${count} Überweisungen der pain.001.`,
			);
		}
	}
	const ctrlSum = elementText(field(node, 'CtrlSum'));
	if (ctrlSum !== undefined) {
		if (!CONTROL_SUM.test(ctrlSum)) {
			throw new Error(`Ungültige CtrlSum ${where}: ${shown(ctrlSum)}.`);
		}
		if (cents(ctrlSum) !== sum) {
			throw new Error(
				`CtrlSum ${where} (${ctrlSum}) passt nicht zur Summe der Überweisungen (${formatCents(sum)}).`,
			);
		}
	}
}

function parseBatchBooking(raw: string, block: number): boolean {
	if (raw === 'true' || raw === '1') return true;
	if (raw === 'false' || raw === '0') return false;
	throw new Error(`Ungültiges BtchBookg in PmtInf ${block} der pain.001: ${shown(raw)}.`);
}

/**
 * Reads the number of transactions and the control sum of a pain.001 SEPA credit
 * transfer — the values the FinTS collective order (HKCCM/HKIPM) announces in
 * its Summenfeld — plus its BtchBookg. Works for every pain.001.001.xx version
 * (the <CdtTrfTxInf>/<Amt>/<InstdAmt> structure is identical in .03 and .09),
 * with a default or a prefixed namespace.
 *
 * Transactions are aggregated across all <PmtInf> blocks and summed as exact
 * integer cents. Throws a descriptive error when the document is not a
 * pain.001, contains no transactions, has an amount that is not a valid SEPA
 * euro amount (format, 0.01 … 999999999.99, Ccy="EUR"), states a group-header
 * or PmtInf NbOfTxs/CtrlSum that is malformed or contradicts its transactions,
 * or has <PmtInf> blocks with contradicting BtchBookg.
 */
export function creditTransferTotals(xml: string): CreditTransferTotals {
	if (xml.trim() === '') throw new Error('Die pain.001 ist leer.');
	parsePain001Namespace(xml);
	const initn = field(field(rawParser.parse(xml), 'Document'), 'CstmrCdtTrfInitn');
	const blocks = asArray(field(initn, 'PmtInf'));

	let count = 0;
	let sum = 0n;
	let batchBooking: boolean | undefined;
	blocks.forEach((block, b) => {
		const txs = asArray(field(block, 'CdtTrfTxInf'));
		let blockSum = 0n;
		for (const tx of txs) {
			count++;
			const amt = field(tx, 'Amt');
			const instdAmt = field(amt, 'InstdAmt');
			if (instdAmt === undefined && field(amt, 'EqvtAmt') !== undefined) {
				throw new Error(
					`Überweisung ${count} der pain.001 nutzt EqvtAmt; unterstützt wird nur InstdAmt in EUR.`,
				);
			}
			const text = elementText(instdAmt);
			if (text === undefined || !AMOUNT.test(text) || cents(text) < 1n) {
				throw new Error(
					`Ungültiger Betrag in Überweisung ${count} der pain.001: ${text === undefined ? 'fehlt' : shown(text)} ` +
						'(erwartet 0.01 bis 999999999.99 mit Punkt als Dezimaltrenner).',
				);
			}
			const ccy = field(instdAmt, '@_Ccy');
			if (ccy !== 'EUR') {
				throw new Error(
					`Überweisung ${count} der pain.001 hat die Währung ${ccy === undefined ? '(keine)' : `"${String(ccy)}"`}; SEPA erlaubt nur Ccy="EUR".`,
				);
			}
			blockSum += cents(text);
		}
		checkDeclaredTotals(block, `in PmtInf ${b + 1}`, txs.length, blockSum);
		sum += blockSum;

		const rawBooking = elementText(field(block, 'BtchBookg'));
		if (rawBooking !== undefined) {
			const booking = parseBatchBooking(rawBooking, b + 1);
			if (batchBooking !== undefined && booking !== batchBooking) {
				throw new Error('Die PmtInf-Blöcke der pain.001 widersprechen sich im BtchBookg.');
			}
			batchBooking = booking;
		}
	});

	if (count === 0) {
		throw new Error('Die pain.001 enthält keine Überweisungen (CdtTrfTxInf).');
	}
	checkDeclaredTotals(field(initn, 'GrpHdr'), 'im Gruppen-Header', count, sum);
	if (sum > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new Error(
			`Die Summe der pain.001 (${formatCents(sum)}) ist als Zahl nicht exakt darstellbar.`,
		);
	}

	return { count, value: Number(sum) / 100, currency: 'EUR', batchBooking };
}
