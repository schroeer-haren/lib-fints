import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { Balance, Statement, Transaction } from './statement.js';

// Type definitions for CAMT XML structure
type GenericXMLObject = Record<string, unknown>;

interface XMLDocument {
	[key: string]: unknown;
	Document?: CamtDocument;
	camt?: CamtDocument;
}

interface CamtDocument extends GenericXMLObject {
	BkToCstmrAcctRpt?: {
		Rpt?: CamtReport | CamtReport[];
	};
}

interface CamtReport extends GenericXMLObject {
	Id?: string | { '#text': string };
	ElctrncSeqNb?: string | { '#text': string };
	Acct?: {
		Id?: {
			IBAN?: string | { '#text': string };
		};
	};
	Bal?: CamtBalance | CamtBalance[];
	Ntry?: CamtEntry | CamtEntry[];
}

interface CamtBalance extends GenericXMLObject {
	Tp?: {
		CdOrPrtry?: {
			Cd?: string | { '#text': string };
		};
	};
	Amt?:
		| {
				'@Ccy'?: string;
				'#text'?: string;
		  }
		| string;
	CdtDbtInd?: string | { '#text': string };
	Dt?:
		| {
				Dt?: string | { '#text': string };
		  }
		| string
		| { '#text': string };
}

interface CamtEntry extends GenericXMLObject {
	Amt?:
		| {
				'#text'?: string;
		  }
		| string;
	CdtDbtInd?: string | { '#text': string };
	BookgDt?:
		| {
				Dt?: string | { '#text': string };
		  }
		| string
		| { '#text': string };
	ValDt?:
		| {
				Dt?: string | { '#text': string };
		  }
		| string
		| { '#text': string };
	AcctSvcrRef?: string | { '#text': string };
	AddtlNtryInf?: string | { '#text': string };
	BkTxCd?: CamtBankTransactionCode;
	NtryDtls?: {
		// A batch (collective) booking carries several TxDtls (one per payment).
		TxDtls?: CamtTransactionDetails | CamtTransactionDetails[];
		Btch?: {
			NbOfTxs?: string | { '#text': string };
			TtlAmt?: unknown;
			PmtInfId?: string | { '#text': string };
		};
	};
}

interface CamtTransactionDetails extends GenericXMLObject {
	Refs?: {
		EndToEndId?: string | { '#text': string };
		MndtId?: string | { '#text': string };
	};
	RmtInf?: {
		Ustrd?: string | { '#text': string };
	};
	RltdPties?: {
		Dbtr?: CamtParty;
		DbtrAcct?: CamtAccount;
		Cdtr?: CamtParty;
		CdtrAcct?: CamtAccount;
	};
	RltdAgts?: {
		DbtrAgt?: {
			FinInstnId?: CamtBankIdentification;
		};
		CdtrAgt?: {
			FinInstnId?: CamtBankIdentification;
		};
	};
	BkTxCd?: CamtBankTransactionCode;
}

interface CamtParty extends GenericXMLObject {
	Nm?: string | { '#text': string };
	Pty?: {
		Nm?: string | { '#text': string };
	};
	Id?: {
		OrgId?: {
			Nm?: string | { '#text': string };
			Othr?: {
				Id?: string | { '#text': string };
			};
		};
		PrvtId?: {
			Nm?: string | { '#text': string };
		};
	};
	PstlAdr?: {
		AdrLine?: string | { '#text': string };
	};
}

interface CamtAccount extends GenericXMLObject {
	Id?: {
		IBAN?: string | { '#text': string };
	};
}

interface CamtBankIdentification extends GenericXMLObject {
	BIC?: string | { '#text': string };
	BICFI?: string | { '#text': string };
	ClrSysMmbId?: {
		MmbId?: string | { '#text': string };
	};
	Othr?: {
		Id?: string | { '#text': string };
	};
}

interface CamtBankTransactionCode extends GenericXMLObject {
	Domn?: {
		Cd?: string | { '#text': string };
		Fmly?: {
			Cd?: string | { '#text': string };
			SubFmlyCd?: string | { '#text': string };
		};
	};
}

export class CamtParsingError extends Error {
	constructor(
		message: string,
		public cause?: Error,
	) {
		super(message);
		this.name = 'CamtParsingError';
	}
}

export class CamtParser {
	private xmlData: string;
	private parser: XMLParser;

	constructor(xmlData: string) {
		this.xmlData = xmlData;
		this.parser = new XMLParser({
			ignoreAttributes: false,
			attributeNamePrefix: '@',
			textNodeName: '#text',
			removeNSPrefix: true,
			parseAttributeValue: true,
			trimValues: true,
			parseTagValue: false, // Don't auto-parse values to preserve strings like "00001"
			processEntities: true,
			allowBooleanAttributes: false,
			numberParseOptions: {
				hex: false,
				leadingZeros: true,
				eNotation: true,
			},
		});
	}

	parse(): Statement[] {
		try {
			// Pre-validate XML
			const validationResult = XMLValidator.validate(this.xmlData);
			if (validationResult !== true) {
				throw new CamtParsingError(`Invalid CAMT XML structure: ${validationResult.err.msg}`);
			}

			// Parse XML to JavaScript object
			const document = this.parser.parse(this.xmlData);

			// Navigate to Document/BkToCstmrStmt/Stmt array
			const statements: Statement[] = [];
			const docObj = this.getDocumentObject(document);
			const reports = this.getReports(docObj);

			if (!reports || reports.length === 0) {
				return statements;
			}

			for (let i = 0; i < reports.length; i++) {
				try {
					const statement = this.parseReport(reports[i], i + 1);
					if (statement) {
						statements.push(statement);
					}
				} catch (error) {
					throw new CamtParsingError(
						`Failed to parse CAMT report ${i + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`,
						error instanceof Error ? error : undefined,
					);
				}
			}

			return statements;
		} catch (error) {
			if (error instanceof CamtParsingError) {
				throw error;
			}
			throw new CamtParsingError(
				`Failed to parse CAMT document: ${error instanceof Error ? error.message : 'Unknown error'}`,
				error instanceof Error ? error : undefined,
			);
		}
	}

	private getDocumentObject(document: XMLDocument): CamtDocument {
		// Handle different possible XML root structures
		if (document.Document) {
			return document.Document;
		}
		if (document.camt) {
			return document.camt;
		}
		// Look for any object with BkToCstmrAcctRpt property
		for (const key in document) {
			if (
				document[key] &&
				typeof document[key] === 'object' &&
				(document[key] as CamtDocument)?.BkToCstmrAcctRpt
			) {
				return document[key] as CamtDocument;
			}
		}
		throw new CamtParsingError('No valid CAMT document structure found');
	}

	private getReports(docObj: CamtDocument): CamtReport[] {
		const bkToCstmrAcctRpt = docObj.BkToCstmrAcctRpt;
		if (!bkToCstmrAcctRpt) {
			throw new CamtParsingError('No BkToCstmrAcctRpt element found in CAMT document');
		}

		const rpt = bkToCstmrAcctRpt.Rpt;
		if (!rpt) {
			return [];
		}

		// Handle both single report and array of reports
		return Array.isArray(rpt) ? rpt : [rpt];
	}

	private parseReport(report: CamtReport, reportNumber: number): Statement | null {
		try {
			// Extract account information
			const account = this.getValueFromPath(report, 'Acct.Id.IBAN');

			// Extract statement number/ID
			const number = this.getValueFromPath(report, 'Id');

			// Extract transaction reference
			const transactionReference = this.getValueFromPath(report, 'ElctrncSeqNb');

			// Parse balances
			const balances = this.parseBalances(report, reportNumber);

			// Be more flexible with balance requirements - some banks only provide one balance
			let openingBalance = balances.openingBalance;
			let closingBalance = balances.closingBalance;

			// If we don't have both opening and closing, try to use what we have
			if (!openingBalance && !closingBalance) {
				// If we have available balance, use it as closing balance
				if (balances.availableBalance) {
					closingBalance = balances.availableBalance;
				} else {
					throw new CamtParsingError(`No balance information found in CAMT report ${reportNumber}`);
				}
			}

			// If missing opening balance, create a zero balance for the same date as closing
			if (!openingBalance && closingBalance) {
				openingBalance = {
					date: closingBalance.date,
					currency: closingBalance.currency,
					value: 0,
				};
			}

			// If missing closing balance, use opening balance as closing
			if (!closingBalance && openingBalance) {
				closingBalance = openingBalance;
			}

			// Parse transactions
			const transactions = this.parseTransactions(report, reportNumber);

			// At this point we should have both balances, otherwise throw an error
			if (!openingBalance || !closingBalance) {
				throw new CamtParsingError(
					`Unable to determine required balances for CAMT report ${reportNumber}`,
				);
			}

			return {
				account,
				number,
				transactionReference,
				openingBalance,
				closingBalance,
				availableBalance: balances.availableBalance,
				transactions,
			};
		} catch (error) {
			if (error instanceof CamtParsingError) {
				throw error;
			}
			throw new CamtParsingError(
				`Failed to parse report ${reportNumber} content: ${error instanceof Error ? error.message : 'Unknown error'}`,
				error instanceof Error ? error : undefined,
			);
		}
	}

	private getValueFromPath(obj: GenericXMLObject, path: string): string | undefined {
		const pathParts = path.split('.');
		let current: unknown = obj;

		for (const part of pathParts) {
			if (current && typeof current === 'object' && current !== null && part in current) {
				current = (current as Record<string, unknown>)[part];
			} else {
				return undefined;
			}
		}

		if (typeof current === 'string' || typeof current === 'number') {
			return String(current);
		}
		if (Array.isArray(current)) {
			return String(current.join('\n'));
		}
		if (current && typeof current === 'object' && current !== null && '#text' in current) {
			return String((current as { '#text': unknown })['#text']);
		}

		return undefined;
	}

	private parseBalances(
		report: CamtReport,
		reportNumber: number,
	): {
		openingBalance?: Balance;
		closingBalance?: Balance;
		availableBalance?: Balance;
	} {
		try {
			let openingBalance: Balance | undefined;
			let closingBalance: Balance | undefined;
			let availableBalance: Balance | undefined;

			// Get balance array from report
			const balances = report.Bal;
			if (!balances) {
				return { openingBalance, closingBalance, availableBalance };
			}

			const balanceArray = Array.isArray(balances) ? balances : [balances];

			for (const balanceObj of balanceArray) {
				const typeCode = this.getValueFromPath(balanceObj, 'Tp.CdOrPrtry.Cd');

				// Extract amount and currency
				let currency = 'EUR';
				if (balanceObj.Amt && typeof balanceObj.Amt === 'object' && '@Ccy' in balanceObj.Amt) {
					currency = (balanceObj.Amt['@Ccy'] as string) || 'EUR';
				}
				const value = parseFloat(this.getValueFromPath(balanceObj, 'Amt') || '0');

				const creditDebitInd = this.getValueFromPath(balanceObj, 'CdtDbtInd');
				const finalValue = creditDebitInd === 'DBIT' ? -value : value;

				const dateStr =
					this.getValueFromPath(balanceObj, 'Dt.Dt') || this.getValueFromPath(balanceObj, 'Dt');
				const date = dateStr ? this.parseDate(dateStr) : new Date();

				const balance: Balance = {
					date,
					currency,
					value: finalValue,
				};

				switch (typeCode) {
					case 'PRCD': // Previous closing date
					case 'OPBD': // Opening booked
					case 'OPAV': // Opening available
						openingBalance = balance;
						break;
					case 'CLBD': // Closing booked
					case 'CLAV': // Closing available
						closingBalance = balance;
						break;
					case 'ITBD': // Interim booked
					case 'ITAV': // Interim available
					case 'FWAV': // Forward available
					case 'BOOK': // Booked balance
						// Use as available balance, or as closing if we don't have one
						if (!availableBalance) {
							availableBalance = balance;
						}
						// If we don't have a closing balance, use this as closing
						if (!closingBalance && (typeCode === 'BOOK' || typeCode === 'ITBD')) {
							closingBalance = balance;
						}
						break;
					default:
						// Handle unknown balance types by using them as closing balance if we don't have one
						if (!closingBalance) {
							closingBalance = balance;
						}
						break;
				}
			}

			return { openingBalance, closingBalance, availableBalance };
		} catch (error) {
			throw new CamtParsingError(
				`Failed to parse balances in report ${reportNumber}: ${
					error instanceof Error ? error.message : 'Unknown error'
				}`,
				error instanceof Error ? error : undefined,
			);
		}
	}

	private parseTransactions(report: CamtReport, reportNumber: number): Transaction[] {
		const transactions: Transaction[] = [];
		const entries = report.Ntry;

		if (!entries) {
			return transactions;
		}

		const entryArray = Array.isArray(entries) ? entries : [entries];

		for (let i = 0; i < entryArray.length; i++) {
			try {
				const transaction = this.parseTransaction(entryArray[i]);
				if (transaction) {
					transactions.push(transaction);
				}
			} catch (error) {
				throw new CamtParsingError(
					`Failed to parse transaction ${i + 1} in report ${reportNumber}: ${
						error instanceof Error ? error.message : 'Unknown error'
					}`,
					error instanceof Error ? error : undefined,
				);
			}
		}

		return transactions;
	}

	private parseTransaction(entry: CamtEntry): Transaction | null {
		try {
			// Extract amount and credit/debit indicator
			const amountValue = parseFloat(this.getValueFromPath(entry, 'Amt') || '0');
			const creditDebitInd = this.getValueFromPath(entry, 'CdtDbtInd');
			const isDebit = creditDebitInd === 'DBIT';
			const amount = isDebit ? -amountValue : amountValue;

			// Extract dates
			const bookingDate =
				this.getValueFromPath(entry, 'BookgDt.DtTm') ||
				this.getValueFromPath(entry, 'BookgDt.Dt') ||
				this.getValueFromPath(entry, 'BookgDt');
			const valueDate =
				this.getValueFromPath(entry, 'ValDt.DtTm') ||
				this.getValueFromPath(entry, 'ValDt.Dt') ||
				this.getValueFromPath(entry, 'ValDt');

			const entryDate = bookingDate ? this.parseDate(bookingDate) : new Date();
			const parsedValueDate = valueDate ? this.parseDate(valueDate) : entryDate;

			// Extract references
			const accountServicerRef = this.getValueFromPath(entry, 'AcctSvcrRef') || '';
			const additionalEntryInfo = this.getValueFromPath(entry, 'AddtlNtryInf') || '';

			// A batch (collective) booking has several TxDtls — one per underlying
			// payment. Normalise to an array so both cases share the same code.
			const rawTxDtls = entry.NtryDtls?.TxDtls;
			const txList: CamtTransactionDetails[] = rawTxDtls
				? Array.isArray(rawTxDtls)
					? rawTxDtls
					: [rawTxDtls]
				: [];

			// Build a Transaction from a single TxDtls (used for the single-booking
			// case and for each sub-transaction of a batch booking).
			const fromTxDtls = (txDtls: CamtTransactionDetails): Transaction => {
				const subInd = this.getValueFromPath(txDtls, 'CdtDbtInd') || creditDebitInd;
				const subDebit = subInd === 'DBIT';
				const subAmtVal = parseFloat(
					this.getValueFromPath(txDtls, 'Amt') ||
						this.getValueFromPath(txDtls, 'AmtDtls.TxAmt.Amt') ||
						'0',
				);
				const subAmount = subDebit ? -subAmtVal : subAmtVal;
				const e2e = this.getValueFromPath(txDtls, 'Refs.EndToEndId') || '';
				const mnd = this.getValueFromPath(txDtls, 'Refs.MndtId') || '';
				const rmt = this.getValueFromPath(txDtls, 'RmtInf.Ustrd') || '';
				const partyPath = subDebit ? 'RltdPties.Cdtr' : 'RltdPties.Dbtr';
				const acctPath = subDebit
					? 'RltdPties.CdtrAcct.Id.IBAN'
					: 'RltdPties.DbtrAcct.Id.IBAN';
				const agtPath = subDebit
					? 'RltdAgts.CdtrAgt.FinInstnId'
					: 'RltdAgts.DbtrAgt.FinInstnId';
				let sbk = this.parseBankTransactionCode(txDtls);
				if (!sbk.domainCode && !sbk.familyCode && !sbk.subFamilyCode) {
					sbk = this.parseBankTransactionCode(entry);
				}
				return {
					valueDate: parsedValueDate,
					entryDate,
					fundsCode: sbk.domainCode || subInd || '',
					amount: subAmount,
					transactionType: sbk.familyCode || '',
					customerReference: e2e,
					bankReference: accountServicerRef,
					transactionCode: sbk.subFamilyCode || '',
					purpose: rmt,
					remoteName: this.extractPartyName(txDtls, partyPath),
					remoteAccountNumber: this.getValueFromPath(txDtls, acctPath) || '',
					remoteBankId: this.extractBankId(txDtls, agtPath),
					e2eReference: e2e,
					mandateReference: mnd,
					additionalInformation: additionalEntryInfo,
					bookingText: additionalEntryInfo,
				};
			};

			// A batch is only "resolved" inside the camt (DK Fall A) when it carries
			// several TxDtls that each have a real amount. Fall B/C deliver just the
			// aggregate (or a degenerate TxDtls with only a GVC) — then the items are
			// only in a separate camt.054 (EBICS), not splittable here.
			const resolvedSubs =
				txList.length > 1 ? txList.map(fromTxDtls).filter((s) => s.amount !== 0) : [];
			const isBatch = resolvedSubs.length >= 2;

			// Batch booking: keep the aggregate (entry) as the main transaction and
			// attach the individual payments as sub-transactions.
			if (isBatch) {
				const bkTxCd = this.parseBankTransactionCode(entry);
				return {
					valueDate: parsedValueDate,
					entryDate,
					fundsCode: bkTxCd.domainCode || creditDebitInd || '',
					amount,
					transactionType: bkTxCd.familyCode || '',
					customerReference: '',
					bankReference: accountServicerRef,
					transactionCode: bkTxCd.subFamilyCode || '',
					purpose: additionalEntryInfo,
					remoteName: '',
					remoteAccountNumber: '',
					remoteBankId: '',
					e2eReference: '',
					mandateReference: '',
					additionalInformation: additionalEntryInfo,
					bookingText: additionalEntryInfo,
					subTransactions: resolvedSubs,
				};
			}

			// Single booking: use the one TxDtls (if any) for e2e/party details.
			const txDtls = txList[0];
			if (!txDtls) {
				const bkTxCd = this.parseBankTransactionCode(entry);
				return {
					valueDate: parsedValueDate,
					entryDate,
					fundsCode: bkTxCd.domainCode || creditDebitInd || '',
					amount,
					transactionType: bkTxCd.familyCode || '',
					customerReference: '',
					bankReference: accountServicerRef,
					transactionCode: bkTxCd.subFamilyCode || '',
					purpose: '',
					remoteName: '',
					remoteAccountNumber: '',
					remoteBankId: '',
					e2eReference: '',
					mandateReference: '',
					additionalInformation: additionalEntryInfo,
					bookingText: additionalEntryInfo,
				};
			}
			const single = fromTxDtls(txDtls);
			// The single booking's amount/sign comes from the entry level.
			single.amount = amount;
			return single;
		} catch (error) {
			throw new CamtParsingError(
				`Failed to parse transaction details: ${error instanceof Error ? error.message : 'Unknown error'}`,
				error instanceof Error ? error : undefined,
			);
		}
	}

	/**
	 * Extract party name from various possible CAMT structures
	 * Handles both direct name (<Dbtr><Nm>) and party structure (<Dbtr><Pty><Nm>)
	 */
	private extractPartyName(txDtls: CamtTransactionDetails, partyPath: string): string {
		// Strategy 1: Direct name structure (e.g., RltdPties.Dbtr.Nm)
		let name = this.getValueFromPath(txDtls, `${partyPath}.Nm`);
		if (name) {
			return name;
		}

		// Strategy 2: Party structure (e.g., RltdPties.Dbtr.Pty.Nm)
		name = this.getValueFromPath(txDtls, `${partyPath}.Pty.Nm`);
		if (name) {
			return name;
		}

		// Strategy 3: Organization ID structure (e.g., RltdPties.Dbtr.Id.OrgId.Nm)
		name = this.getValueFromPath(txDtls, `${partyPath}.Id.OrgId.Nm`);
		if (name) {
			return name;
		}

		// Strategy 4: Private ID structure (e.g., RltdPties.Dbtr.Id.PrvtId.Nm)
		name = this.getValueFromPath(txDtls, `${partyPath}.Id.PrvtId.Nm`);
		if (name) {
			return name;
		}

		// Strategy 5: Try postal address line as fallback
		name = this.getValueFromPath(txDtls, `${partyPath}.PstlAdr.AdrLine`);
		if (name) {
			return name;
		}

		// Strategy 6: Try organization identification other
		name = this.getValueFromPath(txDtls, `${partyPath}.Id.OrgId.Othr.Id`);
		if (name) {
			return name;
		}

		return '';
	}

	/**
	 * Extract bank identification code from various possible CAMT structures
	 * Handles both BIC and BICFI elements
	 */
	private extractBankId(txDtls: CamtTransactionDetails, bankPath: string): string {
		// Strategy 1: Standard BIC element
		let bankId = this.getValueFromPath(txDtls, `${bankPath}.BIC`);
		if (bankId) {
			return bankId;
		}

		// Strategy 2: BICFI element (used by some banks)
		bankId = this.getValueFromPath(txDtls, `${bankPath}.BICFI`);
		if (bankId) {
			return bankId;
		}

		// Strategy 3: Try ClrSysMmbId (clearing system member identification)
		bankId = this.getValueFromPath(txDtls, `${bankPath}.ClrSysMmbId.MmbId`);
		if (bankId) {
			return bankId;
		}

		// Strategy 4: Try other identification
		bankId = this.getValueFromPath(txDtls, `${bankPath}.Othr.Id`);
		if (bankId) {
			return bankId;
		}

		return '';
	}

	private parseDate(dateStr: string): Date {
		let processedDateStr = dateStr;
		// Handle date-only with timezone, e.g., "2026-01-22+01:00"
		// The Date constructor may not parse this correctly, so we add a time part.
		if (/^\d{4}-\d{2}-\d{2}[+-]\d{2}:\d{2}$/.test(dateStr)) {
			processedDateStr = `${dateStr.substring(0, 10)}T00:00:00${dateStr.substring(10)}`;
		}

		// Attempt to parse as a full ISO 8601 string first, which `new Date()` handles well.
		// This will correctly handle formats like "2023-10-26T10:00:00+02:00".
		const isoDate = new Date(processedDateStr);
		if (!Number.isNaN(isoDate.getTime())) {
			// Check if the date string contains time or timezone information to avoid misinterpreting YYYY-MM-DD
			if (processedDateStr.includes('T') || /[-+]\d{2}:\d{2}$/.test(processedDateStr)) {
				return isoDate;
			}
		}

		// Fallback for date-only ISO format (YYYY-MM-DD)
		if (dateStr.length === 10 && dateStr.includes('-')) {
			return new Date(`${dateStr}T12:00:00`); // Set time to noon to avoid timezone issues
		}

		// Parse CAMT date format (YYYYMMDD)
		if (dateStr.length === 8) {
			const year = parseInt(dateStr.substring(0, 4), 10);
			const month = parseInt(dateStr.substring(4, 6), 10) - 1; // Month is 0-based
			const day = parseInt(dateStr.substring(6, 8), 10);
			return new Date(year, month, day, 12);
		}

		return new Date(dateStr);
	}

	private parseBankTransactionCode(entry: CamtEntry | CamtTransactionDetails): {
		domainCode?: string;
		familyCode?: string;
		subFamilyCode?: string;
	} {
		const bkTxCd = entry.BkTxCd;
		if (!bkTxCd) {
			return {};
		}

		// Extract Domain Code (first level - e.g., "PMNT")
		const domainCode = this.getValueFromPath(bkTxCd, 'Domn.Cd');

		// Extract Family Code (second level - e.g., "CCRD")
		const familyCode = this.getValueFromPath(bkTxCd, 'Domn.Fmly.Cd');

		// Extract SubFamily Code (third level - e.g., "POSD")
		const subFamilyCode = this.getValueFromPath(bkTxCd, 'Domn.Fmly.SubFmlyCd');

		return {
			domainCode,
			familyCode,
			subFamilyCode,
		};
	}
}
