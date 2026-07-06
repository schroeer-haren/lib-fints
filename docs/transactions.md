# Supported Transactions

The following table shows all transactions supported by the `FinTSClient` interface:

| Transaction                | Method                                                               | Description                                                                     | FinTS Segment(s)           | TAN Support | Account-Specific |
| -------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------- | ----------- | ---------------- |
| **Synchronization**        | `synchronize()`                                                      | Synchronizes bank and account information, updating config.bankingInformation   | HKIDN, HKVVB, HKSYN, HKTAB | ✓           | ❌               |
| **Account Balance**        | `getAccountBalance(accountNumber)`                                   | Fetches the current balance for a specific account                              | HKSAL                      | ✓           | ✓                |
| **Account Statements**     | `getAccountStatements(accountNumber, from?, to?)`                    | Fetches account transactions/statements for a date range (MT940 or CAMT format) | HKKAZ, HKCAZ               | ✓           | ✓                |
| **Portfolio**              | `getPortfolio(accountNumber, currency?, priceQuality?, maxEntries?)` | Fetches securities portfolio information for depot accounts                     | HKWPD                      | ✓           | ✓                |
| **Credit Card Statements** | `getCreditCardStatements(accountNumber, from?)`                      | Fetches credit card statements for credit card accounts                         | DKKKU                      | ✓           | ✓                |
| **TAN Method Selection**   | `selectTanMethod(tanMethodId)`                                       | Selects a TAN method by ID from available methods                               | -                          | ❌          | ❌               |
| **TAN Media Selection**    | `selectTanMedia(tanMediaName)`                                       | Selects a specific TAN media device by name                                     | -                          | ❌          | ❌               |

## Transaction Support Checking

For each account-specific transaction, the client provides corresponding `can*` methods to check if the bank or specific account supports the transaction:

| Support Check Method                         | Purpose                                                         |
| -------------------------------------------- | --------------------------------------------------------------- |
| `canGetAccountBalance(accountNumber?)`       | Checks if account balance fetching is supported                 |
| `canGetAccountStatements(accountNumber?)`    | Checks if account statements fetching is supported (MT940/CAMT) |
| `canGetPortfolio(accountNumber?)`            | Checks if portfolio information fetching is supported           |
| `canGetCreditCardStatements(accountNumber?)` | Checks if credit card statements fetching is supported          |

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

The `tan` parameter can be omitted when using decoupled TAN methods.
