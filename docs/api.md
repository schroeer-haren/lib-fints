# API Guide

This guide covers the more detailed parts of the API beyond the basic [Getting Started](getting-started.md) walkthrough.

## Handle TAN challenges from the bank

Most transactions may require authorization with a two step TAN process. As mentioned in the sample, every response may set the `requiresTan` property to `true` which means that the response does not include the expected transaction data, but some additional TAN related properties. You first need to handle this TAN challenge by asking the user for the TAN and sending it back to the bank to continue the process and retrieve the actual transaction result:

```typescript
// we use the node readline interface later to ask the user for a TAN
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

let response = await client.getAccountStatements(account.accountNumber);

if (!response.success) {
  return;
}

// need to check if a TAN is required to continue the transaction
if (response.requiresTan) {
  // asking the user for the TAN, using the tanChallenge property
  const tan = await rl.question(response.tanChallenge + ': ');
  // continue the transaction by providing the tanReference from the response and the entered TAN
  response = await client.getAccountStatementsWithTan(response.tanReference!, tan);
}
```

The `FinTSClient` contains for every transaction method like `synchronize()` or `getAccountStatements()` a corresponding `...WithTan()` method which needs to be called to continue the transaction with the given `tanReference` returned in the first response. The response object of this second call should now contain all transaction related data, assuming `success=true`.

**Decoupled TAN methods**

The library now also supports decoupled TAN methods where you don't actually have to provide a TAN entered by a user, but the approval is done "decoupled" on another device (e.g. mobile phone via banking app). The procedure explained above is still very similar, `requiresTan` will signal a required approval and you can continue with one of the `...WithTan()` methods where you can ommit the last `tan` parameter.

You could ask the user to confirm that the approval was given and then continue with the call or periodically call the method until it returns the transaction result (`requiresTan=false` and `success=true`). The continuation methods will keep returning `requiresTan=true` as long as the user hasn't approved the transaction.

see also the `decoupled` property on the `TanMethod` object for related parameters given by the bank.

## Starting a session from saved banking information

As mentioned earlier there is a second way to initialize the `FinTSClient` with a `FinTSConfig` when you already performed a synchronization in a previous session and this is by providing the `bankingInformation` object received from previous uses. This `bankingInformation` object, which contains the general bank (BPD) and accounts information (UPD), should be persisted after a session and reloaded in the next session.
This not only saves you from making the same synchronization requests every time before making a transaction, but the sychronization will also assign a `systemId` (a property in `bankingInformation`) to your client which should stay the same once assigned.

```typescript
const config = FinTSConfig.fromBankingInformation(
  productId,
  productVersion,
  bankingInformation,
  userId,
  pin,
  tanMethodId,
  tanMediaName // when also needed (see below)
);
const client = new FinTSClient(config);
```

You should also set the TAN method to use, by using the optional `tanMethodId` and `tanMediaName` parameters or calling `client.selectTanMethod()` before making the first transaction.

### Tan Media

It might be the case that you have more than one active TAN media available (like multiple mobile phones) and the bank requires you to also specify which TAN media to use.
You can find out if this is the case by inspecting the `TanMethod` object in the BPD.
You can get a list of all available TAN methods from the `config.availableTanMethods` property or if you already selected a TAN method with `config.selectedTanMethod`.

```typescript
export type TanMethod = {
  id: number;
  name: string;
  version: number;
  activeTanMediaCount: number;
  activeTanMedia: string[];
  tanMediaRequirement: TanMediaRequirement;
};
```

The `TanMethod` object contains a property `tanMediaRequirement` and if this is set to `TanMediaRequirement.Required`, you also need to select a TAN media, either by providing the name in the configuration factory method `FinTSConfig.fromBankingInformation()` or by using `client.selectTanMedia()`.

The property `activeTanMedia` contains a list of the TAN media names you can use for selection.

If the media list is not already populated from the synchronization, you can query it explicitly (segment HKTAB) after a `synchronize()`:

```typescript
const mediaNames = await client.getTanMedia(); // string[]
```

This also fills `activeTanMedia` on the selected TAN method. Use `client.canGetTanMedia()` to check whether the bank supports it.

### Banking Information may be updated any time

The `bankingInformation` is primarily obtained through the `synchronize()` calls as demonstrated above. However, it is possible that the banking information may have changed since the last synchronization call. To address this, the BPD and UPD are versioned, and with every transaction made, not just synchronizations, the currently used versions are provided to the bank. If any changes have occurred, the bank will send back new versions of the BPD and UPD respectively. This process is managed by the client, but it is essential to check the `bankingInformationUpdated` property, which is available in every response. This property indicates if there have been any changes, and it is important to persist the new version for future sessions. The most up-to-date version of the `bankingInformation` object can always be retrieved using `config.bankingInformation`.

## Debugging

If you need to debug issues and the `response.bankAnswers` don't provide enough information, you can enable debugging of messages with:

```typescript
config.debugEnabled = true;
```

This will print out all sent messages and received responses to the console in a structured format.
