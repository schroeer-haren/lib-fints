import { AlphaNumeric } from '../dataElements/AlphaNumeric.js';
import { Numeric } from '../dataElements/Numeric.js';
import { YesNo } from '../dataElements/YesNo.js';
import {
	BusinessTransactionParameter,
	type BusinessTransactionParameterSegment,
} from './businessTransactionParameter.js';

export type HIVPPSSegment = BusinessTransactionParameterSegment<HIVPPSParameter>;

export type HIVPPSParameter = {
	maxTrans?: number;
	noticeIsStructured?: boolean;
	reportComplete?: string;
	batchPaymentAllowed?: boolean;
	multipleAllowed?: boolean;
	// The pain.002 payment status report format the bank expects in HKVPP.
	supportedReportFormats?: string;
	paymentOrderSegment?: string[];
};

/**
 * Parameters for the Verification of Payee check request (HKVPP)
 */
export class HIVPPS extends BusinessTransactionParameter {
	static Id = 'HIVPPS';
	version = 1;

	constructor() {
		super(HIVPPS.Id, [
			new Numeric('maxTrans', 0, 1, 7),
			new YesNo('noticeIsStructured', 0, 1),
			new AlphaNumeric('reportComplete', 0, 1, 1),
			new YesNo('batchPaymentAllowed', 0, 1),
			new YesNo('multipleAllowed', 0, 1),
			new AlphaNumeric('supportedReportFormats', 0, 1, 1024),
			new AlphaNumeric('paymentOrderSegment', 0, 99, 6),
		]);
	}
}
