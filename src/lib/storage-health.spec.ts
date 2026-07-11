import { describe, expect, it } from 'vitest';
import {
	formatStorageBytes,
	inspectStorage,
	requestPersistentStorage,
	storagePressure
} from './storage-health';

describe('storage health', () => {
	it('classifies pressure without treating unknown quotas as critical', () => {
		expect(storagePressure(10, 0)).toBe('unknown');
		expect(storagePressure(70, 100)).toBe('normal');
		expect(storagePressure(80, 100)).toBe('warning');
		expect(storagePressure(95, 100)).toBe('critical');
	});

	it('formats compact local usage labels', () => {
		expect(formatStorageBytes(0)).toBe('0 B');
		expect(formatStorageBytes(1536)).toBe('1.5 KB');
		expect(formatStorageBytes(25 * 1024 * 1024)).toBe('25 MB');
	});

	it('inspects and requests browser persistence defensively', async () => {
		const storage = {
			estimate: async () => ({ usage: 80, quota: 100 }),
			persisted: async () => false,
			persist: async () => true
		};
		await expect(inspectStorage(storage)).resolves.toMatchObject({
			supported: true,
			pressure: 'warning',
			persisted: false
		});
		await expect(requestPersistentStorage(storage)).resolves.toBe(true);
		await expect(inspectStorage(undefined)).resolves.toMatchObject({ supported: false });
	});
});
