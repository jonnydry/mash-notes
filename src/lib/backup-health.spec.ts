import { describe, expect, it } from 'vitest';
import { deriveBackupHealth, WORKSPACE_BACKUP_STALE_MS } from './backup-health';
import type { WorkspaceBackupRecord } from './workspace-backup';
import { WORKSPACE_BACKUP_VERSION } from './workspace-backup-version';

const record: WorkspaceBackupRecord = {
	createdAt: 1000,
	workspaceChangedAt: 900,
	bundleVersion: WORKSPACE_BACKUP_VERSION,
	byteLength: 100,
	digest: 'a'.repeat(64),
	counts: { sessions: 1, notes: 2, assets: 0, operations: 0 }
};

describe('workspace backup health', () => {
	it('stays quiet for an empty workspace', () => {
		expect(
			deriveBackupHealth({ hasContent: false, workspaceChangedAt: 0, record: null, now: 2000 })
		).toMatchObject({ state: 'empty', needsBackup: false });
	});

	it('distinguishes never backed up, changed, current, and stale', () => {
		expect(
			deriveBackupHealth({ hasContent: true, workspaceChangedAt: 900, record: null, now: 2000 })
				.state
		).toBe('never-backed-up');
		expect(
			deriveBackupHealth({ hasContent: true, workspaceChangedAt: 901, record, now: 2000 }).state
		).toBe('changes-since-backup');
		expect(
			deriveBackupHealth({ hasContent: true, workspaceChangedAt: 900, record, now: 2000 }).state
		).toBe('current');
		expect(
			deriveBackupHealth({
				hasContent: true,
				workspaceChangedAt: 900,
				record,
				now: record.createdAt + WORKSPACE_BACKUP_STALE_MS + 1
			}).state
		).toBe('stale');
	});

	it('prioritizes browser storage pressure', () => {
		expect(
			deriveBackupHealth({
				hasContent: true,
				workspaceChangedAt: 900,
				record,
				now: 2000,
				storagePressure: 'critical'
			})
		).toMatchObject({ state: 'storage-critical', needsBackup: true });
	});
});
