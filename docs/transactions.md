# Supported Transactions

The following table shows all transactions supported by the `FinTSClient` interface:

| Transaction                | Method                                                               | Description                                                                     | FinTS Segment(s)           | TAN Support | Account-Specific |
| -------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------- | ----------- | ---------------- |
| **Synchronization**        | `synchronize()`                                                      | Synchronizes bank and account information, updating config.bankingInformation   | HKIDN, HKVVB, HKSYN, HKTAB | ✓           | ❌               |
| **Account Balance**        | `getAccountBalance(accountNumber)`                                   | Fetches the current balance for a specific account                              | HKSAL                      | ✓           | ✓                |
| **Account Statements**     | `getAccountStatements(accountNumber, from?, to?, preferCamt?)`       | Fetches account transactions/statements for a date range (MT940 or CAMT format) | HKKAZ, HKCAZ               | ✓           | ✓                |
| **Portfolio**              | `getPortfolio(accountNumber, currency?, priceQuality?, maxEntries?)` | Fetches securities portfolio information for depot accounts                     | HKWPD                      | ✓           | ✓                |
| **Credit Card Statements** | `getCreditCardStatements(accountNumber, from?)`                      | Fetches credit card statements for credit card accounts                         | DKKKU                      | ✓           | ✓                |
| **SEPA Credit Transfer**   | `sepaTransfer(input)`                                                | Sends a single SEPA credit transfer, normal or instant/real-time (see [Payments](payments.md)) | HKCCS, HKIPZ | ✓           | ✓                |
| **SEPA Collective Transfer** | `sepaCollectiveTransfer(input)`                                    | Sends a collective transfer ("Sammelüberweisung") authorized by one TAN         | HKCCM, HKIPM               | ✓           | ✓                |
| **SEPA Direct Debit**      | `sepaDirectDebit(input)`                                             | Collects a single or collective SEPA direct debit ("Lastschrift", pain.008)     | HKDSE, HKDME               | ✓           | ✓                |
| **TAN Media Query**        | `getTanMedia()`                                                     | Fetches the names of the user's registered TAN media/devices                    | HKTAB                      | ❌          | ❌               |
| **TAN Method Selection**   | `selectTanMethod(tanMethodId)`                                       | Selects a TAN method by ID from available methods                               | -                          | ❌          | ❌               |
| **TAN Media Selection**    | `selectTanMedia(tanMediaName)`                                       | Selects a specific TAN media device by name                                     | -                          | ❌          | ❌               |

SEPA payments (transfers, collective transfers, direct debits) and Verification of Payee are documented in detail in the [Payments guide](payments.md).

## Transaction Support Checking

For each account-specific transaction, the client provides corresponding `can*` methods to check if the bank or specific account supports the transaction:

| Support Check Method                         | Purpose                                                         |
| -------------------------------------------- | --------------------------------------------------------------- |
| `canGetAccountBalance(accountNumber?)`       | Checks if account balance fetching is supported                 |
| `canGetAccountStatements(accountNumber?)`    | Checks if account statements fetching is supported (MT940/CAMT) |
| `canGetPortfolio(accountNumber?)`            | Checks if portfolio information fetching is supported           |
| `canGetCreditCardStatements(accountNumber?)` | Checks if credit card statements fetching is supported          |
| `canSepaTransfer(accountNumber, instant?)`   | Checks if a SEPA credit transfer (or instant transfer) is supported |
| `canCollectiveTransfer(accountNumber, instant?)` | Checks if a SEPA collective transfer is supported          |
| `canDirectDebit(accountNumber)`              | Checks if a single SEPA direct debit is supported              |
| `canCollectiveDirectDebit(accountNumber)`    | Checks if a collective SEPA direct debit is supported          |
| `canGetTanMedia()`                           | Checks if querying registered TAN media is supported           |

## Transaction Parameters

The configuration object provides methods to access transaction-specific parameters and capabilities provided by the bank:

### `config.getTransactionParameters<T>(transId: string): T | undefined`

Returns the bank-specific parameters for a transaction type, if available. These parameters contain transaction limits, supported formats, and other bank-specific constraints.

```typescript
// Get parameters for account statements (MT940)
const mt940Params = config.getTransactionParameters<HIKAZSParameter>('HKKAZ');

// Get parameters for account statements (CAMT)
const camtParams = config.getTransactionParameters<HICAZSParameter>('HKCAZ');

// Get parameters for SEPA transactions
const sepaParams = config.getTransactionParameters<HISPASParameter>('HKSPA');
```

### `config.isTransactionSupported(transId: string): boolean`

Checks whether a specific transaction type is supported by the bank.

```typescript
if (config.isTransactionSupported('HKWPD')) {
  console.log('Bank supports portfolio requests');
}
```

### `config.isAccountTransactionSupported(accountNumber: string, transId: string): boolean`

Checks whether a specific transaction type is supported for a particular account.

```typescript
if (config.isAccountTransactionSupported('1234567890', 'HKWPD')) {
  console.log('Account supports portfolio requests');
}
```

**Note**: Transaction IDs correspond to the FinTS segment names (e.g., 'HKKAZ' for account statements, 'HKWPD' for portfolio, 'HKSAL' for balance).

## TAN Continuation Methods

Every transaction that supports TAN authentication has a corresponding `*WithTan` method for continuing the transaction after TAN entry:

- `synchronizeWithTan(tanReference, tan?)`
- `getAccountBalanceWithTan(tanReference, tan?)`
- `getAccountStatementsWithTan(tanReference, tan?)`
- `getPortfolioWithTan(tanReference, tan?)`
- `getCreditCardStatementsWithTan(tanReference, tan?)`
- `sepaTransferWithTan(tanReference, tan?)`
- `sepaCollectiveTransferWithTan(tanReference, tan?)`
- `sepaDirectDebitWithTan(tanReference, tan?)`

The `tan` parameter can be omitted when using decoupled TAN methods.

## Statement details

`getAccountStatements()` returns a flat `transactions: Transaction[]` list. Beyond the basic booked entries, this fork exposes:

- **Pending entries ("Vormerkposten")** – noted, not-yet-booked entries are folded into the same `transactions` list and marked with `transaction.pending === true` (the field is absent for booked entries). Works for both CAMT and MT940. Note that a pending-only report may carry no balances, so `openingBalance` / `closingBalance` / `availableBalance` on the `Statement` are optional and can be `undefined`.
- **Collective bookings ("Sammelbuchung")** – a batch booking appears as one `Transaction` with the total `amount` and a `transaction.subTransactions?: Transaction[]` array holding the individual payments (each with its own `amount`, `e2eReference`, `remoteName`, `remoteAccountNumber`, `purpose`, …), decoded from the CAMT `NtryDtls/TxDtls`. A normal single booking has no `subTransactions`.
- **Transparent pagination ("Aufsetzpunkt", return code 3040)** – when a bank caps the number of entries per response, the library automatically fetches the remaining pages within the same dialog and merges them. You get the full history from a single `getAccountStatements()` call with a single TAN – pagination is completely hidden.
