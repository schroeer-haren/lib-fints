import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

function parseDoc(xml: string): Record<string, unknown> {
	return parser.parse(xml) as Record<string, unknown>;
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
