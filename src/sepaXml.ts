import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

function parseDoc(xml: string): Record<string, unknown> {
	return parser.parse(xml) as Record<string, unknown>;
}

/** Extract e.g. "pain.001.001.09" from the <Document> xmlns URN. */
export function parsePain001Namespace(xml: string): string {
	const doc = parseDoc(xml) as { Document?: { '@_xmlns'?: string } };
	const ns = doc.Document?.['@_xmlns'] ?? '';
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

/** The transaction count and control sum of a pain.001 credit transfer. */
export type CreditTransferTotals = {
	count: number;
	value: number; // rounded to cents
	currency: string;
};

/** A pain.001 amount as integer cents, or undefined if it is not a valid amount. */
function toCents(raw: unknown): number | undefined {
	const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
	if (!/^\d+(\.\d{1,2})?$/.test(text)) return undefined;
	return Math.round(Number(text) * 100);
}

function asArray<T>(node: T | T[] | undefined): T[] {
	if (Array.isArray(node)) return node;
	// An empty element parses to '' and is kept: an empty <CdtTrfTxInf/> is a
	// transaction without an amount, not "no transaction".
	return node === undefined || node === null ? [] : [node];
}

type CreditTxNode = {
	Amt?: { InstdAmt?: { '#text'?: number | string; '@_Ccy'?: string } };
};

type GroupHeader = { NbOfTxs?: number | string; CtrlSum?: number | string };

/**
 * Reads the number of transactions and the control sum of a pain.001 SEPA credit
 * transfer — the values the FinTS collective order (HKCCM/HKIPM) announces in
 * its Summenfeld. Works for every pain.001.001.xx version: the <CdtTrfTxInf> /
 * <Amt>/<InstdAmt> structure is identical in .03 and .09.
 *
 * Transactions are aggregated across all <PmtInf> blocks. Amounts are summed in
 * integer cents so the result carries no float drift. Throws a descriptive error
 * when the document is not a pain.001, contains no transactions, has a missing
 * or malformed amount, mixes currencies, or when its own group header
 * (NbOfTxs / CtrlSum) contradicts its transactions.
 */
export function creditTransferTotals(xml: string): CreditTransferTotals {
	parsePain001Namespace(xml);
	const doc = parseDoc(xml) as {
		Document?: {
			CstmrCdtTrfInitn?: {
				GrpHdr?: GroupHeader;
				PmtInf?: { CdtTrfTxInf?: CreditTxNode | CreditTxNode[] } | unknown[];
			};
		};
	};
	const initn = doc.Document?.CstmrCdtTrfInitn;
	const blocks = asArray(initn?.PmtInf) as Array<{
		CdtTrfTxInf?: CreditTxNode | CreditTxNode[];
	}>;
	const txs = blocks.flatMap((b) => asArray(b?.CdtTrfTxInf));
	if (txs.length === 0) {
		throw new Error('Die pain.001 enthält keine Überweisungen (CdtTrfTxInf).');
	}

	let cents = 0;
	let currency: string | undefined;
	txs.forEach((t, i) => {
		const amount = t?.Amt?.InstdAmt;
		const raw = typeof amount === 'object' ? amount['#text'] : amount;
		const txCents = toCents(raw);
		if (txCents === undefined) {
			throw new Error(`Ungültiger Betrag in Überweisung ${i + 1} der pain.001: "${String(raw)}".`);
		}
		const ccy = (typeof amount === 'object' ? amount['@_Ccy'] : undefined) ?? 'EUR';
		if (currency !== undefined && ccy !== currency) {
			throw new Error(`Die pain.001 mischt Währungen (${currency}, ${ccy}).`);
		}
		currency = ccy;
		cents += txCents;
	});

	const header = initn?.GrpHdr;
	if (header?.NbOfTxs !== undefined && Number(header.NbOfTxs) !== txs.length) {
		throw new Error(
			`NbOfTxs im Gruppen-Header (${header.NbOfTxs}) passt nicht zu den ${txs.length} Überweisungen der pain.001.`,
		);
	}
	if (header?.CtrlSum !== undefined && toCents(header.CtrlSum) !== cents) {
		throw new Error(
			`CtrlSum im Gruppen-Header (${header.CtrlSum}) passt nicht zur Summe der Überweisungen (${(cents / 100).toFixed(2)}).`,
		);
	}

	return { count: txs.length, value: cents / 100, currency: currency ?? 'EUR' };
}
