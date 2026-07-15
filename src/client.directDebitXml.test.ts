import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { AccountType } from './bankAccount.js';
import { FinTSClient } from './client.js';
import { Language } from './codes.js';
import { FinTSConfig } from './config.js';
import { Dialog } from './dialog.js';
import type { ClientResponse } from './interactions/customerInteraction.js';
import {
	CollectiveDirectDebitInteraction,
	DirectDebitInteraction,
} from './interactions/debitInteraction.js';

const PAIN_008_002_ONE_TX = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.008.001.02">
 <CstmrDrctDbtInitn><PmtInf>
  <DrctDbtTxInf><InstdAmt Ccy="EUR">42.00</InstdAmt></DrctDbtTxInf>
 </PmtInf></CstmrDrctDbtInitn></Document>`;

const PAIN_008_002_TWO_TX = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.008.001.02">
 <CstmrDrctDbtInitn><PmtInf>
  <DrctDbtTxInf><InstdAmt Ccy="EUR">10.00</InstdAmt></DrctDbtTxInf>
  <DrctDbtTxInf><InstdAmt Ccy="EUR">5.50</InstdAmt></DrctDbtTxInf>
 </PmtInf></CstmrDrctDbtInitn></Document>`;

const PAIN_008_UNSUPPORTED_VERSION = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.008.001.08">
 <CstmrDrctDbtInitn><PmtInf>
  <DrctDbtTxInf><InstdAmt Ccy="EUR">1.00</InstdAmt></DrctDbtTxInf>
 </PmtInf></CstmrDrctDbtInitn></Document>`;

function successResponse(): ClientResponse {
	return {
		dialogId: 'DIALOG1',
		success: true,
		requiresTan: false,
		bankingInformationUpdated: false,
		bankAnswers: [{ code: 20, text: 'Auftrag ausgeführt' }],
	};
}

describe('FinTSClient.submitSepaDirectDebitXml', () => {
	// Local fixture: unlike the shared bpd fixture in src/tests/client.test.ts
	// (which lacks HKDSE/HKDME), this bank advertises both direct-debit
	// transactions plus a supportedSepaFormats entry for pain.008.001.02 (HKSPA).
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
								'urn:iso:std:iso:20022:tech:xsd:pain.008.001.02',
								'urn:iso:std:iso:20022:tech:xsd:pain.001.001.03',
							],
						},
					},
					{ transId: 'HKDSE', versions: [2], tanRequired: true },
					{ transId: 'HKDME', versions: [2], tanRequired: true },
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
						bank: {
							bankId: '10020030',
							country: 280,
						},
						iban: 'DE89370400440532013000',
						customerId: 'customer1',
						accountType: AccountType.CheckingAccount,
						currency: 'EUR',
						holder1: 'Test User',
						allowedTransactions: [
							{ transId: 'HKDSE', numSignatures: 1 },
							{ transId: 'HKDME', numSignatures: 1 },
						],
					},
				],
			},
			bankMessages: [],
		}),
	);

	let dialogStartMock: MockInstance;
	let dialogContinueMock: MockInstance;
	let addCustomerInteractionSpy: MockInstance;

	beforeEach(() => {
		dialogStartMock = vi.spyOn(Dialog.prototype, 'start');
		dialogContinueMock = vi.spyOn(Dialog.prototype, 'continue');
		addCustomerInteractionSpy = vi.spyOn(Dialog.prototype, 'addCustomerInteraction');
	});

	afterEach(() => {
		dialogStartMock.mockRestore();
		dialogContinueMock.mockRestore();
		addCustomerInteractionSpy.mockRestore();
	});

	it('routes a two-transaction pain.008 to the collective direct debit (HKDME)', async () => {
		dialogStartMock.mockResolvedValueOnce(
			new Map<string, ClientResponse>([['HKDME', successResponse()]]),
		);

		const response = await client.submitSepaDirectDebitXml({
			accountNumber: '1234567890',
			painMessage: PAIN_008_002_TWO_TX,
		});

		expect(response.success).toBe(true);
		expect(addCustomerInteractionSpy).toHaveBeenCalledOnce();
		const submitted = addCustomerInteractionSpy.mock.calls[0][0];
		expect(submitted).toBeInstanceOf(CollectiveDirectDebitInteraction);
		expect(submitted.params.painDescriptor).toBe('urn:iso:std:iso:20022:tech:xsd:pain.008.001.02');
		expect(submitted.params.painMessage).toBe(PAIN_008_002_TWO_TX);
		expect(submitted.params.sumAmount).toEqual({ value: 15.5, currency: 'EUR' });
		expect(submitted.params.requestSingleBooking).toBe(true);
	});

	it('routes a one-transaction pain.008 to the single direct debit (HKDSE)', async () => {
		dialogStartMock.mockResolvedValueOnce(
			new Map<string, ClientResponse>([['HKDSE', successResponse()]]),
		);

		const response = await client.submitSepaDirectDebitXml({
			accountNumber: '1234567890',
			painMessage: PAIN_008_002_ONE_TX,
		});

		expect(response.success).toBe(true);
		expect(addCustomerInteractionSpy).toHaveBeenCalledOnce();
		const submitted = addCustomerInteractionSpy.mock.calls[0][0];
		expect(submitted).toBeInstanceOf(DirectDebitInteraction);
		expect(submitted.params.painDescriptor).toBe('urn:iso:std:iso:20022:tech:xsd:pain.008.001.02');
		expect(submitted.params.painMessage).toBe(PAIN_008_002_ONE_TX);
	});

	it('throws before starting a dialog when the bank does not advertise the pain version', async () => {
		await expect(
			client.submitSepaDirectDebitXml({
				accountNumber: '1234567890',
				painMessage: PAIN_008_UNSUPPORTED_VERSION,
			}),
		).rejects.toThrow(/does not support pain\.008\.001\.08/);

		expect(dialogStartMock).not.toHaveBeenCalled();
		expect(addCustomerInteractionSpy).not.toHaveBeenCalled();
	});

	it('continues a pending direct debit via HKDSE/HKDME with submitSepaDirectDebitXmlWithTan', async () => {
		dialogStartMock.mockResolvedValueOnce(
			new Map<string, ClientResponse>([
				[
					'HKDSE',
					{
						dialogId: 'DIALOG1',
						success: true,
						requiresTan: true,
						tanReference: 'TANREF123',
						tanChallenge: 'Bitte geben Sie Ihre TAN ein.',
						bankingInformationUpdated: false,
						bankAnswers: [{ code: 3955, text: 'TAN erforderlich' }],
					},
				],
			]),
		);
		await client.submitSepaDirectDebitXml({
			accountNumber: '1234567890',
			painMessage: PAIN_008_002_ONE_TX,
		});

		dialogContinueMock.mockResolvedValueOnce(
			new Map<string, ClientResponse>([['HKDSE', successResponse()]]),
		);

		const response = await client.submitSepaDirectDebitXmlWithTan('TANREF123', '123456');

		expect(response.success).toBe(true);
		expect(dialogContinueMock).toHaveBeenCalledWith('TANREF123', '123456');
	});
});
