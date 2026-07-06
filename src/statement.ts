export interface Statement {
	transactionReference?: string;
	relatedReference?: string;
	account?: string;
	number?: string;
	// A noted/pending (Vormerkposten) CAMT report carries entries but no
	// balance, so these may be undefined. Balance-dependent code must guard.
	openingBalance?: Balance;
	transactions: Transaction[];
	closingBalance?: Balance;
	availableBalance?: Balance;
	forwardBalances?: Balance[];
}

export interface Transaction {
	valueDate: Date;
	entryDate: Date;
	fundsCode: string;
	amount: number;
	transactionType: string;
	customerReference: string;
	bankReference: string;
	transactionCode?: string;
	bookingText?: string;
	primeNotesNr?: string;
	purpose?: string;
	remoteBankId?: string;
	remoteAccountNumber?: string;
	remoteName?: string;
	remoteIdentifier?: string;
	client?: string;
	e2eReference?: string;
	mandateReference?: string;
	textKeyExtension?: string;
	additionalInformation?: string;
	// True for noted/pending entries (Vormerkposten) that are not yet booked.
	pending?: boolean;
	// For a collective (batch) booking (Sammelbuchung): the individual underlying
	// payments (camt NtryDtls/TxDtls), each with its own amount, counterparty and
	// EndToEndId. Empty/undefined for a normal single booking.
	subTransactions?: Transaction[];
}

export interface Balance {
	date: Date;
	currency: string;
	value: number;
}
