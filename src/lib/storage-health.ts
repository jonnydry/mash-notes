export type StoragePressure = 'unknown' | 'normal' | 'warning' | 'critical';

export type StorageHealth = {
	supported: boolean;
	usage: number;
	quota: number;
	ratio: number | null;
	pressure: StoragePressure;
	persisted: boolean | null;
};

export const PERSISTENCE_PROMPTED_KEY = 'mash.storagePersistencePrompted';

export function storagePressure(usage: number, quota: number): StoragePressure {
	if (!Number.isFinite(usage) || !Number.isFinite(quota) || quota <= 0) return 'unknown';
	const ratio = Math.max(0, usage) / quota;
	if (ratio >= 0.9) return 'critical';
	if (ratio >= 0.75) return 'warning';
	return 'normal';
}

export function formatStorageBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
	const value = bytes / 1024 ** index;
	return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

type StorageManagerLike = {
	estimate?: () => Promise<{ usage?: number; quota?: number }>;
	persisted?: () => Promise<boolean>;
	persist?: () => Promise<boolean>;
};

export async function inspectStorage(storage?: StorageManagerLike): Promise<StorageHealth> {
	if (!storage?.estimate) {
		return {
			supported: false,
			usage: 0,
			quota: 0,
			ratio: null,
			pressure: 'unknown',
			persisted: null
		};
	}
	try {
		const estimate = await storage.estimate();
		const usage = estimate.usage ?? 0;
		const quota = estimate.quota ?? 0;
		const persisted = storage.persisted ? await storage.persisted().catch(() => null) : null;
		return {
			supported: true,
			usage,
			quota,
			ratio: quota > 0 ? usage / quota : null,
			pressure: storagePressure(usage, quota),
			persisted
		};
	} catch {
		return {
			supported: false,
			usage: 0,
			quota: 0,
			ratio: null,
			pressure: 'unknown',
			persisted: null
		};
	}
}

export async function requestPersistentStorage(storage?: StorageManagerLike): Promise<boolean> {
	if (!storage?.persist) return false;
	try {
		return await storage.persist();
	} catch {
		return false;
	}
}
