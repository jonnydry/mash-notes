/**
 * Local sync hygiene prefs — last export/import times for Settings + gentle reminders.
 * Stored in localStorage (same pattern as theme / dismissals).
 */

export const SYNC_HYGIENE_KEY = 'mash.syncHygiene';

/** Soft reminder when last export is older than this (or never). */
export const SYNC_BACKUP_REMINDER_MS = 7 * 24 * 60 * 60 * 1000;

export type SyncHygienePrefs = {
	lastExportAt: number | null;
	lastImportAt: number | null;
	/** Bundle `exportedAt` from the last successful import. */
	lastImportExportedAt: number | null;
};

const EMPTY: SyncHygienePrefs = {
	lastExportAt: null,
	lastImportAt: null,
	lastImportExportedAt: null
};

function isFiniteNumber(v: unknown): v is number {
	return typeof v === 'number' && Number.isFinite(v);
}

export function readSyncHygiene(): SyncHygienePrefs {
	if (typeof localStorage === 'undefined') return { ...EMPTY };
	try {
		const raw = localStorage.getItem(SYNC_HYGIENE_KEY);
		if (!raw) return { ...EMPTY };
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		return {
			lastExportAt: isFiniteNumber(parsed.lastExportAt) ? parsed.lastExportAt : null,
			lastImportAt: isFiniteNumber(parsed.lastImportAt) ? parsed.lastImportAt : null,
			lastImportExportedAt: isFiniteNumber(parsed.lastImportExportedAt)
				? parsed.lastImportExportedAt
				: null
		};
	} catch {
		return { ...EMPTY };
	}
}

function writeSyncHygiene(prefs: SyncHygienePrefs): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(SYNC_HYGIENE_KEY, JSON.stringify(prefs));
	} catch {
		/* private mode / blocked storage */
	}
}

export function recordSyncExport(at = Date.now()): SyncHygienePrefs {
	const next = { ...readSyncHygiene(), lastExportAt: at };
	writeSyncHygiene(next);
	return next;
}

export function recordSyncImport(
	bundleExportedAt: number,
	at = Date.now()
): SyncHygienePrefs {
	const next = {
		...readSyncHygiene(),
		lastImportAt: at,
		lastImportExportedAt: bundleExportedAt
	};
	writeSyncHygiene(next);
	return next;
}

/** True when the incoming bundle is older than our last local export. */
export function isStaleSyncBundle(
	bundleExportedAt: number,
	prefs: SyncHygienePrefs = readSyncHygiene()
): boolean {
	if (prefs.lastExportAt == null) return false;
	return bundleExportedAt < prefs.lastExportAt;
}

/**
 * Whether to gently remind the user to export a sync bundle.
 * Never exported + enough notes, or last export older than 7 days.
 */
export function shouldRemindSyncBackup(
	noteCount: number,
	prefs: SyncHygienePrefs = readSyncHygiene(),
	now = Date.now()
): boolean {
	if (prefs.lastExportAt == null) return noteCount >= 3;
	return now - prefs.lastExportAt > SYNC_BACKUP_REMINDER_MS;
}

export function syncBackupHint(
	prefs: SyncHygienePrefs = readSyncHygiene(),
	now = Date.now()
): string | null {
	if (prefs.lastExportAt == null) {
		return 'No sync export yet — export a bundle to back up this browser.';
	}
	if (now - prefs.lastExportAt > SYNC_BACKUP_REMINDER_MS) {
		return 'Last sync export was over a week ago — consider exporting again.';
	}
	return null;
}
