# Getting Started

These instructions will show you how to install the library on your local machine and give a quick sample of how to use it.

## Prerequisites

### Product Registration

In order to communicate with banks via the FinTS protocol you have to register a product ID with the german banking industry (Deutsche Kreditwirtschaft) which you need to pass as part of the configuration to the client:

> In order to fulfill the PSD2 requirements regarding transparency about the software used by customers, the German Banking Industry has established a process for registering FinTS products in order to be able to provide customers with information regarding FinTS usage.
> FinTS product registration is currently offered free of charge by the German Banking Industry.

[ZKA Registration Website](https://www.fints.org/de/hersteller/produktregistrierung)

### Runtime Environment

The library is written in Typescript and compiled to the ES2022 Javascript language standard which means a minimum Node version of 18 is required.

**A note about Browsers:**
In theory the library is compatible with a browser environment, but communicating directly from the front-end with a bank server will, apart from security considerations, most likely fail because of the imposed CORS restrictions from web browsers and the lack of corresponding CORS headers in bank server responses.

## Installing

Installation is straight forward by simply adding the npm package.

```
npm i lib-fints
```

**Dependencies**: The library includes the `fast-xml-parser` package for robust CAMT statement parsing but has no other runtime dependencies.

## Sample Usage

The main public API of this library is the `FinTSClient` class and `FinTSConfig` class. In order to instantiate the client you need to provide a configuration instance. There are basically two ways to initialize a configuration object, one is when you communicate with a bank for the first time and the other when you already have banking information from a prevous session available (more on that later).

If you don't have any previous banking information available you can use the static `forFirstTimeUse()` factory method like this:

```typescript
const config = FinTSConfig.forFirstTimeUse(productId, productVersion, bankUrl, bankId, userId, pin);

const client = new FinTSClient(config);
```

Then you should first make a synchronization call to get banking and account information:

```typescript
let syncResponse = await client.synchronize();
```

you should always check the `success` and `requiresTan` properties of any response object because other data might only be available when `success=true` and `requiresTan=false`.
in any case you can also check the `bankAnswers` array for return messages from the bank which may contain the reasons for a failed request.

If the call is successfull the response will contain a `bankingInformation` object filled with all the relevant information provided by the bank from synchronization:

```typescript
export type BankingInformation = {
  systemId: string;
  bpd?: BPD;
  upd?: UPD;
  bankMessages: BankMessage[];
};
```

The BPD object (_BankParameterDaten_) contains general information (e.g. available TAN methods and allowed transactions) and the UPD object (_UserParameterDaten_) user-specific information which is mainly the list of the user's bank accounts.

Unfortunately with this first synchronization call most banks will likely only return the BPA information but no UPD (accounts) information, which is needed to fetch balances or statements. The reason for this is that you need to specify a TAN method before making the synchronization call, but you can only know which TAN methods are available from the BPA? This is why you need to make a second synchronization call with a TAN method selected from the `availableTanMethodIds`in the BPA, returned from the first synchronization call:

```typescript
// for simplicity, we just select the first available TAN method
client.selectTanMethod(syncResponse.bankingInformation.BPD.availableTanMethodIds[0]);
```

now you can repeat the syncronization call from above and it will return additional data including the UPD with the account information.

Finally you can start fetching balances or statements:

```typescript
// for simplicity, use the first account
const account = syncResponse.bankingInformation.upd.bankAccounts[0];

// fetch the current balance
const balanceResponse = await client.getAccountBalance(account.accountNumber);

// fetch all available statements
const statementResponse = await client.getAccountStatements(account.accountNumber);

// or fetch portfolio from a securities account
client.getPortfolio(account.accountNumber);
```

These are only the most basic steps needed to retrieve information from the bank. There are still some unanswered questions like "how to handle TANs" or "how to avoid synchronizations every time you start a new session". These are explained in the [API Guide](api.md).
