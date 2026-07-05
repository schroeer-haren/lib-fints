import { DataElement } from './DataElement.js';

export class Binary extends DataElement {
	constructor(
		name: string,
		minCount = 0,
		maxCount = 1,
		public maxLength?: number,
		minVersion?: number,
		maxVersion?: number,
	) {
		super(name, minCount, maxCount, minVersion, maxVersion);
	}

	encode(value: string): string {
		if (!value) {
			return '';
		}

		// The FinTS binary length prefix (@length@) counts BYTES, and messages are
		// transmitted as UTF-8. Using the JS string length (UTF-16 code units) would
		// under-count any non-ASCII character (e.g. umlauts in a SEPA name/purpose),
		// which the bank rejects with "9110 ungültige Binärdaten".
		const byteLength = Buffer.byteLength(value, 'utf8');

		if (this.maxLength && byteLength > this.maxLength) {
			throw Error(`the Binary value '${this.name}' must not exceed its maximum length`);
		}

		return `@${byteLength}@${value}`;
	}

	decode(text: string) {
		return text.slice(text.indexOf('@', 1) + 1);
	}
}
