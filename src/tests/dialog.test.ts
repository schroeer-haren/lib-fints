import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import type { BankingInformation } from '../bankingInformation.js';
import type { BankTransaction } from '../bankTransaction.js';
import type { BPD } from '../bpd.js';
import { Language } from '../codes.js';
import { FinTSConfig } from '../config.js';
import { Dialog } from '../dialog.js';
import type {
	ClientResponse,
	CustomerOrderInteraction,
} from '../interactions/customerInteraction.js';
import { InitDialogInteraction } from '../interactions/initDialogInteraction.js';
import { SepaAccountInteraction } from '../interactions/sepaAccountInteraction.js';
import { StatementInteractionCAMT } from '../interactions/statementInteractionCAMT.js';
import { Message } from '../message.js';
import { PARTED, type PartedSegment } from '../partedSegment.js';
import { encode } from '../segment.js';
import { HICAZ, type HICAZSegment } from '../segments/HICAZ.js';
import { HIRMS, type HIRMSSegment } from '../segments/HIRMS.js';
import { registerSegments } from '../segments/registry.js';

// Mock HttpClient to prevent real HTTP calls
vi.mock('../httpClient.js', () => ({
	HttpClient: class MockHttpClient {
		constructor(
			public url: string,
			public debug = false,
			public debugRaw = false,
		) {}

		sendMessage = vi.fn();
	},
}));

describe('Dialog', () => {
	let config: FinTSConfig;
	let dialog: Dialog;
	let httpClientSendMessageMock: MockInstance;

	registerSegments();

	beforeEach(() => {
		const bankingInformation: BankingInformation = {
			systemId: 'MOCK_SYSTEM_ID',
			bankMessages: [],
			bpd: {
				version: 1,
				bankId: '12030000',
				bankName: 'Mock Bank',
				countryCode: 280,
				url: 'http://mock.bank.url',
				allowedTransactions: [
					{
						transId: 'HKSPA',
						tanRequired: false,
						versions: [1, 2, 3],
					} as BankTransaction,
				],
				supportedTanMethods: [
					{
						id: 940,
						name: 'ChipTAN',
						version: 1,
						isDecoupled: false,
						activeTanMediaCount: 1,
						activeTanMedia: ['TAN-Generator 123'],
						tanMediaRequirement: 0,
					},
					{
						id: 941,
						name: 'pushTAN',
						version: 1,
						isDecoupled: true,
						activeTanMediaCount: 1,
						activeTanMedia: ['Mobile App'],
						tanMediaRequirement: 1,
					},
				],
				availableTanMethodIds: [940, 941],
				supportedLanguages: [Language.German],
				maxTransactionsPerMessage: 1,
			} as BPD,
		};

		config = FinTSConfig.fromBankingInformation(
			'TestProduct',
			'1.0',
			bankingInformation,
			'testuser',
			'12345',
			940, // tanMethodId
			'TAN-Generator 123', // tanMediaName
		);

		// Create dialog instance
		dialog = new Dialog(config);

		vi.spyOn(dialog.currentInteraction, 'handleClientResponse').mockReturnValue({
			dialogId: 'MOCK_DIALOG_123',
			success: true,
			requiresTan: false,
			bankAnswers: [{ code: 20, text: 'Success' }],
		} as ClientResponse);

		vi.spyOn(
			dialog.interactions[dialog.interactions.length - 1],
			'handleClientResponse',
		).mockReturnValue({
			dialogId: 'MOCK_DIALOG_123',
			success: true,
			requiresTan: false,
			bankAnswers: [{ code: 100, text: 'Dialog ended' }],
		} as ClientResponse);

		// Mock the HttpClient.sendMessage method
		httpClientSendMessageMock = vi.mocked(dialog.httpClient.sendMessage);
		const responseMessage: Message = new Message([]);
		httpClientSendMessageMock.mockResolvedValue(responseMessage);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe('constructor', () => {
		it('creates a new dialog with provided config', () => {
			expect(dialog.config).toBe(config);
			expect(dialog.dialogId).toBe('0');
			expect(dialog.lastMessageNumber).toBe(0);
			expect(dialog.interactions).toHaveLength(2);
			expect(dialog.interactions[0]).toBeInstanceOf(InitDialogInteraction);
			expect(dialog.currentInteractionIndex).toBe(0);
			expect(dialog.isInitialized).toBe(false);
			expect(dialog.hasEnded).toBe(false);
			expect(dialog.httpClient.sendMessage).toBeDefined();
		});

		it('creates dialog with syncSystemId option', () => {
			const syncDialog = new Dialog(config, true);
			const initDialogInteraction = syncDialog.interactions[0] as InitDialogInteraction;
			expect(initDialogInteraction).toBeInstanceOf(InitDialogInteraction);
			expect(initDialogInteraction.syncSystemId).toBe(true);
		});

		it('throws error when no config is provided', () => {
			expect(() => new Dialog(null as unknown as FinTSConfig)).toThrow(
				'configuration must be provided',
			);
		});
	});

	describe('currentInteraction getter', () => {
		it('returns the current interaction', () => {
			expect(dialog.currentInteraction).toBeInstanceOf(InitDialogInteraction);
		});
	});

	describe('start()', () => {
		it('successfully starts and ends a dialog', async () => {
			const sepaInteraction = new SepaAccountInteraction();

			vi.spyOn(sepaInteraction, 'handleClientResponse').mockReturnValue({
				dialogId: 'MOCK_DIALOG_123',
				success: true,
				requiresTan: false,
				bankAnswers: [{ code: 20, text: 'Success' }],
			} as ClientResponse);

			dialog.addCustomerInteraction(sepaInteraction);
			const responses = await dialog.start();

			expect(dialog.dialogId).toBe('MOCK_DIALOG_123');
			expect(httpClientSendMessageMock).toHaveBeenCalledTimes(3);
			expect(responses).toBeInstanceOf(Map);
			expect(responses.size).toBe(3);
			expect(dialog.currentInteraction).toBeUndefined();
			expect(dialog.hasEnded).toBe(true);
		});

		it('throws error when dialog is already initialized', async () => {
			dialog.isInitialized = true;

			await expect(dialog.start()).rejects.toThrow('dialog has already been initialized');
		});

		it('throws error when dialog has ended', async () => {
			dialog.hasEnded = true;

			await expect(dialog.start()).rejects.toThrow('cannot start a dialog that has already ended');
		});

		it('throws error when lastMessageNumber > 0', async () => {
			dialog.lastMessageNumber = 1;

			await expect(dialog.start()).rejects.toThrow(
				'dialog start can only be called on a new dialog',
			);
		});

		it('handles TAN requirement correctly', async () => {
			vi.spyOn(dialog.currentInteraction, 'handleClientResponse').mockReturnValue({
				dialogId: 'MOCK_DIALOG_123',
				success: true,
				requiresTan: true,
				tanReference: 'TAN_REF_123',
				bankAnswers: [{ code: 3955, text: 'TAN required' }],
			} as ClientResponse);

			const responses = await dialog.start();

			expect(dialog.currentInteraction).toBeInstanceOf(InitDialogInteraction);
			expect(dialog.isInitialized).toBe(false);
			expect(dialog.hasEnded).toBe(false);
			const response = responses.get(dialog.currentInteraction.segId);
			expect(response).toBeDefined();
			expect(response?.requiresTan).toBe(true);
			expect(response?.tanReference).toBe('TAN_REF_123');
		});
	});

	describe('continue()', () => {
		beforeEach(async () => {
			vi.spyOn(dialog.currentInteraction, 'handleClientResponse').mockReturnValue({
				dialogId: 'MOCK_DIALOG_123',
				success: true,
				requiresTan: true,
				tanReference: 'TAN_REF_123',
				bankAnswers: [{ code: 3955, text: 'TAN required' }],
			} as ClientResponse);

			await dialog.start();

			vi.spyOn(dialog.currentInteraction, 'handleClientResponse').mockReturnValue({
				dialogId: 'MOCK_DIALOG_123',
				success: true,
				requiresTan: false,
				bankAnswers: [{ code: 20, text: 'Dialog initialized' }],
			} as ClientResponse);
		});

		it('successfully continues with TAN', async () => {
			const responses = await dialog.continue('TAN_REF_123', '123456');

			expect(responses).toBeInstanceOf(Map);
			expect(dialog.dialogId).toBe('MOCK_DIALOG_123');
			expect(httpClientSendMessageMock).toHaveBeenCalledTimes(3);
			expect(responses).toBeInstanceOf(Map);
			expect(responses.size).toBe(2);
			expect(dialog.currentInteraction).toBeUndefined();
			expect(dialog.hasEnded).toBe(true);
		});

		it('successfully continues decoupled TAN method without TAN', async () => {
			config.selectTanMethod(941);
			const responses = await dialog.continue('TAN_REF_123');
			expect(responses).toBeInstanceOf(Map);
			expect(responses.size).toBe(2);
			expect(dialog.currentInteraction).toBeUndefined();
			expect(dialog.hasEnded).toBe(true);
		});

		it('throws error when tanOrderReference is missing', async () => {
			await expect(dialog.continue('')).rejects.toThrow(
				'tanOrderReference must be provided to continue a customer order with a TAN',
			);
		});

		it('throws error when TAN is missing for non-decoupled method', async () => {
			// The default config already has a non-decoupled TAN method
			await expect(dialog.continue('TAN_REF_123')).rejects.toThrow(
				'TAN must be provided for non-decoupled TAN methods',
			);
		});

		it('throws error when dialog has ended', async () => {
			dialog.hasEnded = true;

			await expect(dialog.continue('TAN_REF_123', '123456')).rejects.toThrow(
				'cannot continue a customer order when dialog has already ended',
			);
		});

		it('throws error when no current interaction', async () => {
			dialog.currentInteractionIndex = dialog.interactions.length;

			await expect(dialog.continue('TAN_REF_123', '123456')).rejects.toThrow(
				'there is no running customer interaction in this dialog to continue',
			);
		});
	});

	describe('addCustomerInteraction()', () => {
		let sepaAccountInteraction: CustomerOrderInteraction;

		beforeEach(() => {
			sepaAccountInteraction = new SepaAccountInteraction();
		});

		it('adds interaction to the end but before dialog end interaction by default', () => {
			const initialLength = dialog.interactions.length;

			dialog.addCustomerInteraction(sepaAccountInteraction);

			expect(dialog.interactions).toHaveLength(initialLength + 1);
			expect(dialog.interactions[dialog.interactions.length - 2]).toBe(sepaAccountInteraction);
			expect(sepaAccountInteraction.dialog).toBe(dialog);
		});

		it('adds interaction after current when afterCurrent is true', () => {
			const initialLength = dialog.interactions.length;
			const currentIndex = dialog.currentInteractionIndex;

			dialog.addCustomerInteraction(sepaAccountInteraction, true);

			expect(dialog.interactions).toHaveLength(initialLength + 1);
			expect(dialog.interactions[currentIndex + 1]).toBe(sepaAccountInteraction);
		});

		it('throws error when dialog has ended', () => {
			dialog.hasEnded = true;

			expect(() => dialog.addCustomerInteraction(sepaAccountInteraction)).toThrow(
				'cannot queue another customer interaction when dialog has already ended',
			);
		});

		it('throws error for unsupported transaction', () => {
			// Mock unsupported transaction
			sepaAccountInteraction.segId = 'UNSUPPORTED';

			expect(() => dialog.addCustomerInteraction(sepaAccountInteraction)).toThrow(
				'customer order transaction UNSUPPORTED is not supported according to the BPD',
			);
		});
	});

	describe('multipart CAMT statement responses', () => {
		function makeCompleteCamtPage(xml: string, iban: string, continuationMark?: string): Message {
			const camtSegment: HICAZSegment = {
				header: {
					segId: HICAZ.Id,
					segNr: 3,
					version: HICAZ.Version,
				},
				account: { iban },
				camtDescriptor: 'camt.052.test',
				bookedTransactions: [xml],
			};
			const parted: PartedSegment = {
				header: {
					segId: PARTED.Id,
					segNr: 3,
					version: 1,
				},
				originalId: HICAZ.Id,
				rawData: encode(camtSegment).slice(0, -1),
			};
			const status: HIRMSSegment = {
				header: {
					segId: HIRMS.Id,
					segNr: 4,
					version: HIRMS.Version,
				},
				answers: continuationMark
					? [
							{
								code: 3040,
								text: 'More transactions',
								params: [continuationMark],
							},
						]
					: [
							{
								code: 20,
								text: 'Success',
							},
						],
			};

			return new Message([parted, status]);
		}
		function createCamtTestInteraction(): StatementInteractionCAMT {
			const bpd = config.bankingInformation.bpd;

			if (!bpd) {
				throw new Error('Test setup failed: missing BPD');
			}
			bpd.allowedTransactions.push({
				transId: 'HKCAZ',
				tanRequired: false,
				versions: [1],
			} as BankTransaction);
			const interaction = new StatementInteractionCAMT('TEST_ACCOUNT');
			vi.spyOn(interaction, 'getSegments').mockReturnValue([
				{
					header: {
						segId: 'HKCAZ',
						segNr: 0,
						version: 1,
					},
				},
			]);

			return interaction;
		}
		it('merges independently decodable HICAZ pages', async () => {
			const iban = 'DE00000000000000000000'; // Synthetic account
			const xmlA = '<Document><Page>first</Page></Document>';
			const xmlB = '<Document><Page>second</Page></Document>';
			function makePartedPage(xml: string, hasMore: boolean): Message {
				const camtSegment: HICAZSegment = {
					header: {
						segId: HICAZ.Id,
						segNr: 3,
						version: HICAZ.Version,
					},
					account: { iban },
					camtDescriptor: 'camt.052.test',
					bookedTransactions: [xml],
				};
				const parted: PartedSegment = {
					header: {
						segId: PARTED.Id,
						segNr: 3,
						version: 1,
					},
					originalId: HICAZ.Id,
					rawData: encode(camtSegment).slice(0, -1),
				};
				const status: HIRMSSegment = {
					header: {
						segId: HIRMS.Id,
						segNr: 4,
						version: HIRMS.Version,
					},
					answers: hasMore
						? [
								{
									code: 3040,
									text: 'More transactions',
									params: ['PAGE_2'],
								},
							]
						: [
								{
									code: 20,
									text: 'Success',
								},
							],
				};

				return new Message([parted, status]);
			}
			const bpd = config.bankingInformation.bpd;
			if (!bpd) {
				throw new Error('Test setup failed: missing BPD');
			}
			// Allow HKCAZ in the mocked bank configuration.
			bpd.allowedTransactions.push({
				transId: 'HKCAZ',
				tanRequired: false,
				versions: [1],
			} as BankTransaction);
			const interaction = new StatementInteractionCAMT('TEST_ACCOUNT');
			// We only want to test response assembly, not request encoding.
			vi.spyOn(interaction, 'getSegments').mockReturnValue([
				{
					header: {
						segId: 'HKCAZ',
						segNr: 0,
						version: 1,
					},
				},
			]);
			// Inspect the HICAZ segment that reaches the interaction.
			const handleResponse = vi
				.spyOn(interaction, 'handleClientResponse')
				.mockImplementation((message) => {
					// PARTED must have been replaced by the decoded HICAZ.
					expect(message.findSegment(PARTED.Id)).toBeUndefined();

					// Both XML documents must remain separate.
					expect(message.findSegment<HICAZSegment>(HICAZ.Id)?.bookedTransactions).toEqual([
						xmlA,
						xmlB,
					]);

					return {
						dialogId: 'MOCK_DIALOG_123',
						success: true,
						requiresTan: false,
						bankingInformationUpdated: false,
						bankAnswers: message.getBankAnswers(),
					};
				});
			dialog.addCustomerInteraction(interaction);
			// Simulate the bank's sequential responses.
			httpClientSendMessageMock
				.mockResolvedValueOnce(new Message([]))
				.mockResolvedValueOnce(makePartedPage(xmlA, true))
				.mockResolvedValueOnce(makePartedPage(xmlB, false))
				.mockResolvedValueOnce(new Message([]));
			await dialog.start();
			// Init + first statement page + continuation + end.
			expect(httpClientSendMessageMock).toHaveBeenCalledTimes(4);
			expect(handleResponse).toHaveBeenCalledTimes(1);
			// Verify the continuation marker was sent to the bank.
			const continuationMessage = httpClientSendMessageMock.mock.calls[2][0] as Message;
			expect(
				(
					continuationMessage.findSegment('HKCAZ') as {
						continuationMark?: string;
					}
				)?.continuationMark,
			).toBe('PAGE_2');
		});
		it('reassembles a CAMT document split across PARTED responses', async () => {
			const iban = 'DE00000000000000000000';
			const xml = '<Document><Page>fragmented</Page></Document>';

			const camtSegment: HICAZSegment = {
				header: {
					segId: HICAZ.Id,
					segNr: 3,
					version: HICAZ.Version,
				},
				account: { iban },
				camtDescriptor: 'camt.052.test',
				bookedTransactions: [xml],
			};
			// Encode one complete, valid HICAZ segment.
			const encoded = encode(camtSegment).slice(0, -1);
			// Split the encoded segment inside the XML content.
			// Neither fragment contains a complete CAMT document.
			const fragmentPosition = encoded.indexOf('fragmented');
			expect(fragmentPosition).toBeGreaterThan(0);
			const splitAt = fragmentPosition + 4;
			const firstFragment = encoded.slice(0, splitAt);
			// Continuation fragments repeat the segment header.
			// The original assembly logic removes this repeated header.
			const headerEnd = encoded.indexOf('+') + 1;
			const secondFragment = encoded.slice(0, headerEnd) + encoded.slice(splitAt);
			// Verify that these fragments reconstruct the original segment.
			expect(firstFragment + secondFragment.slice(secondFragment.indexOf('+') + 1)).toBe(encoded);
			function makePartedResponse(rawData: string, hasMore: boolean): Message {
				const parted: PartedSegment = {
					header: {
						segId: PARTED.Id,
						segNr: 3,
						version: 1,
					},
					originalId: HICAZ.Id,
					rawData,
				};
				const status: HIRMSSegment = {
					header: {
						segId: HIRMS.Id,
						segNr: 4,
						version: HIRMS.Version,
					},
					answers: hasMore
						? [
								{
									code: 3040,
									text: 'More statement data',
									params: ['NEXT_FRAGMENT'],
								},
							]
						: [
								{
									code: 20,
									text: 'Success',
								},
							],
				};
				return new Message([parted, status]);
			}
			// Enable HKCAZ for the test bank.
			const bpd = config.bankingInformation.bpd;
			if (!bpd) {
				throw new Error('Test setup failed: missing BPD');
			}
			bpd.allowedTransactions.push({
				transId: 'HKCAZ',
				tanRequired: false,
				versions: [1],
			} as BankTransaction);
			const interaction = new StatementInteractionCAMT('TEST_ACCOUNT');
			vi.spyOn(interaction, 'getSegments').mockReturnValue([
				{
					header: {
						segId: 'HKCAZ',
						segNr: 0,
						version: 1,
					},
				},
			]);
			// Verify that the reconstructed statement is complete.
			const handleResponse = vi
				.spyOn(interaction, 'handleClientResponse')
				.mockImplementation((message) => {
					expect(message.findSegment(PARTED.Id)).toBeUndefined();
					const hicaz = message.findSegment<HICAZSegment>(HICAZ.Id);
					expect(hicaz).toBeDefined();
					expect(hicaz?.account.iban).toBe(iban);
					// Exactly ONE complete XML document, not two fragments.
					expect(hicaz?.bookedTransactions).toEqual([xml]);
					return {
						dialogId: 'MOCK_DIALOG_123',
						success: true,
						requiresTan: false,
						bankingInformationUpdated: false,
						bankAnswers: message.getBankAnswers(),
					};
				});
			dialog.addCustomerInteraction(interaction);
			httpClientSendMessageMock
				.mockResolvedValueOnce(new Message([]))
				.mockResolvedValueOnce(makePartedResponse(firstFragment, true))
				.mockResolvedValueOnce(makePartedResponse(secondFragment, false))
				.mockResolvedValueOnce(new Message([]));
			await dialog.start();
			expect(httpClientSendMessageMock).toHaveBeenCalledTimes(4);
			expect(handleResponse).toHaveBeenCalledTimes(1);
			const continuationMessage = httpClientSendMessageMock.mock.calls[2][0] as Message;
			expect(
				(
					continuationMessage.findSegment('HKCAZ') as {
						continuationMark?: string;
					}
				)?.continuationMark,
			).toBe('NEXT_FRAGMENT');
		});
		it('reassembles CAMT fragments split inside a binary length prefix', async () => {
			const iban = 'DE00000000000000000000';
			const xml = '<Document><Page>fragmented</Page></Document>';

			const camtSegment: HICAZSegment = {
				header: {
					segId: HICAZ.Id,
					segNr: 3,
					version: HICAZ.Version,
				},
				account: { iban },
				camtDescriptor: 'camt.052.test',
				bookedTransactions: [xml],
			};
			// Encode one complete, valid HICAZ segment.
			const encoded = encode(camtSegment).slice(0, -1);
			// Split the encoded segment inside the XML content.
			// Neither fragment contains a complete CAMT document.
			const fragmentPosition = encoded.indexOf('fragmented');
			expect(fragmentPosition).toBeGreaterThan(0);
			const binaryMarker = encoded.indexOf('@');
			expect(binaryMarker).toBeGreaterThan(0);
			// Split inside the @length@ prefix.
			const splitAt = binaryMarker + 2;
			const firstFragment = encoded.slice(0, splitAt);
			// Continuation fragments repeat the segment header.
			// The original assembly logic removes this repeated header.
			const headerEnd = encoded.indexOf('+') + 1;
			const secondFragment = encoded.slice(0, headerEnd) + encoded.slice(splitAt);
			// Verify that these fragments reconstruct the original segment.
			expect(firstFragment + secondFragment.slice(secondFragment.indexOf('+') + 1)).toBe(encoded);
			function makePartedResponse(rawData: string, hasMore: boolean): Message {
				const parted: PartedSegment = {
					header: {
						segId: PARTED.Id,
						segNr: 3,
						version: 1,
					},
					originalId: HICAZ.Id,
					rawData,
				};
				const status: HIRMSSegment = {
					header: {
						segId: HIRMS.Id,
						segNr: 4,
						version: HIRMS.Version,
					},
					answers: hasMore
						? [
								{
									code: 3040,
									text: 'More statement data',
									params: ['NEXT_FRAGMENT'],
								},
							]
						: [
								{
									code: 20,
									text: 'Success',
								},
							],
				};
				return new Message([parted, status]);
			}
			// Enable HKCAZ for the test bank.
			const bpd = config.bankingInformation.bpd;
			if (!bpd) {
				throw new Error('Test setup failed: missing BPD');
			}
			bpd.allowedTransactions.push({
				transId: 'HKCAZ',
				tanRequired: false,
				versions: [1],
			} as BankTransaction);
			const interaction = new StatementInteractionCAMT('TEST_ACCOUNT');
			vi.spyOn(interaction, 'getSegments').mockReturnValue([
				{
					header: {
						segId: 'HKCAZ',
						segNr: 0,
						version: 1,
					},
				},
			]);
			// Verify that the reconstructed statement is complete.
			const handleResponse = vi
				.spyOn(interaction, 'handleClientResponse')
				.mockImplementation((message) => {
					expect(message.findSegment(PARTED.Id)).toBeUndefined();
					const hicaz = message.findSegment<HICAZSegment>(HICAZ.Id);
					expect(hicaz).toBeDefined();
					expect(hicaz?.account.iban).toBe(iban);
					// Exactly ONE complete XML document, not two fragments.
					expect(hicaz?.bookedTransactions).toEqual([xml]);
					return {
						dialogId: 'MOCK_DIALOG_123',
						success: true,
						requiresTan: false,
						bankingInformationUpdated: false,
						bankAnswers: message.getBankAnswers(),
					};
				});
			dialog.addCustomerInteraction(interaction);
			httpClientSendMessageMock
				.mockResolvedValueOnce(new Message([]))
				.mockResolvedValueOnce(makePartedResponse(firstFragment, true))
				.mockResolvedValueOnce(makePartedResponse(secondFragment, false))
				.mockResolvedValueOnce(new Message([]));
			await dialog.start();
			expect(httpClientSendMessageMock).toHaveBeenCalledTimes(4);
			expect(handleResponse).toHaveBeenCalledTimes(1);
			const continuationMessage = httpClientSendMessageMock.mock.calls[2][0] as Message;
			expect(
				(
					continuationMessage.findSegment('HKCAZ') as {
						continuationMark?: string;
					}
				)?.continuationMark,
			).toBe('NEXT_FRAGMENT');
		});
		it('merges three independently decodable HICAZ pages', async () => {
			const iban = 'DE00000000000000000000';
			const xmlA = '<Document><Page>first</Page></Document>';
			const xmlB = '<Document><Page>second</Page></Document>';
			const xmlC = '<Document><Page>third</Page></Document>';
			const interaction = createCamtTestInteraction();
			const handleResponse = vi
				.spyOn(interaction, 'handleClientResponse')
				.mockImplementation((message) => {
					// No PARTED segment should remain.
					expect(message.findSegment(PARTED.Id)).toBeUndefined();
					const hicaz = message.findSegment<HICAZSegment>(HICAZ.Id);
					expect(hicaz).toBeDefined();
					expect(hicaz?.account.iban).toBe(iban);
					// All three XML documents must be preserved separately,
					// in their original order.
					expect(hicaz?.bookedTransactions).toEqual([xmlA, xmlB, xmlC]);
					return {
						dialogId: 'MOCK_DIALOG_123',
						success: true,
						requiresTan: false,
						bankingInformationUpdated: false,
						bankAnswers: message.getBankAnswers(),
					};
				});
			dialog.addCustomerInteraction(interaction);
			httpClientSendMessageMock
				// Dialog initialization
				.mockResolvedValueOnce(new Message([]))
				// First CAMT page: another page follows
				.mockResolvedValueOnce(makeCompleteCamtPage(xmlA, iban, 'PAGE_2'))
				// Second CAMT page: one more page follows
				.mockResolvedValueOnce(makeCompleteCamtPage(xmlB, iban, 'PAGE_3'))
				// Third CAMT page: no more data
				.mockResolvedValueOnce(makeCompleteCamtPage(xmlC, iban))
				// Dialog ending
				.mockResolvedValueOnce(new Message([]));
			await dialog.start();
			// Init + 3 statement pages + end = 5 requests
			expect(httpClientSendMessageMock).toHaveBeenCalledTimes(5);
			// The completed statement is processed exactly once.
			expect(handleResponse).toHaveBeenCalledTimes(1);
		});
		it('rejects CAMT continuation pages from a different account', async () => {
			const ibanA = 'DE00000000000000000000';
			const ibanB = 'DE11111111111111111111';
			const xmlA = '<Document><Page>account A</Page></Document>';
			const xmlB = '<Document><Page>account B</Page></Document>';
			const interaction = createCamtTestInteraction();
			const handleResponse = vi.spyOn(interaction, 'handleClientResponse');
			dialog.addCustomerInteraction(interaction);
			httpClientSendMessageMock
				// Dialog initialization
				.mockResolvedValueOnce(new Message([]))
				// First page belongs to account A.
				.mockResolvedValueOnce(makeCompleteCamtPage(xmlA, ibanA, 'PAGE_2'))
				// Continuation unexpectedly belongs to account B.
				.mockResolvedValueOnce(makeCompleteCamtPage(xmlB, ibanB));
			// Mixing statements from different accounts must fail.
			await expect(dialog.start()).rejects.toThrow('CAMT continuation belongs to another account');

			// Init + first page + second page
			expect(httpClientSendMessageMock).toHaveBeenCalledTimes(3);

			// The invalid statement must never reach the parser.
			expect(handleResponse).not.toHaveBeenCalled();
		});
	});
});
