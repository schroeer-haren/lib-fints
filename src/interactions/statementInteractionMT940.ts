import type { FinTSConfig } from '../config.js';
import type { Message } from '../message.js';
import { Mt940Parser } from '../mt940parser.js';
import type { Segment } from '../segment.js';
import { HIKAZ, type HIKAZSegment } from '../segments/HIKAZ.js';
import { HKKAZ, type HKKAZSegment } from '../segments/HKKAZ.js';
import type { Statement } from '../statement.js';
import { CustomerOrderInteraction, type StatementResponse } from './customerInteraction.js';

export class StatementInteractionMT940 extends CustomerOrderInteraction {
	constructor(
		public accountNumber: string,
		public from?: Date,
		public to?: Date,
	) {
		super(HKKAZ.Id, HIKAZ.Id);
	}

	createSegments(init: FinTSConfig): Segment[] {
		const bankAccount = init.getBankAccount(this.accountNumber);
		const account = { ...bankAccount, iban: undefined };
		const version = init.getMaxSupportedTransactionVersion(HKKAZ.Id);

		if (!version) {
			throw Error(`There is no supported version for business transaction '${HKKAZ.Id}'`);
		}

		const hkkaz: HKKAZSegment = {
			header: { segId: HKKAZ.Id, segNr: 0, version: version },
			account,
			allAccounts: false,
			from: this.from,
			to: this.to,
		};

		return [hkkaz];
	}

	handleResponse(response: Message, clientResponse: StatementResponse) {
		const hikaz = response.findSegment<HIKAZSegment>(HIKAZ.Id);
		const statements: Statement[] = [];
		try {
			if (hikaz?.bookedTransactions) {
				statements.push(...new Mt940Parser(hikaz.bookedTransactions).parse());
			}
			// Noted transactions (Vormerkposten) — not yet booked.
			if (hikaz?.notedTransactions) {
				const noted = new Mt940Parser(hikaz.notedTransactions).parse();
				for (const st of noted) {
					for (const t of st.transactions ?? []) t.pending = true;
				}
				statements.push(...noted);
			}
			clientResponse.statements = statements;
		} catch (error) {
			console.warn('MT940 parsing failed:', error);
			clientResponse.statements = [];
		}
	}
}
