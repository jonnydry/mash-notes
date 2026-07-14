import { describe, it, expect, beforeEach } from 'vitest';
import {
	readSyncHygiene,
	recordSyncExport,
	recordSyncImport,
	isStaleSyncBundle,
	shouldRemindSyncBackup,
	syncBackupHint,
	SYNC_HYGIENE_KEY,
	SYNC_BACKUP_REMINDER_MS
} from './sync-hygiene';

class MemoryStorage {
	private store = new Map<string, string>();
	clear() {
		this.store.clear();
	}
	get length() {
		return this.store.size;
	}
	key(index: number) {
		return [...this.store.keys()][index] ?? null;
	}
	getItem(key: string) {
		return this.store.has(key) ? this.store.get(key)! : null;
	}
	setItem(key: string, value: string) {
		this.store.set(key, String(value));
	}
	removeItem(key: string) {
		this.store.delete(key);
	}
}

Object.defineProperty(globalThis, 'localStorage', {
	value: new MemoryStorage(),
	configurable: true
});

describe('sync-hygiene', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it('starts empty and records export/import', () => {
		expect(readSyncHygiene()).toEqual({
			lastExportAt: null,
			lastImportAt: null,
			lastImportExportedAt: null
		});
		recordSyncExport(1000);
		expect(readSyncHygiene().lastExportAt).toBe(1000);
		recordSyncImport(900, 1100);
		const prefs = readSyncHygiene();
		expect(prefs.lastImportAt).toBe(1100);
		expect(prefs.lastImportExportedAt).toBe(900);
		expect(prefs.lastExportAt).toBe(1000);
		expect(localStorage.getItem(SYNC_HYGIENE_KEY)).toBeTruthy();
	});

	it('detects stale bundles older than last export', () => {
		recordSyncExport(5000);
		expect(isStaleSyncBundle(4000)).toBe(true);
		expect(isStaleSyncBundle(5000)).toBe(false);
		expect(isStaleSyncBundle(6000)).toBe(false);
	});

	it('reminds when never exported with enough notes', () => {
		expect(shouldRemindSyncBackup(2)).toBe(false);
		expect(shouldRemindSyncBackup(3)).toBe(true);
	});

	it('reminds when last export is older than 7 days', () => {
		const now = 10_000_000;
		recordSyncExport(now - SYNC_BACKUP_REMINDER_MS - 1);
		expect(shouldRemindSyncBackup(1, readSyncHygiene(), now)).toBe(true);
		recordSyncExport(now - 1000);
		expect(shouldRemindSyncBackup(10, readSyncHygiene(), now)).toBe(false);
	});

	it('builds quiet Settings hint copy', () => {
		expect(syncBackupHint()).toMatch(/No desk bundle/);
		const now = Date.now();
		recordSyncExport(now);
		expect(syncBackupHint(readSyncHygiene(), now)).toBeNull();
		recordSyncExport(now - SYNC_BACKUP_REMINDER_MS - 1);
		expect(syncBackupHint(readSyncHygiene(), now)).toMatch(/week/);
	});
});
