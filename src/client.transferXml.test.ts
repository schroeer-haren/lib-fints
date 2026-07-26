import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { AccountType } from './bankAccount.js';
import { FinTSClient } from './client.js';
import { Language } from './codes.js';
import { FinTSConfig } from './config.js';
import { Dialog } from './dialog.js';
import type { ClientResponse } from './interactions/customerInteraction.js';
import {
	CollectiveTransferInteraction,
	TransferInteraction,
} from './interactions/transferInteraction.js';

// A caller-supplied pain.001 in the OLDER of the two versions the bank below
// advertises. Before the descriptor was derived from the message, the client
// announced the newer .09 next to this .03 document and the bank rejected the
// whole message with "9010 Fehler beim Aufruf Parser".
const PAIN_001_003 = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03">
 <CstmrCdtTrfInitn><PmtInf>
  <CdtTrfTxInf><Amt><InstdAmt Ccy="EUR">42.00</InstdAmt></Amt></CdtTrfTxInf>
 </PmtInf></CstmrCdtTrfInitn></Document>`;

const PAIN_001_009 = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09">
 <CstmrCdtTrfInitn><PmtInf>
  <CdtTrfTxInf><Amt><InstdAmt Ccy="EUR">42.00</InstdAmt></Amt></CdtTrfTxInf>
 </PmtInf></CstmrCdtTrfInitn></Document>`;

const PAIN_001_UNSUPPORTED_VERSION = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.12">
 <CstmrCdtTrfInitn><PmtInf>
  <CdtTrfTxInf><Amt><InstdAmt Ccy="EUR">1.00</InstdAmt></Amt></CdtTrfTxInf>
 </PmtInf></CstmrCdtTrfInitn></Document>`;

function successResponse(): ClientResponse {
	return {
		dialogId: 'DIALOG1',
		success: true,
		requiresTan: false,
		bankingInformationUpdated: false,
		bankAnswers: [{ code: 20, text: 'Auftrag ausgeführt' }],
	};
}

describe('FinTSClient credit transfer — pain descriptor', () => {
	// Bank advertising BOTH pain.001 versions plus HKCCS/HKCCM, so the descriptor
	// is a real choice rather than the only option on offer.
	const client = new FinTSClient(
		FinTSConfig.fromBankingInformation('product', '1.0', {
			systemId: 'SYSTEM01',
			bpd: {
				version: 1,
				url: 'https://bank.example.com/fints',
				countryCode: 280,
				bankId: '10020030',
				bankName: 'Example Bank',
				allowedTransactions: [
					{
						transId: 'HKSPA',
						versions: [3],
						tanRequired: false,
						params: {
							individualAccountRetrievalAllowed: true,
							nationalAccountAllowed: true,
							structuredPurposeAllowed: true,
							supportedSepaFormats: [
								'urn:iso:std:iso:20022:tech:xsd:pain.001.001.03',
								'urn:iso:std:iso:20022:tech:xsd:pain.001.001.09',
								'urn:iso:std:iso:20022:tech:xsd:pain.008.001.02',
							],
						},
					},
					{ transId: 'HKCCS', versions: [1], tanRequired: true },
					{ transId: 'HKCCM', versions: [1], tanRequired: true },
				],
				maxTransactionsPerMessage: 1,
				supportedLanguages: [Language.German],
				supportedHbciVersions: [300],
				supportedTanMethods: [
					{
						id: 1,
						name: 'ChipTAN',
						version: 1,
						isDecoupled: false,
						activeTanMediaCount: 1,
						activeTanMedia: ['TAN-Generator 123'],
						tanMediaRequirement: 0,
					},
				],
				availableTanMethodIds: [1],
			},
			upd: {
				version: 1,
				usage: 0,
				bankAccounts: [
					{
						accountNumber: '1234567890',
						bank: { bankId: '10020030', country: 280 },
						iban: 'DE89370400440532013000',
						customerId: 'customer1',
						accountType: AccountType.CheckingAccount,
						currency: 'EUR',
						holder1: 'Test User',
						allowedTransactions: [
							{ transId: 'HKCCS', numSignatures: 1 },
							{ transId: 'HKCCM', numSignatures: 1 },
						],
					},
				],
			},
			bankMessages: [],
		}),
	);

	let dialogStartMock: MockInstance;
	let addCustomerInteractionSpy: MockInstance;

	beforeEach(() => {
		dialogStartMock = vi.spyOn(Dialog.prototype, 'start');
		addCustomerInteractionSpy = vi.spyOn(Dialog.prototype, 'addCustomerInteraction');
	});

	afterEach(() => {
		dialogStartMock.mockRestore();
		addCustomerInteractionSpy.mockRestore();
	});

	const transferInput = {
		accountNumber: '1234567890',
		debtorName: 'Test User',
		creditorName: 'Max Mustermann',
		creditorIban: 'DE40987654329876543210',
		amount: 42,
	};

	it('announces the version of the caller-supplied pain.001, not the newest one on offer', async () => {
		dialogStartMock.mockResolvedValueOnce(
			new Map<string, ClientResponse>([['HKCCS', successResponse()]]),
		);

		await client.sepaTransfer({ ...transferInput, painMessage: PAIN_001_003 });

		const submitted = addCustomerInteractionSpy.mock.calls[0][0];
		expect(submitted).toBeInstanceOf(TransferInteraction);
		// The bank also offers .09 — picking it here is exactly the bug.
		expect(submitted.params.painDescriptor).toBe('urn:iso:std:iso:20022:tech:xsd:pain.001.001.03');
		expect(submitted.params.painMessage).toBe(PAIN_001_003);
	});

	it('announces .09 when the caller supplies a .09 document', async () => {
		dialogStartMock.mockResolvedValueOnce(
			new Map<string, ClientResponse>([['HKCCS', successResponse()]]),
		);

		await client.sepaTransfer({ ...transferInput, painMessage: PAIN_001_009 });

		const submitted = addCustomerInteractionSpy.mock.calls[0][0];
		expect(submitted.params.painDescriptor).toBe('urn:iso:std:iso:20022:tech:xsd:pain.001.001.09');
	});

	it('picks the preferred version when it builds the message itself', async () => {
		dialogStartMock.mockResolvedValueOnce(
			new Map<string, ClientResponse>([['HKCCS', successResponse()]]),
		);

		await client.sepaTransfer(transferInput);

		const submitted = addCustomerInteractionSpy.mock.calls[0][0];
		// No caller message: the picked descriptor IS what gets built, so the
		// preference for the newer version stands.
		expect(submitted.params.painDescriptor).toBe('urn:iso:std:iso:20022:tech:xsd:pain.001.001.09');
		expect(submitted.params.painMessage).toContain('pain.001.001.09');
	});

	it('throws before starting a dialog when the bank does not advertise the version', async () => {
		await expect(
			client.sepaTransfer({ ...transferInput, painMessage: PAIN_001_UNSUPPORTED_VERSION }),
		).rejects.toThrow(/does not support pain\.001\.001\.12/);

		expect(dialogStartMock).not.toHaveBeenCalled();
		expect(addCustomerInteractionSpy).not.toHaveBeenCalled();
	});

	it('derives the descriptor for a collective transfer too', async () => {
		dialogStartMock.mockResolvedValueOnce(
			new Map<string, ClientResponse>([['HKCCM', successResponse()]]),
		);

		await client.sepaCollectiveTransfer({
			accountNumber: '1234567890',
			debtorName: 'Test User',
			payments: [
				{
					creditorName: 'Max Mustermann',
					creditorIban: 'DE40987654329876543210',
					amount: 42,
				},
			],
			painMessage: PAIN_001_003,
		});

		const submitted = addCustomerInteractionSpy.mock.calls[0][0];
		expect(submitted).toBeInstanceOf(CollectiveTransferInteraction);
		expect(submitted.params.painDescriptor).toBe('urn:iso:std:iso:20022:tech:xsd:pain.001.001.03');
	});
});
