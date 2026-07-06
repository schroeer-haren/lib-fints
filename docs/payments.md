# SEPA Payments

This fork adds outgoing SEPA payments on top of the read-only transactions of the original library:

- **SEPA credit transfer** (single) – normal and instant/real-time
- **SEPA collective transfer** ("Sammelüberweisung") – many payments, one authorization
- **SEPA direct debit** ("Lastschrift") – single and collective
- **Verification of Payee (VoP)** – payee name matching before a transfer is executed

All payment methods use the same two-step **TAN pattern** as the read transactions: the first call returns a response with `requiresTan = true`, which you complete with the corresponding `...WithTan()` method (see the [API Guide](api.md#handle-tan-challenges-from-the-bank)). The `tan` parameter can be omitted for decoupled TAN methods.

Amounts are given in **EUR** as a `number`. IBAN/BIC of the debtor account are taken from the selected account – you only pass the counterparty details.

## Capability checks

Before offering a payment, check whether the bank/account supports it:

```typescript
client.canSepaTransfer(accountNumber);            // HKCCS
client.canSepaTransfer(accountNumber, true);      // instant, HKIPZ
client.canCollectiveTransfer(accountNumber);      // HKCCM
client.canCollectiveTransfer(accountNumber, true);// instant, HKIPM
client.canDirectDebit(accountNumber);             // single, HKDSE
client.canCollectiveDirectDebit(accountNumber);   // collective, HKDME

client.getSupportedSepaFormats(); // string[] of supported pain descriptors (from HISPAS)
client.getVopReportFormat();      // string | undefined – pain.002 report format for VoP, if supported
```

The library automatically picks a suitable `pain.00x` schema from the bank's supported formats (credit transfer: `pain.001.001.09`, falling back to `pain.001.001.03`; direct debit: `pain.008.001.02`, falling back to `pain.008.001.08`).

## SEPA credit transfer

```typescript
let response = await client.sepaTransfer({
  accountNumber,            // your (debtor) account
  debtorName: 'Alice Example',
  creditorName: 'Bob Merchant',
  creditorIban: 'DE02120300000000202051',
  creditorBic: 'BYLADEM1001', // optional
  amount: 12.34,              // EUR
  purpose: 'Invoice 2024-001',// optional
  endToEndId: 'INV-2024-001', // optional, defaults to NOTPROVIDED
  instant: false,             // true = real-time transfer (HKIPZ)
});

if (response.requiresTan) {
  const tan = await askUserForTan(response.tanChallenge);
  response = await client.sepaTransferWithTan(response.tanReference!, tan);
}
```

Set `instant: true` for a real-time transfer (SEPA Instant, segment HKIPZ) instead of the standard HKCCS.

## Collective transfer ("Sammelüberweisung")

Submit many payments in a single order authorized by one TAN. All payments are placed into one collective instruction (the bank rejects multiple collectors).

```typescript
let response = await client.sepaCollectiveTransfer({
  accountNumber,
  debtorName: 'Alice Example',
  payments: [
    { creditorName: 'Bob', creditorIban: 'DE02...', amount: 10.0, purpose: 'A' },
    { creditorName: 'Carol', creditorIban: 'DE03...', amount: 25.5, purpose: 'B' },
  ],
  singleBooking: true, // true = each payment shows as its own statement entry;
                       // false = one aggregate (Sammel) booking
  instant: false,      // true = instant collective (HKIPM)
});

if (response.requiresTan) {
  response = await client.sepaCollectiveTransferWithTan(response.tanReference!, tan);
}
```

Each entry of `payments` is a `SepaPayment`:

```typescript
type SepaPayment = {
  creditorName: string;
  creditorIban: string;
  creditorBic?: string;
  amount: number;   // EUR
  purpose?: string;
  endToEndId?: string;
};
```

## SEPA direct debit ("Lastschrift")

Collect money from one or more debtors. With more than one payment the library automatically uses the collective segment (HKDME) instead of the single one (HKDSE).

```typescript
let response = await client.sepaDirectDebit({
  accountNumber,                       // your (creditor) account
  creditorId: 'DE98ZZZ09999999999',    // Creditor Identifier / Gläubiger-ID
  sequenceType: 'RCUR',                // 'FRST' | 'RCUR' | 'OOFF' | 'FNAL'
  localInstrument: 'CORE',             // 'CORE' | 'B2B'
  requestedCollectionDate: '2024-06-01', // yyyy-MM-dd
  payments: [
    {
      debtorName: 'Bob Payer',
      debtorIban: 'DE02...',
      amount: 42.0,
      purpose: 'Membership 2024',
      mandateId: 'M-2024-0001',
      mandateSignatureDate: '2023-01-15', // yyyy-MM-dd
    },
  ],
  singleBooking: true,
});

if (response.requiresTan) {
  response = await client.sepaDirectDebitWithTan(response.tanReference!, tan);
}
```

Each entry of `payments` is a `SepaDebitPayment`:

```typescript
type SepaDebitPayment = {
  debtorName: string;
  debtorIban: string;
  debtorBic?: string;
  amount: number;   // EUR
  purpose?: string;
  endToEndId?: string;
  mandateId: string;            // mandate reference
  mandateSignatureDate: string; // yyyy-MM-dd
};
```

Direct debit produces a `pain.008.001.02` (or `.08`) message and does not support VoP or the instant flag.

## Verification of Payee (VoP)

For credit transfers, banks may offer Verification of Payee – a check that the creditor name matches the account holder of the target IBAN before the transfer is executed. The result is returned on the transfer response as `vop`:

```typescript
export type VopInfo = {
  result?: string; // match code, see below
  closeMatchName?: string;
  recipientIban?: string;
  otherIdentification?: string;
  naReason?: string;
  vopId?: string;
  manualAuthorizationNotice?: string;
  // For a batch check: transaction counts per status, e.g. { RCVC: 3, RVNM: 1 }
  statusCounts?: Record<string, number>;
};

export interface TransferResponse extends ClientResponse {
  vop?: VopInfo;
  // The exact pain.001 used, so the approval step can re-send it verbatim.
  painMessage?: string;
}
```

Match codes in `vop.result` (worst status wins for a batch):

| Code | Meaning |
| --- | --- |
| `RCVC` | full match |
| `PDNG` / `PNDG` | pending |
| `RVMC` / `RVCM` | close match (see `closeMatchName`) |
| `RVNA` | not available |
| `RVNM` | no match |

The check runs asynchronously; the library polls the bank internally until a final result is available. Once the user has reviewed the match, approve the transfer by calling the same method again with the `vopId` and the returned `painMessage`:

```typescript
let res = await client.sepaTransfer({ /* ...transfer input... */ });

// res.vop describes the payee match – show it to the user for confirmation
if (res.vop?.result === 'RVNM') {
  // no match – you may want to abort
}

// approve and actually place the order (HKVPA), re-sending the identical pain.001
res = await client.sepaTransfer({
  /* ...same transfer input..., */
  vopId: res.vop!.vopId,
  painMessage: res.painMessage,
});

if (res.requiresTan) {
  res = await client.sepaTransferWithTan(res.tanReference!, tan);
}
```

The same `vopId` / `painMessage` approval fields exist on `sepaCollectiveTransfer`.
