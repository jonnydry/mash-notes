/**
 * pdf.js 5.5+/6 uses Map.prototype.getOrInsert* (Stage 2 / early shipping).
 * Polyfill for browsers that don't have it yet — must run before pdf.js loads.
 */
export function ensurePdfJsMapPolyfills(): void {
	const proto = Map.prototype as Map<unknown, unknown> & {
		getOrInsert?: (key: unknown, defaultValue: unknown) => unknown;
		getOrInsertComputed?: (key: unknown, callbackFn: (key: unknown) => unknown) => unknown;
	};

	if (typeof proto.getOrInsert !== 'function') {
		Object.defineProperty(proto, 'getOrInsert', {
			value(key: unknown, defaultValue: unknown) {
				if (this.has(key)) return this.get(key);
				this.set(key, defaultValue);
				return defaultValue;
			},
			writable: true,
			configurable: true
		});
	}

	if (typeof proto.getOrInsertComputed !== 'function') {
		Object.defineProperty(proto, 'getOrInsertComputed', {
			value(key: unknown, callbackFn: (key: unknown) => unknown) {
				if (this.has(key)) return this.get(key);
				const value = callbackFn(key);
				this.set(key, value);
				return value;
			},
			writable: true,
			configurable: true
		});
	}
}
