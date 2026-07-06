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

// Picks the SEPA credit-transfer (pain.001) descriptor as an ISO URN. The bank
// advertises formats in its own notation (e.g. "sepade:xsd:pain.001.001.03.xsd"),
// so we match the version as a substring and MUST pick a pain.001 format — never
// a pain.008 (direct debit) one, which the bank rejects for a transfer (3999).
// We prefer pain.001.001.03 because our XML builder targets that structure.
export function pickSepaDescriptor(supportedFormats: string[]): string {
	const urn = (v: string) => `urn:iso:std:iso:20022:tech:xsd:${v}`;
	const has = (v: string) => supportedFormats.some((f) => f.includes(v));
	// Prefer the current pain.001.001.09; fall back to the older .03.
	if (has('pain.001.001.09')) return urn('pain.001.001.09');
	if (has('pain.001.001.03')) return urn('pain.001.001.03');
	const anyCredit = supportedFormats.find((f) => /pain\.001\.001\.\d{2}/.test(f));
	if (anyCredit) {
		const m = anyCredit.match(/pain\.001\.001\.\d{2}/);
		if (m) return urn(m[0]);
	}
	return urn('pain.001.001.03');
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

// Debtor/creditor agent element. pain.001.001.09 uses <BICFI>, .03 uses <BIC>.
// For an IBAN-only transfer without a BIC the agent is omitted (returns '').
function agent(tag: 'DbtrAgt' | 'CdtrAgt', bic: string | undefined, isV09: boolean): string {
	if (!bic) return '';
	const bicTag = isV09 ? 'BICFI' : 'BIC';
	return `<${tag}><FinInstnId><${bicTag}>${xmlEscape(bic)}</${bicTag}></FinInstnId></${tag}>`;
}

// A single payment (credit-transfer transaction) within a batch. Each payment
// keeps its own EndToEndId so the booked transaction can be reconciled later.
export type SepaPayment = {
	creditorName: string;
	creditorIban: string;
	creditorBic?: string;
	amount: number; // in EUR
	purpose?: string;
	endToEndId?: string;
};

// Builds one <CdtTrfTxInf> block for a payment.
function creditTransferTx(p: SepaPayment, currency: string, isV09: boolean): string {
	const amount = formatAmount(p.amount);
	const e2e = p.endToEndId?.trim() || 'NOTPROVIDED';
	return (
		`<CdtTrfTxInf>` +
		`<PmtId><EndToEndId>${xmlEscape(e2e)}</EndToEndId></PmtId>` +
		`<Amt><InstdAmt Ccy="${currency}">${amount}</InstdAmt></Amt>` +
		agent('CdtrAgt', p.creditorBic, isV09) +
		`<Cdtr><Nm>${xmlEscape(p.creditorName)}</Nm></Cdtr>` +
		`<CdtrAcct><Id><IBAN>${xmlEscape(p.creditorIban)}</IBAN></Id></CdtrAcct>` +
		(p.purpose ? `<RmtInf><Ustrd>${xmlEscape(p.purpose)}</Ustrd></RmtInf>` : '') +
		`</CdtTrfTxInf>`
	);
}

export type SepaCollectiveData = {
	painDescriptor: string;
	debtorName: string;
	debtorIban: string;
	debtorBic?: string;
	currency?: string;
	payments: SepaPayment[];
	// N = one collective (Sammel) booking, J = each payment booked individually.
	singleBooking: boolean;
};

// The batch total, rounded to cents, as a number (for the FinTS Summenfeld).
export function collectiveSum(payments: SepaPayment[]): number {
	const cents = payments.reduce((sum, p) => sum + Math.round(p.amount * 100), 0);
	return cents / 100;
}

/**
 * Builds a pain.001 SEPA credit transfer message for MULTIPLE payments (a batch /
 * Sammelüberweisung). All payments share one PmtInf block; NbOfTxs and CtrlSum
 * are computed from the payments. BtchBookg reflects the singleBooking flag
 * (singleBooking = true → BtchBookg = false, i.e. individual statement entries).
 */
export function buildSepaCollectiveTransferMessage(data: SepaCollectiveData): string {
	const namespace = data.painDescriptor;
	const isV09 = /001\.09/.test(namespace);
	const currency = data.currency ?? 'EUR';
	const now = new Date();
	const creDtTm = now.toISOString().slice(0, 19);
	const msgId = makeId('M');
	const pmtInfId = makeId('P');
	const nbOfTxs = data.payments.length;
	const ctrlSum = formatAmount(collectiveSum(data.payments));
	const reqdExctnDt = isV09
		? `<ReqdExctnDt><Dt>1999-01-01</Dt></ReqdExctnDt>`
		: `<ReqdExctnDt>1999-01-01</ReqdExctnDt>`;
	const dbtrAgt = data.debtorBic
		? agent('DbtrAgt', data.debtorBic, isV09)
		: `<DbtrAgt><FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId></DbtrAgt>`;
	const txs = data.payments.map((p) => creditTransferTx(p, currency, isV09)).join('');

	return (
		`<?xml version="1.0" encoding="UTF-8"?>` +
		`<Document xmlns="${namespace}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
		`<CstmrCdtTrfInitn>` +
		`<GrpHdr>` +
		`<MsgId>${msgId}</MsgId>` +
		`<CreDtTm>${creDtTm}</CreDtTm>` +
		`<NbOfTxs>${nbOfTxs}</NbOfTxs>` +
		`<CtrlSum>${ctrlSum}</CtrlSum>` +
		`<InitgPty><Nm>${xmlEscape(data.debtorName)}</Nm></InitgPty>` +
		`</GrpHdr>` +
		`<PmtInf>` +
		`<PmtInfId>${pmtInfId}</PmtInfId>` +
		`<PmtMtd>TRF</PmtMtd>` +
		`<BtchBookg>${data.singleBooking ? 'false' : 'true'}</BtchBookg>` +
		`<NbOfTxs>${nbOfTxs}</NbOfTxs>` +
		`<CtrlSum>${ctrlSum}</CtrlSum>` +
		`<PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl></PmtTpInf>` +
		reqdExctnDt +
		`<Dbtr><Nm>${xmlEscape(data.debtorName)}</Nm></Dbtr>` +
		`<DbtrAcct><Id><IBAN>${xmlEscape(data.debtorIban)}</IBAN></Id></DbtrAcct>` +
		dbtrAgt +
		`<ChrgBr>SLEV</ChrgBr>` +
		txs +
		`</PmtInf>` +
		`</CstmrCdtTrfInitn>` +
		`</Document>`
	);
}

/**
 * Builds a pain.001 SEPA credit transfer message for a single payment. Supports
 * the pain.001.001.03 and pain.001.001.09 structures (chosen by the descriptor).
 */
export function buildSepaTransferMessage(data: SepaTransferData): string {
	const namespace = data.painDescriptor;
	const isV09 = /001\.09/.test(namespace);
	const currency = data.currency ?? 'EUR';
	const amount = formatAmount(data.amount);
	const now = new Date();
	const creDtTm = now.toISOString().slice(0, 19); // yyyy-MM-ddTHH:mm:ss
	const msgId = makeId('M');
	const pmtInfId = makeId('P');
	const e2e = data.endToEndId?.trim() || 'NOTPROVIDED';
	const reqdExctnDt = isV09
		? `<ReqdExctnDt><Dt>1999-01-01</Dt></ReqdExctnDt>`
		: `<ReqdExctnDt>1999-01-01</ReqdExctnDt>`;
	// Debtor agent: we usually have the BIC; keep NOTPROVIDED only for .03 fallback.
	const dbtrAgt = data.debtorBic
		? agent('DbtrAgt', data.debtorBic, isV09)
		: `<DbtrAgt><FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId></DbtrAgt>`;

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
		reqdExctnDt +
		`<Dbtr><Nm>${xmlEscape(data.debtorName)}</Nm></Dbtr>` +
		`<DbtrAcct><Id><IBAN>${xmlEscape(data.debtorIban)}</IBAN></Id></DbtrAcct>` +
		dbtrAgt +
		`<ChrgBr>SLEV</ChrgBr>` +
		`<CdtTrfTxInf>` +
		`<PmtId><EndToEndId>${xmlEscape(e2e)}</EndToEndId></PmtId>` +
		`<Amt><InstdAmt Ccy="${currency}">${amount}</InstdAmt></Amt>` +
		agent('CdtrAgt', data.creditorBic, isV09) +
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
