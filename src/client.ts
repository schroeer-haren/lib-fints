import { FinTSConfig } from './config.js';
import { Dialog } from './dialog.js';
import {
	type AccountBalanceResponse,
	BalanceInteraction,
} from './interactions/balanceInteraction.js';
import { CreditCardStatementInteraction } from './interactions/creditcardStatementInteraction.js';
import type {
	ClientResponse,
	CustomerOrderInteraction,
	StatementResponse,
} from './interactions/customerInteraction.js';
import {
	CollectiveDirectDebitInteraction,
	DirectDebitInteraction,
} from './interactions/debitInteraction.js';
import type { InitResponse } from './interactions/initDialogInteraction.js';
import {
	PortfolioInteraction,
	type PortfolioResponse,
} from './interactions/portfolioInteraction.js';
import { StatementInteractionCAMT } from './interactions/statementInteractionCAMT.js';
import { StatementInteractionMT940 } from './interactions/statementInteractionMT940.js';
import { TanMediaInteraction, type TanMediaResponse } from './interactions/tanMediaInteraction.js';
import {
	CollectiveTransferInteraction,
	TransferInteraction,
	type TransferResponse,
	VopPollInteraction,
} from './interactions/transferInteraction.js';
import { DKKKU } from './segments/DKKKU.js';
import type { HISPASParameter } from './segments/HISPAS.js';
import type { HIVPPSParameter } from './segments/HIVPPS.js';
import { HKCAZ } from './segments/HKCAZ.js';
import { HKCCM } from './segments/HKCCM.js';
import { HKCCS } from './segments/HKCCS.js';
import { HKDME } from './segments/HKDME.js';
import { HKDSE } from './segments/HKDSE.js';
import { HKIDN } from './segments/HKIDN.js';
import { HKIPM } from './segments/HKIPM.js';
import { HKIPZ } from './segments/HKIPZ.js';
import { HKKAZ } from './segments/HKKAZ.js';
import { HKSAL } from './segments/HKSAL.js';
import { HKWPD } from './segments/HKWPD.js';
import {
	buildSepaCollectiveTransferMessage,
	buildSepaDirectDebitMessage,
	buildSepaTransferMessage,
	collectiveSum,
	pickSepaDebitDescriptor,
	pickSepaDescriptor,
	type SepaDebitPayment,
	type SepaLocalInstrument,
	type SepaPayment,
	type SepaSequenceType,
} from './sepa.js';
import { countDirectDebitTx, parsePain008Namespace, sumInstructedAmount } from './sepaXml.js';
import type { TanMethod } from './tanMethod.js';

export interface SynchronizeResponse extends InitResponse {}

/**
 * A client to communicate with a bank over the FinTS protocol
 */
export class FinTSClient {
	private currentDialog: Dialog | undefined;

	/**
	 * Creates a new FinTS client
	 * @param config - the configuration for the client, use the static factory methods FinTSConfig.forFirstTimeUse or FinTSConfig.fromBankingInformation to create a configuration
	 */
	constructor(public config: FinTSConfig) {
		if (!config) {
			throw new Error('configuration must be provided when creating a FinTSClient');
		}

		if (!(config instanceof FinTSConfig)) {
			throw new Error('configuration must be an instance of class FinTSConfig');
		}
	}

	/**
	 * Selects a TAN method by its ID
	 * @param tanMethodId - the ID of the TAN method to select, get the ID from FinTSClient.config.availableTanMethods
	 * @returns the selected TAN method
	 */
	selectTanMethod(tanMethodId: number): TanMethod {
		return this.config.selectTanMethod(tanMethodId);
	}

	/**
	 * Selects a TAN media by its name
	 * @param tanMediaName - the name of the TAN media to select corresponding to a name in TanMethod.activeTanMedia
	 */
	selectTanMedia(tanMediaName: string): void {
		this.config.selectTanMedia(tanMediaName);
	}

	/**
	 * Whether the bank supports querying the list of registered TAN media (HKTAB).
	 */
	canGetTanMedia(): boolean {
		return this.config.isTransactionSupported('HKTAB');
	}

	/**
	 * Fetches the names of the user's registered TAN media/devices (HKTAB). These
	 * are the valid "Gerätebezeichnungen" for methods that require a TAN medium
	 * (e.g. pushTAN/SecureGo). Requires a prior synchronize() to have loaded the
	 * bank parameters (BPD). Also fills the selected TAN method's activeTanMedia.
	 * @returns the list of TAN media names
	 */
	async getTanMedia(): Promise<string[]> {
		const response = (await this.startCustomerOrderInteraction(
			new TanMediaInteraction(),
		)) as TanMediaResponse;
		return response.tanMediaList ?? [];
	}

	/**
	 * Whether the account supports a SEPA credit transfer (HKCCS) or, when
	 * instant is true, an instant transfer (HKIPZ / Echtzeitüberweisung).
	 */
	canSepaTransfer(accountNumber: string, instant = false): boolean {
		return this.config.isAccountTransactionSupported(accountNumber, instant ? HKIPZ.Id : HKCCS.Id);
	}

	/**
	 * The SEPA pain formats the bank supports (from HISPAS), e.g.
	 * ['urn:iso:std:iso:20022:tech:xsd:pain.001.001.03', ...].
	 */
	getSupportedSepaFormats(): string[] {
		const params = this.config.getTransactionParameters<HISPASParameter>('HKSPA');
		return params?.supportedSepaFormats ?? [];
	}

	/**
	 * The pain.002 payment status report format the bank expects in a Verification
	 * of Payee check request (HKVPP), from HIVPPS. Undefined if the bank does not
	 * advertise VoP.
	 */
	getVopReportFormat(): string | undefined {
		const params = this.config.getTransactionParameters<HIVPPSParameter>('HKVPP');
		return params?.supportedReportFormats;
	}

	/**
	 * Initiates a SEPA single credit transfer from the given account. Requires
	 * strong authentication: returns requiresTan and is continued via
	 * sepaTransferWithTan.
	 */
	async sepaTransfer(input: {
		accountNumber: string;
		debtorName: string;
		creditorName: string;
		creditorIban: string;
		creditorBic?: string;
		amount: number;
		purpose?: string;
		endToEndId?: string;
		instant?: boolean;
		// When set, this is the approval step (HKVPA) after the user confirmed VoP.
		vopId?: string;
		// The exact pain.001 from the initial step, re-sent verbatim on approval.
		painMessage?: string;
	}): Promise<TransferResponse> {
		const instant = input.instant ?? false;
		const account = this.config.getBankAccount(input.accountNumber);
		if (!account.iban) {
			throw Error(`Account ${input.accountNumber} has no IBAN; cannot transfer.`);
		}
		const painDescriptor = pickSepaDescriptor(this.getSupportedSepaFormats());
		const painMessage =
			input.painMessage ??
			buildSepaTransferMessage({
				painDescriptor,
				debtorName: input.debtorName,
				debtorIban: account.iban,
				debtorBic: account.bic,
				creditorName: input.creditorName,
				creditorIban: input.creditorIban,
				creditorBic: input.creditorBic,
				amount: input.amount,
				purpose: input.purpose,
				endToEndId: input.endToEndId,
			});
		const reportDescriptor = this.getVopReportFormat();

		let response = (await this.startCustomerOrderInteraction(
			new TransferInteraction({
				accountNumber: input.accountNumber,
				painMessage,
				painDescriptor,
				instant,
				vopReportDescriptor: reportDescriptor,
				vopId: input.vopId,
			}),
		)) as TransferResponse;

		// The approval step is not polled; return its result (usually requiresTan).
		if (input.vopId) {
			response.painMessage = painMessage;
			return response;
		}

		// Asynchronous VoP: the bank returns a pollingId and asks to poll again
		// until the actual check result is available.
		let guard = 0;
		while (response.vop?.pollingId && !response.vop.result && guard++ < 30) {
			const wait = response.vop.waitForSeconds ?? 2;
			await new Promise((resolve) => setTimeout(resolve, Math.max(1, wait) * 1000));
			response = (await this.startCustomerOrderInteraction(
				new VopPollInteraction(
					response.vop.pollingId,
					response.vop.aufsetzpunkt,
					reportDescriptor ?? painDescriptor,
				),
			)) as TransferResponse;
		}
		response.painMessage = painMessage;
		return response;
	}

	/**
	 * Continues a SEPA transfer (approval step) that required a TAN.
	 */
	async sepaTransferWithTan(tanReference: string, tan?: string): Promise<TransferResponse> {
		return (await this.continueCustomerInteractionWithTan(
			[HKCCS.Id, HKIPZ.Id],
			tanReference,
			tan,
		)) as TransferResponse;
	}

	/**
	 * Whether the account supports a SEPA collective (batch) transfer — HKCCM, or
	 * HKIPM when instant. A batch is authorised with a single strong authentication.
	 */
	canCollectiveTransfer(accountNumber: string, instant = false): boolean {
		return this.config.isAccountTransactionSupported(accountNumber, instant ? HKIPM.Id : HKCCM.Id);
	}

	/**
	 * Initiates a SEPA collective (batch) transfer — one order with multiple
	 * payments, authorised by a single TAN. When the bank offers Verification of
	 * Payee, an HKVPP name check is sent with the batch and the (possibly async)
	 * result is returned in response.vop; the approval is then re-sent with vopId.
	 * Continued via sepaCollectiveTransferWithTan.
	 */
	async sepaCollectiveTransfer(input: {
		accountNumber: string;
		debtorName: string;
		payments: SepaPayment[];
		instant?: boolean;
		// N = one collective (Sammel) booking, J = each payment booked individually.
		singleBooking?: boolean;
		// When set, this is the approval step (HKVPA) after the user confirmed VoP.
		vopId?: string;
		// The exact pain.001 from the initial step, re-sent verbatim on approval.
		painMessage?: string;
	}): Promise<TransferResponse> {
		const instant = input.instant ?? false;
		if (input.payments.length === 0) {
			throw Error('A collective transfer needs at least one payment.');
		}
		const account = this.config.getBankAccount(input.accountNumber);
		if (!account.iban) {
			throw Error(`Account ${input.accountNumber} has no IBAN; cannot transfer.`);
		}
		const singleBooking = input.singleBooking ?? true;
		const painDescriptor = pickSepaDescriptor(this.getSupportedSepaFormats());
		const painMessage =
			input.painMessage ??
			buildSepaCollectiveTransferMessage({
				painDescriptor,
				debtorName: input.debtorName,
				debtorIban: account.iban,
				debtorBic: account.bic,
				payments: input.payments,
				singleBooking,
			});
		// Only request VoP when the bank actually advertises it (HIVPPS); otherwise
		// submit the batch on its own.
		const reportDescriptor = this.getVopReportFormat();

		let response = (await this.startCustomerOrderInteraction(
			new CollectiveTransferInteraction({
				accountNumber: input.accountNumber,
				painMessage,
				painDescriptor,
				instant,
				sumAmount: { value: collectiveSum(input.payments), currency: 'EUR' },
				requestSingleBooking: singleBooking,
				vopReportDescriptor: reportDescriptor,
				vopId: input.vopId,
			}),
		)) as TransferResponse;

		// The approval step is not polled; return its result (usually requiresTan).
		if (input.vopId) {
			response.painMessage = painMessage;
			return response;
		}

		// Asynchronous VoP: the bank returns a pollingId and asks to poll again
		// until the actual check result is available.
		let guard = 0;
		while (response.vop?.pollingId && !response.vop.result && guard++ < 30) {
			const wait = response.vop.waitForSeconds ?? 2;
			await new Promise((resolve) => setTimeout(resolve, Math.max(1, wait) * 1000));
			response = (await this.startCustomerOrderInteraction(
				new VopPollInteraction(
					response.vop.pollingId,
					response.vop.aufsetzpunkt,
					reportDescriptor ?? painDescriptor,
				),
			)) as TransferResponse;
		}
		response.painMessage = painMessage;
		return response;
	}

	/**
	 * Continues an instant SEPA collective transfer (HKIPM) that required a TAN.
	 * For a non-instant collective transfer use sepaTransferWithTan.
	 */
	async sepaCollectiveTransferWithTan(
		tanReference: string,
		tan?: string,
	): Promise<TransferResponse> {
		return (await this.continueCustomerInteractionWithTan(
			[HKCCM.Id, HKIPM.Id],
			tanReference,
			tan,
		)) as TransferResponse;
	}

	/**
	 * Whether the account may submit a SEPA single direct debit (HKDSE).
	 */
	canDirectDebit(accountNumber: string): boolean {
		return this.config.isAccountTransactionSupported(accountNumber, HKDSE.Id);
	}

	/**
	 * Whether the account may submit a SEPA collective direct debit (HKDME).
	 */
	canCollectiveDirectDebit(accountNumber: string): boolean {
		return this.config.isAccountTransactionSupported(accountNumber, HKDME.Id);
	}

	/**
	 * Submits a SEPA direct debit (Lastschrifteinzug) — the account holder pulls
	 * money from one or more debtors. With more than one debtor a collective
	 * order (HKDME) is used, otherwise a single one (HKDSE). Continued via
	 * sepaDirectDebitWithTan.
	 */
	async sepaDirectDebit(input: {
		accountNumber: string;
		creditorId: string;
		sequenceType: SepaSequenceType;
		localInstrument: SepaLocalInstrument;
		requestedCollectionDate: string;
		payments: SepaDebitPayment[];
		// N = each collection booked individually, one collective credit else.
		singleBooking?: boolean;
	}): Promise<ClientResponse> {
		if (input.payments.length === 0) {
			throw Error('A direct debit needs at least one payment.');
		}
		const account = this.config.getBankAccount(input.accountNumber);
		if (!account.iban) {
			throw Error(`Account ${input.accountNumber} has no IBAN; cannot collect.`);
		}
		const collective = input.payments.length > 1;
		const singleBooking = input.singleBooking ?? true;
		const painDescriptor = pickSepaDebitDescriptor(this.getSupportedSepaFormats());
		const painMessage = buildSepaDirectDebitMessage({
			painDescriptor,
			creditorName: account.holder1 ?? account.iban,
			creditorIban: account.iban,
			creditorBic: account.bic,
			creditorId: input.creditorId,
			sequenceType: input.sequenceType,
			localInstrument: input.localInstrument,
			requestedCollectionDate: input.requestedCollectionDate,
			payments: input.payments,
			singleBooking,
		});

		if (collective) {
			return await this.startCustomerOrderInteraction(
				new CollectiveDirectDebitInteraction({
					accountNumber: input.accountNumber,
					painMessage,
					painDescriptor,
					sumAmount: { value: collectiveSum(input.payments), currency: 'EUR' },
					requestSingleBooking: singleBooking,
				}),
			);
		}
		return await this.startCustomerOrderInteraction(
			new DirectDebitInteraction({
				accountNumber: input.accountNumber,
				painMessage,
				painDescriptor,
			}),
		);
	}

	/**
	 * Continues a SEPA direct debit (single HKDSE or collective HKDME) that
	 * required a TAN.
	 */
	async sepaDirectDebitWithTan(tanReference: string, tan?: string): Promise<ClientResponse> {
		return await this.continueCustomerInteractionWithTan([HKDSE.Id, HKDME.Id], tanReference, tan);
	}

	/**
	 * Submits an already-built pain.008 (SEPA direct debit) verbatim — the caller
	 * provides the exact XML that was generated and reviewed elsewhere. The pain
	 * descriptor is derived from the XML's own namespace and validated against the
	 * bank's advertised formats. One transaction → HKDSE, several → HKDME.
	 */
	async submitSepaDirectDebitXml(input: {
		accountNumber: string;
		painMessage: string;
		singleBooking?: boolean;
	}): Promise<ClientResponse> {
		const version = parsePain008Namespace(input.painMessage); // e.g. pain.008.001.02
		const supported = this.getSupportedSepaFormats();
		const painDescriptor = supported.find((f) => f.includes(version));
		if (!painDescriptor) {
			throw new Error(
				`Bank does not support ${version}; advertised: ${supported.join(', ') || 'none'}.`,
			);
		}
		const count = countDirectDebitTx(input.painMessage);
		if (count === 0) throw new Error('The pain.008 contains no direct-debit transactions.');
		const account = this.config.getBankAccount(input.accountNumber);
		if (!account.iban) {
			throw Error(`Account ${input.accountNumber} has no IBAN; cannot collect.`);
		}
		const singleBooking = input.singleBooking ?? true;

		if (count > 1) {
			const { value, currency } = sumInstructedAmount(input.painMessage);
			return await this.startCustomerOrderInteraction(
				new CollectiveDirectDebitInteraction({
					accountNumber: input.accountNumber,
					painMessage: input.painMessage,
					painDescriptor,
					sumAmount: { value, currency },
					requestSingleBooking: singleBooking,
				}),
			);
		}
		return await this.startCustomerOrderInteraction(
			new DirectDebitInteraction({
				accountNumber: input.accountNumber,
				painMessage: input.painMessage,
				painDescriptor,
			}),
		);
	}

	/**
	 * Continues a submitSepaDirectDebitXml order (single HKDSE or collective
	 * HKDME) that required a TAN.
	 */
	async submitSepaDirectDebitXmlWithTan(
		tanReference: string,
		tan?: string,
	): Promise<ClientResponse> {
		return await this.continueCustomerInteractionWithTan([HKDSE.Id, HKDME.Id], tanReference, tan);
	}

	/**
	 * Synchronizes information with the bank, updating config.bankingInformation
	 * @returns the synchronization response
	 */
	async synchronize(): Promise<SynchronizeResponse> {
		this.currentDialog = new Dialog(this.config, true);
		const responses = await this.currentDialog.start();
		return responses.get(HKIDN.Id) as SynchronizeResponse;
	}

	/**
	 * Continues the synchronization transaction when a TAN is required
	 * @param tanReference The TAN reference provided in the first call's response
	 * @param tan The TAN entered by the user, can be omitted if a decoupled TAN method is used
	 * @returns the synchronization response
	 */
	async synchronizeWithTan(tanReference: string, tan?: string): Promise<SynchronizeResponse> {
		return await this.continueCustomerInteractionWithTan([HKIDN.Id], tanReference, tan);
	}

	/**
	 * Checks if the bank supports fetching an account balance in general or for the given account number when provided
	 * @param accountNumber when the account number is provided, checks if the account supports fetching the balance
	 * @returns true if the bank (and account) supports fetching the account balance
	 */
	canGetAccountBalance(accountNumber?: string): boolean {
		return accountNumber
			? this.config.isAccountTransactionSupported(accountNumber, HKSAL.Id)
			: this.config.isTransactionSupported(HKSAL.Id);
	}

	/**
	 * Fetches the account balance for the given account number
	 * @param accountNumber - the account number to fetch the balance for, must be an account available in the config.baningInformation.UPD.accounts
	 * @returns the account balance response
	 */
	async getAccountBalance(accountNumber: string): Promise<AccountBalanceResponse> {
		const response = await this.startCustomerOrderInteraction(
			new BalanceInteraction(accountNumber),
		);
		return response as AccountBalanceResponse;
	}

	/**
	 * Continues the account balance fetching when a TAN is required
	 * @param tanReference The TAN reference provided in the first call's response
	 * @param tan The TAN entered by the user, can be omitted if a decoupled TAN method is used
	 * @returns the account balance response
	 */
	async getAccountBalanceWithTan(
		tanReference: string,
		tan?: string,
	): Promise<AccountBalanceResponse> {
		return (await this.continueCustomerInteractionWithTan(
			[HKSAL.Id],
			tanReference,
			tan,
		)) as AccountBalanceResponse;
	}

	/**
	 * Checks if the bank supports fetching account statements in general or for the given account number when provided
	 * @param accountNumber when the account number is provided, checks if the account supports fetching of statements
	 * @returns true if the bank (and account) supports fetching account statements
	 */
	canGetAccountStatements(accountNumber?: string): boolean {
		if (accountNumber) {
			// Check if either CAMT or MT940 is supported for this account
			return (
				this.config.isAccountTransactionSupported(accountNumber, HKCAZ.Id) ||
				this.config.isAccountTransactionSupported(accountNumber, HKKAZ.Id)
			);
		} else {
			// Check if either CAMT or MT940 is supported by the bank
			return (
				this.config.isTransactionSupported(HKCAZ.Id) || this.config.isTransactionSupported(HKKAZ.Id)
			);
		}
	}

	/**
	 * Fetches the account statements for the given account number
	 * @param accountNumber - the account number to fetch the statements for, must be an account available in the config.baningInformation.UPD.accounts
	 * @param from - an optional start date of the period to fetch the statements for
	 * @param to - an optional end date of the period to fetch the statements for
	 * @param preferCamt - whether to prefer CAMT format over MT940 when both are supported (default: true)
	 * @returns an account statements response containing an array of statements
	 */
	async getAccountStatements(
		accountNumber: string,
		from?: Date,
		to?: Date,
		preferCamt: boolean = true,
	): Promise<StatementResponse> {
		// Check what formats the bank supports
		const camtSupported = this.config.isAccountTransactionSupported(accountNumber, 'HKCAZ');
		const mt940Supported = this.config.isAccountTransactionSupported(accountNumber, 'HKKAZ');

		if (!camtSupported && !mt940Supported) {
			throw Error(`Account ${accountNumber} does not support account statements`);
		}

		// Choose format based on support and preference
		const useCAMT = (preferCamt && camtSupported) || (!mt940Supported && camtSupported);

		if (useCAMT) {
			return (await this.startCustomerOrderInteraction(
				new StatementInteractionCAMT(accountNumber, from, to),
			)) as StatementResponse;
		} else {
			return (await this.startCustomerOrderInteraction(
				new StatementInteractionMT940(accountNumber, from, to),
			)) as StatementResponse;
		}
	}

	/**
	 * Continues the account statements fetching when a TAN is required
	 * @param tanReference The TAN reference provided in the first call's response
	 * @param tan The TAN entered by the user, can be omitted if a decoupled TAN method is used
	 * @returns an account statements response containing an array of statements
	 */
	async getAccountStatementsWithTan(
		tanReference: string,
		tan?: string,
	): Promise<StatementResponse> {
		return (await this.continueCustomerInteractionWithTan(
			[HKCAZ.Id, HKKAZ.Id],
			tanReference,
			tan,
		)) as StatementResponse;
	}

	/**
	 * Checks if the bank supports fetching portfolio information in general or for the given account number when provided
	 * @param accountNumber when the account number is provided, checks if the account supports fetching of portfolio information
	 * @returns true if the bank (and account) supports fetching portfolio information
	 */
	canGetPortfolio(accountNumber?: string): boolean {
		return accountNumber
			? this.config.isAccountTransactionSupported(accountNumber, HKWPD.Id)
			: this.config.isTransactionSupported(HKWPD.Id);
	}

	/**
	 * Fetches the portfolio information for the given depot account number
	 * @param accountNumber - the depot account number to fetch the portfolio for, must be an account available in the config.bankingInformation.UPD.accounts
	 * @param currency - optional currency filter for the portfolio statement
	 * @param priceQuality - optional price quality filter ('1' for real-time, '2' for delayed)
	 * @param maxEntries - optional maximum number of entries to retrieve
	 * @returns a portfolio response containing holdings and total value
	 */
	async getPortfolio(
		accountNumber: string,
		currency?: string,
		priceQuality?: '1' | '2',
		maxEntries?: number,
	): Promise<PortfolioResponse> {
		return (await this.startCustomerOrderInteraction(
			new PortfolioInteraction(accountNumber, currency, priceQuality, maxEntries),
		)) as PortfolioResponse;
	}

	/**
	 * Continues the portfolio fetching when a TAN is required
	 * @param tanReference The TAN reference provided in the first call's response

	 * @param tan The TAN entered by the user, can be omitted if a decoupled TAN method is used
	 * @returns a portfolio response containing holdings and total value
	 */
	async getPortfolioWithTan(tanReference: string, tan?: string): Promise<PortfolioResponse> {
		return (await this.continueCustomerInteractionWithTan(
			[HKWPD.Id],
			tanReference,
			tan,
		)) as PortfolioResponse;
	}

	/**
	 * Checks if the bank supports fetching credit card statements in general or for the given account number
	 * @param accountNumber when the account number is provided, checks if the account supports fetching of statements
	 * @returns true if the bank (and account) supports fetching credit card statements
	 */
	canGetCreditCardStatements(accountNumber?: string): boolean {
		return accountNumber
			? this.config.isAccountTransactionSupported(accountNumber, DKKKU.Id)
			: this.config.isTransactionSupported(DKKKU.Id);
	}

	/**
	 * Fetches the credit card statements for the given account number
	 * @param accountNumber - the account number to fetch the statements for, must be a credit card account available
	 * in the config.baningInformation.UPD.accounts
	 * @param from - an optional start date of the period to fetch the statements for
	 * @param to - an optional end date of the period to fetch the statements for
	 * @returns an account statements response containing an array of statements
	 */
	async getCreditCardStatements(accountNumber: string, from?: Date): Promise<StatementResponse> {
		return (await this.startCustomerOrderInteraction(
			new CreditCardStatementInteraction(accountNumber, from),
		)) as StatementResponse;
	}

	/**
	 * Continues the credit card statements fetching when a TAN is required
	 * @param tanReference The TAN reference provided in the first call's response
	 * @param tan The TAN entered by the user, can be omitted if a decoupled TAN method is used
	 * @returns a credit card statements response containing an array of statements
	 */
	async getCreditCardStatementsWithTan(
		tanReference: string,
		tan?: string,
	): Promise<StatementResponse> {
		return (await this.continueCustomerInteractionWithTan(
			[DKKKU.Id],
			tanReference,
			tan,
		)) as StatementResponse;
	}

	private async startCustomerOrderInteraction(
		interaction: CustomerOrderInteraction,
	): Promise<ClientResponse> {
		this.currentDialog = new Dialog(this.config, false);
		this.currentDialog.addCustomerInteraction(interaction);
		const responses = await this.currentDialog.start();

		const response = responses.get(interaction.segId);
		if (response) {
			return response;
		} else {
			const lastResponse = [...responses.values()].at(-1);
			if (lastResponse) {
				return lastResponse;
			} else {
				throw new Error(
					`No response received for customer interaction with segment ID '${interaction.segId}'`,
				);
			}
		}
	}

	private async continueCustomerInteractionWithTan(
		segIds: string[],
		tanReference: string,
		tan?: string,
	): Promise<ClientResponse> {
		if (!this.currentDialog) {
			throw new Error('no customer dialog was started which can continue');
		}

		const responses = await this.currentDialog.continue(tanReference, tan);

		for (const segId of segIds) {
			const response = responses.get(segId);
			if (response) {
				return response;
			}
		}

		const lastResponse = [...responses.values()].at(-1);
		if (lastResponse) {
			return lastResponse;
		} else {
			throw new Error(
				`No response received for customer interaction with segment IDs '${segIds.join(', ')}'`,
			);
		}
	}
}
