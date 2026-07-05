export type SepaTransferData = {
	painDescriptor: string; // e.g. urn:iso:std:iso:20022:tech:xsd:pain.001.001.03
	debtorName: string;
	debtorIban: string;
	debtorBic?: string;
	creditorName: string;
	creditorIban: string;
	creditorBic?: string;
	amount: number; // in EUR
	currency?: string;
	purpose?: string;
	endToEndId?: string;
};

// Picks a pain descriptor we can generate (the pain.001.xxx.03 family shares the
// same XML structure). Prefers a .03 format from the bank's supported list, then
// the first supported one, else a sensible default.
export function pickSepaDescriptor(supportedFormats: string[]): string {
	const DEFAULT = 'urn:iso:std:iso:20022:tech:xsd:pain.001.001.03';
	const v03 = supportedFormats.find((f) => /pain\.001\.\d{3}\.03$/.test(f));
	if (v03) return v03;
	if (supportedFormats.length > 0) return supportedFormats[0];
	return DEFAULT;
}

function xmlEscape(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function formatAmount(amount: number): string {
	return amount.toFixed(2);
}

// A short, unique-ish id (alphanumeric, <= 35 chars) for MsgId/PmtInfId.
function makeId(prefix: string): string {
	const ts = new Date().toISOString().replace(/[-:.TZ]/g, '');
	const rand = Math.floor(Math.random() * 1e6)
		.toString()
		.padStart(6, '0');
	return `${prefix}${ts}${rand}`.slice(0, 35);
}

function finInstn(bic?: string): string {
	// pain.001.001.03 / .003.03 allow an IBAN-only transfer via "NOTPROVIDED".
	return bic
		? `<FinInstnId><BIC>${xmlEscape(bic)}</BIC></FinInstnId>`
		: `<FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId>`;
}

/**
 * Builds a pain.001 SEPA credit transfer message for a single payment. Works for
 * the pain.001.xxx.03 family (same structure, namespace = the given descriptor).
 */
export function buildSepaTransferMessage(data: SepaTransferData): string {
	const namespace = data.painDescriptor;
	const currency = data.currency ?? 'EUR';
	const amount = formatAmount(data.amount);
	const now = new Date();
	const creDtTm = now.toISOString().slice(0, 19); // yyyy-MM-ddTHH:mm:ss
	const msgId = makeId('M');
	const pmtInfId = makeId('P');
	const e2e = data.endToEndId?.trim() || 'NOTPROVIDED';

	return (
		`<?xml version="1.0" encoding="UTF-8"?>` +
		`<Document xmlns="${namespace}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
		`<CstmrCdtTrfInitn>` +
		`<GrpHdr>` +
		`<MsgId>${msgId}</MsgId>` +
		`<CreDtTm>${creDtTm}</CreDtTm>` +
		`<NbOfTxs>1</NbOfTxs>` +
		`<CtrlSum>${amount}</CtrlSum>` +
		`<InitgPty><Nm>${xmlEscape(data.debtorName)}</Nm></InitgPty>` +
		`</GrpHdr>` +
		`<PmtInf>` +
		`<PmtInfId>${pmtInfId}</PmtInfId>` +
		`<PmtMtd>TRF</PmtMtd>` +
		`<BtchBookg>false</BtchBookg>` +
		`<NbOfTxs>1</NbOfTxs>` +
		`<CtrlSum>${amount}</CtrlSum>` +
		`<PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl></PmtTpInf>` +
		`<ReqdExctnDt>1999-01-01</ReqdExctnDt>` +
		`<Dbtr><Nm>${xmlEscape(data.debtorName)}</Nm></Dbtr>` +
		`<DbtrAcct><Id><IBAN>${xmlEscape(data.debtorIban)}</IBAN></Id></DbtrAcct>` +
		`<DbtrAgt>${finInstn(data.debtorBic)}</DbtrAgt>` +
		`<ChrgBr>SLEV</ChrgBr>` +
		`<CdtTrfTxInf>` +
		`<PmtId><EndToEndId>${xmlEscape(e2e)}</EndToEndId></PmtId>` +
		`<Amt><InstdAmt Ccy="${currency}">${amount}</InstdAmt></Amt>` +
		`<CdtrAgt>${finInstn(data.creditorBic)}</CdtrAgt>` +
		`<Cdtr><Nm>${xmlEscape(data.creditorName)}</Nm></Cdtr>` +
		`<CdtrAcct><Id><IBAN>${xmlEscape(data.creditorIban)}</IBAN></Id></CdtrAcct>` +
		(data.purpose
			? `<RmtInf><Ustrd>${xmlEscape(data.purpose)}</Ustrd></RmtInf>`
			: '') +
		`</CdtTrfTxInf>` +
		`</PmtInf>` +
		`</CstmrCdtTrfInitn>` +
		`</Document>`
	);
}
