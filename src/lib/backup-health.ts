import type { StoragePressure } from './storage-health';
import type { WorkspaceBackupRecord } from './workspace-backup';
import { WORKSPACE_BACKUP_VERSION } from './workspace-backup-version';

export const WORKSPACE_BACKUP_RECORD_KEY = 'mash.workspaceBackupRecord';
export const WORKSPACE_BACKUP_STALE_MS = 7 * 24 * 60 * 60 * 1000;

export type BackupHealthState =
	| 'empty'
	| 'never-backed-up'
	| 'current'
	| 'changes-since-backup'
	| 'stale'
	| 'storage-warning'
	| 'storage-critical'
	| 'unknown';

export type BackupHealthView = {
	state: BackupHealthState;
	label: string;
	needsBackup: boolean;
};

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

export function readWorkspaceBackupRecord(): WorkspaceBackupRecord | null {
	if (typeof localStorage === 'undefined') return null;
	try {
		const raw = localStorage.getItem(WORKSPACE_BACKUP_RECORD_KEY);
		if (!raw) return null;
		const value = JSON.parse(raw) as Partial<WorkspaceBackupRecord>;
		if (
			!isFiniteNumber(value.createdAt) ||
			!isFiniteNumber(value.workspaceChangedAt) ||
			value.bundleVersion !== WORKSPACE_BACKUP_VERSION ||
			!isFiniteNumber(value.byteLength) ||
			typeof value.digest !== 'string' ||
			!value.counts ||
			!isFiniteNumber(value.counts.sessions) ||
			!isFiniteNumber(value.counts.notes) ||
			!isFiniteNumber(value.counts.assets) ||
			!isFiniteNumber(value.counts.operations)
		) {
			return null;
		}
		return value as WorkspaceBackupRecord;
	} catch {
		return null;
	}
}

export function recordWorkspaceBackup(record: WorkspaceBackupRecord): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(WORKSPACE_BACKUP_RECORD_KEY, JSON.stringify(record));
	} catch {
		/* Health metadata is best-effort; the downloaded backup remains valid. */
	}
}

function relativeBackupLabel(createdAt: number, now: number): string {
	const elapsed = Math.max(0, now - createdAt);
	if (elapsed < 24 * 60 * 60 * 1000) return 'Backed up today';
	const days = Math.max(1, Math.floor(elapsed / (24 * 60 * 60 * 1000)));
	return `Last backup ${days} day${days === 1 ? '' : 's'} ago`;
}

export function deriveBackupHealth(input: {
	hasContent: boolean;
	workspaceChangedAt: number;
	record: WorkspaceBackupRecord | null;
	now?: number;
	storagePressure?: StoragePressure;
}): BackupHealthView {
	const now = input.now ?? Date.now();
	if (!input.hasContent)
		return { state: 'empty', label: 'No backup needed yet', needsBackup: false };
	if (input.storagePressure === 'critical') {
		return {
			state: 'storage-critical',
			label: 'Storage nearly full · Back up now',
			needsBackup: true
		};
	}
	if (input.storagePressure === 'warning') {
		return {
			state: 'storage-warning',
			label: 'Storage getting full · Back up now',
			needsBackup: true
		};
	}
	if (!input.record) {
		return {
			state: 'never-backed-up',
			label: 'Only in this browser · Make a backup',
			needsBackup: true
		};
	}
	if (input.workspaceChangedAt > input.record.workspaceChangedAt) {
		return { state: 'changes-since-backup', label: 'Changes since last backup', needsBackup: true };
	}
	if (now - input.record.createdAt > WORKSPACE_BACKUP_STALE_MS) {
		return {
			state: 'stale',
			label: relativeBackupLabel(input.record.createdAt, now),
			needsBackup: true
		};
	}
	return {
		state: 'current',
		label: relativeBackupLabel(input.record.createdAt, now),
		needsBackup: false
	};
}
