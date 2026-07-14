/**
 * Whole-workspace backup and restore.
 *
 * Desk bundles remain the portable active-session format. Workspace backups
 * preserve every Mash session and validate/preview before any durable writes.
 */
import type { Canvas, CanvasEdge, CanvasItem, Note, NoteBlob, Operation, Session } from './types';
import { db, KEPT_COLLECTION_SESSION_ID } from './db';
import { FILE_FORMAT_LIMITS } from './file-intake';
import { exportAllDismissed, importDismissedMap, type DismissedByCanvas } from './canvas-dismiss';
import { bytesToDataUrl, extractBlobIdsFromNotes, getNoteBlobsByIds } from './note-blobs';
import {
	decodeSyncBlobs,
	mergeSyncBundle,
	parseSyncBundle,
	type SyncBlob,
	type SyncBundle,
	type SyncTombstone
} from './sync-file';
import type { SyncConflict } from './sync-model';
import { MASH_APP_VERSION } from './app-version';

export const WORKSPACE_BACKUP_VERSION = 6 as const;
export const WORKSPACE_BACKUP_MAX_CHARS = FILE_FORMAT_LIMITS.workspaceBackupBytes;
export const WORKSPACE_BACKUP_KIND = 'mash-backup' as const;

const MAX_SESSIONS = 200;
const MAX_APP_VERSION_CHARS = 80;
const MAX_ID_CHARS = 128;

export type WorkspaceBackupCounts = {
	sessions: number;
	notes: number;
	assets: number;
	operations: number;
};

export type WorkspaceBackup = {
	kind: typeof WORKSPACE_BACKUP_KIND;
	version: typeof WORKSPACE_BACKUP_VERSION;
	scope: 'workspace';
	exportedAt: number;
	appVersion: string;
	sessions: Session[];
	notes: Note[];
	canvases: Canvas[];
	canvasItems: CanvasItem[];
	canvasEdges: CanvasEdge[];
	operations: Operation[];
	blobs: SyncBlob[];
	tombstones: SyncTombstone[];
	dismissed: DismissedByCanvas;
	integrity: {
		algorithm: 'SHA-256';
		digest: string;
	};
};

export type WorkspaceSnapshot = {
	sessions: Session[];
	notes: Note[];
	canvases: Canvas[];
	canvasItems: CanvasItem[];
	canvasEdges: CanvasEdge[];
	operations: Operation[];
	assets: NoteBlob[];
	dismissed: DismissedByCanvas;
};

export type WorkspaceBackupRecord = {
	createdAt: number;
	workspaceChangedAt: number;
	bundleVersion: typeof WORKSPACE_BACKUP_VERSION;
	byteLength: number;
	digest: string;
	counts: WorkspaceBackupCounts;
};

export type WorkspaceRestorePlan = {
	version: number;
	exportedAt: number;
	counts: WorkspaceBackupCounts;
	added: number;
	updated: number;
	unchanged: number;
	removed: number;
	conflicts: number;
	warnings: string[];
};

export type WorkspaceRestoreReceipt = WorkspaceRestorePlan & {
	conflictsForReview: SyncConflict[];
};

export type WorkspaceBackupInspection =
	{ ok: true; backup: WorkspaceBackup; plan?: WorkspaceRestorePlan } | { ok: false; error: string };

type WorkspaceBackupPayload = Omit<WorkspaceBackup, 'integrity'>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function boundedId(value: unknown): string {
	return typeof value === 'string' ? value.trim().slice(0, MAX_ID_CHARS) : '';
}

function cloneSession(session: Session): Session {
	return { ...session };
}

function cloneNote(note: Note): Note {
	return {
		...note,
		tags: [...note.tags],
		...(note.links ? { links: [...note.links] } : {}),
		...(note.mashedFrom ? { mashedFrom: [...note.mashedFrom] } : {}),
		...(note.source ? { source: { ...note.source } } : {})
	};
}

function cloneCanvas(canvas: Canvas): Canvas {
	return {
		...canvas,
		...(canvas.bowls
			? {
					bowls: canvas.bowls.map((bowl) => ({ ...bowl, itemIds: [...bowl.itemIds] }))
				}
			: {})
	};
}

function cloneOperation(operation: Operation): Operation {
	return {
		...operation,
		inputNoteIds: [...operation.inputNoteIds],
		outputNoteIds: [...operation.outputNoteIds],
		...(operation.payload ? { payload: { ...operation.payload } } : {})
	};
}

function normalizeSession(raw: unknown, index: number): Session | string {
	if (!isRecord(raw)) return `Session ${index + 1} is not an object`;
	const id = boundedId(raw.id);
	if (!id) return `Session ${index + 1} is missing an id`;
	if (raw.mode !== 'scratch' && raw.mode !== 'kept') {
		return `Session ${index + 1} has an unsupported mode`;
	}
	if (raw.status !== 'active' && raw.status !== 'recovering') {
		return `Session ${index + 1} has an unsupported status`;
	}
	const now = Date.now();
	const session: Session = {
		id,
		title:
			typeof raw.title === 'string' ? raw.title.trim().slice(0, 200) || 'Mash desk' : 'Mash desk',
		mode: raw.mode,
		status: raw.status,
		created: finiteNumber(raw.created, now),
		modified: finiteNumber(raw.modified, now),
		lastMeaningfulActivityAt: finiteNumber(raw.lastMeaningfulActivityAt, now)
	};
	if (typeof raw.expiresAt === 'number' && Number.isFinite(raw.expiresAt)) {
		session.expiresAt = raw.expiresAt;
	}
	if (typeof raw.recoveryUntil === 'number' && Number.isFinite(raw.recoveryUntil)) {
		session.recoveryUntil = raw.recoveryUntil;
	}
	return session;
}

function rawIntegrity(value: unknown): WorkspaceBackup['integrity'] | null {
	if (!isRecord(value)) return null;
	if (value.algorithm !== 'SHA-256' || typeof value.digest !== 'string') return null;
	const digest = value.digest.trim().toLowerCase();
	return /^[a-f0-9]{64}$/.test(digest) ? { algorithm: 'SHA-256', digest } : null;
}

function stripIntegrity(value: Record<string, unknown>): Record<string, unknown> {
	const copy = { ...value };
	delete copy.integrity;
	return copy;
}

async function sha256(value: unknown): Promise<string> {
	const bytes = new TextEncoder().encode(JSON.stringify(value));
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function countsFor(backup: Pick<WorkspaceBackup, 'sessions' | 'notes' | 'blobs' | 'operations'>) {
	return {
		sessions: backup.sessions.length,
		notes: backup.notes.length,
		assets: backup.blobs.length,
		operations: backup.operations.length
	};
}

export async function collectWorkspaceSnapshot(): Promise<WorkspaceSnapshot> {
	const [sessions, notes, canvases, canvasItems, canvasEdges, operations] = await Promise.all([
		db.sessions.toArray(),
		db.notes.toArray(),
		db.canvases.toArray(),
		db.canvasItems.toArray(),
		db.canvasEdges.toArray(),
		db.operations.toArray()
	]);
	const materializedSessions = sessions.map(cloneSession);
	if (
		!materializedSessions.some((session) => session.id === KEPT_COLLECTION_SESSION_ID) &&
		notes.some((note) => note.sessionId === KEPT_COLLECTION_SESSION_ID)
	) {
		const keptNotes = notes.filter((note) => note.sessionId === KEPT_COLLECTION_SESSION_ID);
		const created = Math.min(...keptNotes.map((note) => note.created));
		const modified = Math.max(...keptNotes.map((note) => note.modified));
		materializedSessions.push({
			id: KEPT_COLLECTION_SESSION_ID,
			title: 'Kept takeaways',
			mode: 'kept',
			status: 'active',
			created,
			modified,
			lastMeaningfulActivityAt: modified
		});
	}
	const activeNotes = notes.filter((note) => note.deletedAt == null);
	const assets = await getNoteBlobsByIds(extractBlobIdsFromNotes(activeNotes));
	return {
		sessions: materializedSessions,
		notes: notes.map(cloneNote),
		canvases: canvases.map(cloneCanvas),
		canvasItems: canvasItems.map((item) => ({ ...item })),
		canvasEdges: canvasEdges.map((edge) => ({ ...edge })),
		operations: operations.map(cloneOperation),
		assets: assets.map((asset) => ({ ...asset, bytes: asset.bytes.slice(0) })),
		dismissed: exportAllDismissed()
	};
}

export function workspaceChangedAt(snapshot: WorkspaceSnapshot): number {
	return Math.max(
		0,
		...snapshot.sessions.flatMap((session) => [session.modified, session.lastMeaningfulActivityAt]),
		...snapshot.notes.flatMap((note) => [note.modified, note.deletedAt ?? 0]),
		...snapshot.canvases.map((canvas) => canvas.modified),
		...snapshot.operations.flatMap((operation) => [operation.created, operation.revertedAt ?? 0]),
		...snapshot.assets.map((asset) => asset.created)
	);
}

export async function inspectWorkspaceChangedAt(): Promise<{
	changedAt: number;
	hasContent: boolean;
}> {
	const snapshot = await collectWorkspaceSnapshot();
	const userNotes = snapshot.notes.filter(
		(note) => note.deletedAt == null && note.system !== 'mash-team-welcome'
	);
	return {
		changedAt: workspaceChangedAt(snapshot),
		hasContent: userNotes.length > 0 || snapshot.sessions.length > 1
	};
}

export async function buildWorkspaceBackup(
	appVersion = MASH_APP_VERSION,
	snapshot?: WorkspaceSnapshot
): Promise<WorkspaceBackup> {
	const source = snapshot ?? (await collectWorkspaceSnapshot());
	const notes = source.notes.filter((note) => note.deletedAt == null).map(cloneNote);
	const tombstones = source.notes.flatMap((note): SyncTombstone[] =>
		typeof note.deletedAt === 'number' ? [{ id: note.id, deletedAt: note.deletedAt }] : []
	);
	const blobs: SyncBlob[] = source.assets.map((asset) => ({
		id: asset.id,
		mime: asset.mime,
		width: asset.width,
		height: asset.height,
		dataBase64: bytesToDataUrl(asset.mime, asset.bytes).split(',')[1] ?? ''
	}));
	const payload: WorkspaceBackupPayload = {
		kind: WORKSPACE_BACKUP_KIND,
		version: WORKSPACE_BACKUP_VERSION,
		scope: 'workspace',
		exportedAt: Date.now(),
		appVersion: appVersion.slice(0, MAX_APP_VERSION_CHARS),
		sessions: source.sessions.map(cloneSession),
		notes,
		canvases: source.canvases.map(cloneCanvas),
		canvasItems: source.canvasItems.map((item) => ({ ...item })),
		canvasEdges: source.canvasEdges.map((edge) => ({ ...edge })),
		operations: source.operations.map(cloneOperation),
		blobs,
		tombstones,
		dismissed: Object.fromEntries(
			Object.entries(source.dismissed).map(([canvasId, ids]) => [canvasId, [...ids]])
		)
	};
	return {
		...payload,
		integrity: { algorithm: 'SHA-256', digest: await sha256(payload) }
	};
}

function parseWorkspaceBackupValue(data: unknown): WorkspaceBackupInspection {
	if (!isRecord(data)) return { ok: false, error: 'Not a MASH workspace backup' };
	if (data.kind !== WORKSPACE_BACKUP_KIND || data.scope !== 'workspace') {
		return { ok: false, error: 'This is not a MASH workspace backup' };
	}
	if (data.version !== WORKSPACE_BACKUP_VERSION) {
		return { ok: false, error: `Unsupported workspace backup version (${String(data.version)})` };
	}
	if (!Array.isArray(data.sessions) || data.sessions.length > MAX_SESSIONS) {
		return { ok: false, error: `Workspace backup has too many sessions (max ${MAX_SESSIONS})` };
	}
	const sessions: Session[] = [];
	const sessionIds = new Set<string>();
	for (let index = 0; index < data.sessions.length; index++) {
		const normalized = normalizeSession(data.sessions[index], index);
		if (typeof normalized === 'string') return { ok: false, error: normalized };
		if (sessionIds.has(normalized.id)) {
			return { ok: false, error: `Duplicate session id: ${normalized.id.slice(0, 40)}` };
		}
		sessionIds.add(normalized.id);
		sessions.push(normalized);
	}

	const validationCanvases = Array.isArray(data.canvases)
		? data.canvases.map((canvas) =>
				isRecord(canvas) ? { ...canvas, folder: boundedId(canvas.id) } : canvas
			)
		: data.canvases;
	const synthetic = {
		version: 5,
		exportedAt: finiteNumber(data.exportedAt, Date.now()),
		notes: data.notes,
		desk: {
			// The desk parser requires globally unique folders. Workspace folders
			// are unique per session, so validate structure with stable canvas IDs
			// here and enforce the real compound key after session metadata returns.
			canvases: validationCanvases,
			items: data.canvasItems,
			edges: data.canvasEdges,
			dismissed: data.dismissed
		},
		tombstones: data.tombstones,
		operations: data.operations,
		blobs: data.blobs
	};
	const parsed = parseSyncBundle(JSON.stringify(synthetic), {
		maxChars: WORKSPACE_BACKUP_MAX_CHARS,
		// Whole-workspace backups can contain many individually bounded desk images.
		// Their serialized file limit remains the aggregate safety boundary.
		maxTotalBlobBase64Chars: WORKSPACE_BACKUP_MAX_CHARS
	});
	if (!parsed.ok) return { ok: false, error: parsed.error };

	const rawNotes = new Map(
		(Array.isArray(data.notes) ? data.notes : [])
			.filter(isRecord)
			.map((note) => [boundedId(note.id), note] as const)
	);
	const notes = parsed.bundle.notes.map((note) => {
		const raw = rawNotes.get(note.id);
		const sessionId = boundedId(raw?.sessionId);
		return {
			...note,
			...(sessionId ? { sessionId } : {}),
			...(raw?.scope === 'session' || raw?.scope === 'kept' ? { scope: raw.scope } : {}),
			...(typeof raw?.keptAt === 'number' && Number.isFinite(raw.keptAt)
				? { keptAt: raw.keptAt }
				: {}),
			...(raw?.system === 'mash-team-welcome' ? { system: 'mash-team-welcome' } : {})
		} satisfies Note;
	});

	const rawCanvases = new Map(
		(Array.isArray(data.canvases) ? data.canvases : [])
			.filter(isRecord)
			.map((canvas) => [boundedId(canvas.id), canvas] as const)
	);
	const canvasFolders = new Set<string>();
	let hasDuplicateCanvasFolder = false;
	let duplicateCanvasFolder = '';
	const canvases = (parsed.bundle.desk?.canvases ?? []).map((canvas) => {
		const raw = rawCanvases.get(canvas.id);
		const sessionId = boundedId(raw?.sessionId);
		const folder = typeof raw?.folder === 'string' ? raw.folder.slice(0, 200) : '';
		const folderKey = JSON.stringify([sessionId, folder]);
		if (canvasFolders.has(folderKey)) {
			hasDuplicateCanvasFolder = true;
			duplicateCanvasFolder = folder;
		}
		canvasFolders.add(folderKey);
		return { ...canvas, folder, ...(sessionId ? { sessionId } : {}) } satisfies Canvas;
	});
	if (hasDuplicateCanvasFolder) {
		return {
			ok: false,
			error: `Duplicate canvas folder in session: ${duplicateCanvasFolder.slice(0, 40)}`
		};
	}

	for (const note of notes) {
		if (!note.sessionId || !sessionIds.has(note.sessionId)) {
			return { ok: false, error: `Note ${note.id.slice(0, 40)} has an unknown session` };
		}
	}
	for (const canvas of canvases) {
		if (!canvas.sessionId || !sessionIds.has(canvas.sessionId)) {
			return { ok: false, error: `Canvas ${canvas.id.slice(0, 40)} has an unknown session` };
		}
	}

	const noteIds = new Set(notes.map((note) => note.id));
	const blobIds = new Set((parsed.bundle.blobs ?? []).map((blob) => blob.id));
	for (const referencedId of extractBlobIdsFromNotes(notes)) {
		if (!blobIds.has(referencedId)) {
			return {
				ok: false,
				error: `Workspace backup is missing visual asset ${referencedId.slice(0, 40)}`
			};
		}
	}
	const canvasIds = new Set(canvases.map((canvas) => canvas.id));
	const canvasItems = parsed.bundle.desk?.items ?? [];
	const itemIds = new Set(canvasItems.map((item) => item.id));
	for (const item of canvasItems) {
		if (!canvasIds.has(item.canvasId) || !noteIds.has(item.noteId)) {
			return { ok: false, error: 'Workspace backup contains a broken canvas placement' };
		}
	}
	for (const edge of parsed.bundle.desk?.edges ?? []) {
		if (
			!canvasIds.has(edge.canvasId) ||
			!itemIds.has(edge.fromItemId) ||
			!itemIds.has(edge.toItemId)
		) {
			return { ok: false, error: 'Workspace backup contains a broken canvas connection' };
		}
	}

	const integrity = rawIntegrity(data.integrity);
	if (!integrity) return { ok: false, error: 'Workspace backup is missing its integrity check' };
	const backup: WorkspaceBackup = {
		kind: WORKSPACE_BACKUP_KIND,
		version: WORKSPACE_BACKUP_VERSION,
		scope: 'workspace',
		exportedAt: finiteNumber(data.exportedAt, Date.now()),
		appVersion:
			typeof data.appVersion === 'string'
				? data.appVersion.slice(0, MAX_APP_VERSION_CHARS)
				: 'unknown',
		sessions,
		notes,
		canvases,
		canvasItems: canvasItems.map((item) => ({ ...item })),
		canvasEdges: (parsed.bundle.desk?.edges ?? []).map((edge) => ({ ...edge })),
		operations: (parsed.bundle.operations ?? []).map(cloneOperation),
		blobs: (parsed.bundle.blobs ?? []).map((blob) => ({ ...blob })),
		tombstones: (parsed.bundle.tombstones ?? []).map((tombstone) => ({ ...tombstone })),
		dismissed: Object.fromEntries(
			Object.entries(parsed.bundle.desk?.dismissed ?? {}).map(([canvasId, ids]) => [
				canvasId,
				[...ids]
			])
		),
		integrity
	};
	return { ok: true, backup };
}

export async function inspectWorkspaceBackup(raw: string): Promise<WorkspaceBackupInspection> {
	if (raw.length > WORKSPACE_BACKUP_MAX_CHARS) {
		return { ok: false, error: 'Workspace backup is too large to open safely' };
	}
	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch {
		return { ok: false, error: 'Workspace backup is not valid JSON' };
	}
	if (!isRecord(data)) return { ok: false, error: 'Not a MASH workspace backup' };
	const integrity = rawIntegrity(data.integrity);
	if (!integrity) return { ok: false, error: 'Workspace backup is missing its integrity check' };
	const actual = await sha256(stripIntegrity(data));
	if (actual !== integrity.digest) {
		return { ok: false, error: 'Workspace backup failed its integrity check' };
	}
	return parseWorkspaceBackupValue(data);
}

export function planWorkspaceRestore(
	backup: WorkspaceBackup,
	local: WorkspaceSnapshot
): WorkspaceRestorePlan {
	const remoteSync: SyncBundle = {
		version: 5,
		exportedAt: backup.exportedAt,
		notes: backup.notes,
		tombstones: backup.tombstones
	};
	const { summary } = mergeSyncBundle(local.notes, remoteSync);
	let added = summary.added;
	let updated = summary.updated;
	let unchanged = summary.unchanged;

	function countRows<T extends { id: string }>(
		remote: T[],
		localRows: T[],
		remoteWins: (remoteRow: T, localRow: T) => boolean
	) {
		const localById = new Map(localRows.map((row) => [row.id, row]));
		for (const row of remote) {
			const current = localById.get(row.id);
			if (!current) added++;
			else if (JSON.stringify(current) === JSON.stringify(row)) unchanged++;
			else if (remoteWins(row, current)) updated++;
			else unchanged++;
		}
	}

	countRows(
		backup.sessions,
		local.sessions,
		(remote, current) => remote.modified >= current.modified
	);
	countRows(
		backup.canvases,
		local.canvases,
		(remote, current) => remote.modified >= current.modified
	);
	countRows(backup.canvasItems, local.canvasItems, () => true);
	countRows(backup.canvasEdges, local.canvasEdges, () => true);
	countRows(
		backup.operations,
		local.operations,
		(remote, current) =>
			(remote.revertedAt ?? remote.created) >= (current.revertedAt ?? current.created)
	);
	const localAssetIds = new Set(local.assets.map((asset) => asset.id));
	for (const blob of backup.blobs) {
		if (localAssetIds.has(blob.id)) unchanged++;
		else added++;
	}

	const localChanged = workspaceChangedAt(local);
	const warnings: string[] = [];
	if (backup.exportedAt < localChanged) {
		warnings.push('This backup predates changes in the current workspace. Newer local data wins.');
	}
	if (summary.conflicts.length > 0) {
		warnings.push(
			`${summary.conflicts.length} field conflict${summary.conflicts.length === 1 ? '' : 's'} will be kept for review.`
		);
	}
	return {
		version: backup.version,
		exportedAt: backup.exportedAt,
		counts: countsFor(backup),
		added,
		updated,
		unchanged,
		removed: summary.removed,
		conflicts: summary.conflicts.length,
		warnings
	};
}

export async function inspectAndPlanWorkspaceRestore(
	raw: string,
	local?: WorkspaceSnapshot
): Promise<WorkspaceBackupInspection> {
	const inspected = await inspectWorkspaceBackup(raw);
	if (!inspected.ok) return inspected;
	const snapshot = local ?? (await collectWorkspaceSnapshot());
	return {
		...inspected,
		plan: planWorkspaceRestore(inspected.backup, snapshot)
	};
}

export async function serializeAndVerifyWorkspaceBackup(
	appVersion = MASH_APP_VERSION,
	snapshot?: WorkspaceSnapshot
): Promise<{ raw: string; backup: WorkspaceBackup; record: WorkspaceBackupRecord }> {
	const source = snapshot ?? (await collectWorkspaceSnapshot());
	const backup = await buildWorkspaceBackup(appVersion, source);
	const raw = JSON.stringify(backup, null, 2);
	const inspected = await inspectWorkspaceBackup(raw);
	if (!inspected.ok) throw new Error(inspected.error);
	const expected = countsFor(backup);
	const actual = countsFor(inspected.backup);
	if (JSON.stringify(expected) !== JSON.stringify(actual)) {
		throw new Error('Workspace backup verification count mismatch');
	}
	return {
		raw,
		backup,
		record: {
			createdAt: backup.exportedAt,
			workspaceChangedAt: workspaceChangedAt(source),
			bundleVersion: WORKSPACE_BACKUP_VERSION,
			byteLength: new TextEncoder().encode(raw).byteLength,
			digest: backup.integrity.digest,
			counts: expected
		}
	};
}

export async function downloadWorkspaceBackup(
	filename = 'mash-workspace-backup.json',
	appVersion = MASH_APP_VERSION
): Promise<WorkspaceBackupRecord> {
	const { raw, record } = await serializeAndVerifyWorkspaceBackup(appVersion);
	const blob = new Blob([raw], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = filename;
	anchor.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
	return record;
}

export async function applyWorkspaceRestore(
	backup: WorkspaceBackup
): Promise<WorkspaceRestoreReceipt> {
	const local = await collectWorkspaceSnapshot();
	const plan = planWorkspaceRestore(backup, local);
	const remoteSync: SyncBundle = {
		version: 5,
		exportedAt: backup.exportedAt,
		notes: backup.notes,
		tombstones: backup.tombstones
	};
	const { notes: mergedNotes, summary: mergeSummary } = mergeSyncBundle(local.notes, remoteSync);
	const localSessions = new Map(local.sessions.map((session) => [session.id, session]));
	const sessionsToPut = backup.sessions.filter((session) => {
		const current = localSessions.get(session.id);
		return !current || session.modified >= current.modified;
	});
	const localCanvases = new Map(local.canvases.map((canvas) => [canvas.id, canvas]));
	const canvasesToPut = backup.canvases.filter((canvas) => {
		const current = localCanvases.get(canvas.id);
		return !current || canvas.modified >= current.modified;
	});
	const winningCanvasIds = new Set(canvasesToPut.map((canvas) => canvas.id));
	const itemsToPut = backup.canvasItems.filter((item) => winningCanvasIds.has(item.canvasId));
	const edgesToPut = backup.canvasEdges.filter((edge) => winningCanvasIds.has(edge.canvasId));
	const localOperations = new Map(local.operations.map((operation) => [operation.id, operation]));
	const operationsToPut = backup.operations.filter((operation) => {
		const current = localOperations.get(operation.id);
		return (
			!current ||
			(operation.revertedAt ?? operation.created) >= (current.revertedAt ?? current.created)
		);
	});
	const decodedBlobs = decodeSyncBlobs(backup.blobs);
	const deletedNoteIds = mergedNotes
		.filter((note) => note.deletedAt != null)
		.map((note) => note.id);

	await db.transaction(
		'rw',
		[
			db.sessions,
			db.notes,
			db.canvases,
			db.canvasItems,
			db.canvasEdges,
			db.operations,
			db.noteBlobs
		],
		async () => {
			if (sessionsToPut.length > 0) await db.sessions.bulkPut(sessionsToPut.map(cloneSession));
			if (mergedNotes.length > 0) await db.notes.bulkPut(mergedNotes.map(cloneNote));
			for (const canvasId of winningCanvasIds) {
				await db.canvasEdges.where('canvasId').equals(canvasId).delete();
				await db.canvasItems.where('canvasId').equals(canvasId).delete();
			}
			if (canvasesToPut.length > 0) await db.canvases.bulkPut(canvasesToPut.map(cloneCanvas));
			if (itemsToPut.length > 0)
				await db.canvasItems.bulkPut(itemsToPut.map((item) => ({ ...item })));
			if (edgesToPut.length > 0)
				await db.canvasEdges.bulkPut(edgesToPut.map((edge) => ({ ...edge })));
			if (operationsToPut.length > 0) {
				await db.operations.bulkPut(operationsToPut.map(cloneOperation));
			}
			if (decodedBlobs.length > 0) await db.noteBlobs.bulkPut(decodedBlobs);
			if (deletedNoteIds.length > 0) {
				const deletedItems = await db.canvasItems.where('noteId').anyOf(deletedNoteIds).toArray();
				const deletedItemIds = deletedItems.map((item) => item.id);
				if (deletedItemIds.length > 0) {
					const [fromEdges, toEdges] = await Promise.all([
						db.canvasEdges.where('fromItemId').anyOf(deletedItemIds).toArray(),
						db.canvasEdges.where('toItemId').anyOf(deletedItemIds).toArray()
					]);
					await db.canvasEdges.bulkDelete([
						...new Set([...fromEdges, ...toEdges].map((edge) => edge.id))
					]);
					await db.canvasItems.bulkDelete(deletedItemIds);
				}
			}
		}
	);
	importDismissedMap(backup.dismissed);
	return { ...plan, conflictsForReview: mergeSummary.conflicts };
}
