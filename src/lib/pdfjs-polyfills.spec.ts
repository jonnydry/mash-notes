import { describe, expect, it } from 'vitest';
import { ensurePdfJsMapPolyfills } from './pdfjs-polyfills';

describe('pdf.js Map polyfills', () => {
	it('provides getOrInsert and getOrInsertComputed when missing', () => {
		const proto = Map.prototype as Map<unknown, unknown> & {
			getOrInsert?: (key: unknown, defaultValue: unknown) => unknown;
			getOrInsertComputed?: (key: unknown, callbackFn: (key: unknown) => unknown) => unknown;
		};
		const hadInsert = Object.prototype.hasOwnProperty.call(proto, 'getOrInsert');
		const hadComputed = Object.prototype.hasOwnProperty.call(proto, 'getOrInsertComputed');
		const prevInsert = proto.getOrInsert;
		const prevComputed = proto.getOrInsertComputed;
		try {
			// Force the polyfill path even on runtimes that already ship the APIs.
			Object.defineProperty(proto, 'getOrInsert', {
				value: undefined,
				writable: true,
				configurable: true
			});
			Object.defineProperty(proto, 'getOrInsertComputed', {
				value: undefined,
				writable: true,
				configurable: true
			});
			ensurePdfJsMapPolyfills();
			const map = new Map<string, number>();
			expect(map.getOrInsertComputed('a', () => 1)).toBe(1);
			expect(map.getOrInsertComputed('a', () => 99)).toBe(1);
			expect(map.getOrInsert('b', 2)).toBe(2);
			expect(map.getOrInsert('b', 3)).toBe(2);
		} finally {
			if (hadInsert) Object.defineProperty(proto, 'getOrInsert', { value: prevInsert, writable: true, configurable: true });
			else delete proto.getOrInsert;
			if (hadComputed)
				Object.defineProperty(proto, 'getOrInsertComputed', {
					value: prevComputed,
					writable: true,
					configurable: true
				});
			else delete proto.getOrInsertComputed;
		}
	});
});
