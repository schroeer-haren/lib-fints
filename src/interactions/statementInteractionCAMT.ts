import { CamtParser } from '../camtParser.js';
import type { FinTSConfig } from '../config.js';
import type { Message } from '../message.js';
import type { Segment } from '../segment.js';
import { HICAZ, type HICAZSegment } from '../segments/HICAZ.js';
import type { HICAZSParameter } from '../segments/HICAZS.js';
import { HKCAZ, type HKCAZSegment } from '../segments/HKCAZ.js';
import type { Statement } from '../statement.js';
import { CustomerOrderInteraction, type StatementResponse } from './customerInteraction.js';

export class StatementInteractionCAMT extends CustomerOrderInteraction {
	constructor(
		public accountNumber: string,
		public from?: Date,
		public to?: Date,
	) {
		super(HKCAZ.Id, HICAZ.Id);
	}

	createSegments(init: FinTSConfig): Segment[] {
		const bankAccount = init.getBankAccount(this.accountNumber);
		const version = init.getMaxSupportedTransactionVersion(HKCAZ.Id);
		if (!version) {
			throw Error(`There is no supported version for business transaction '${HKCAZ.Id}'`);
		}

		let acceptedCamtFormats = ['urn:iso:std:iso:20022:tech:xsd:camt.052.001.08'];

		const params = init.getTransactionParameters<HICAZSParameter>(HKCAZ.Id);

		if (params && params.supportedCamtFormats.length > 0) {
			acceptedCamtFormats = params.supportedCamtFormats.filter((format) =>
				format.startsWith('urn:iso:std:iso:20022:tech:xsd:camt.052.001.'),
			);
		}

		const hkcaz: HKCAZSegment = {
			header: { segId: HKCAZ.Id, segNr: 0, version: version },
			account: bankAccount,
			acceptedCamtFormats: acceptedCamtFormats,
			allAccounts: false,
			from: this.from,
			to: this.to,
		};

		return [hkcaz];
	}

	private parseCamt(messages: string[], pending: boolean): Statement[] {
		const statements: Statement[] = [];
		for (const camtMessage of messages) {
			// The camtMessage is initially decoded as latin1 but is really UTF-8;
			// re-decode when the XML declares UTF-8 (single or double quotes).
			const isUtf8Encoded = /<\?xml[^>]*encoding=['"]UTF-8['"][^>]*\?>/i.test(camtMessage);
			const xmlString = isUtf8Encoded
				? Buffer.from(camtMessage, 'latin1').toString('utf8')
				: camtMessage;

			const parsed = new CamtParser(xmlString).parse();
			if (pending) {
				for (const st of parsed) {
					for (const t of st.transactions ?? []) t.pending = true;
				}
			}
			statements.push(...parsed);
		}
		return statements;
	}

	handleResponse(response: Message, clientResponse: StatementResponse) {
		const hicaz = response.findSegment<HICAZSegment>(HICAZ.Id);
		try {
			const statements: Statement[] = [];
			if (hicaz?.bookedTransactions?.length) {
				statements.push(...this.parseCamt(hicaz.bookedTransactions, false));
			}
			// Noted transactions (Vormerkposten) — not yet booked.
			if (hicaz?.notedTransactions?.length) {
				statements.push(...this.parseCamt(hicaz.notedTransactions, true));
			}
			clientResponse.statements = statements;
		} catch (error) {
			console.warn('CAMT parsing failed:', error);
			clientResponse.statements = [];
		}
	}
}
