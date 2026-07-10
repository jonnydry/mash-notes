/**
 * File-based sync transport on top of LWW merge.
 * Bundle v3 includes notes + desk + soft-delete tombstones.
 * v2 (notes + desk) and v1 (notes only) still import.
 */
import type { Canvas, CanvasEdge, CanvasItem, Note } from './types';
import { mergeNotesLww, hasConflicts, type MergeResult, type SyncConflict } from './sync-model';
import { normalizeImportedNote } from './import-notes';
import { db, getSyncTombstoneNotes, newId } from './db';
import { exportAllDismissed, importDismissedMap, type DismissedByCanvas } from './canvas-dismiss';

export const SYNC_BUNDLE_VERSION = 3 as const;
export const SYNC_BUNDLE_VERSION_V2 = 2 as const;
export const SYNC_BUNDLE_VERSION_V1 = 1 as const;

/** Keep soft-delete tombstones in sync exports for this long. */
export const TOMBSTONE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export type SyncTombstone = {
	id: string;
	deletedAt: number;
};

export type DeskSnapshot = {
	canvases: Canvas[];
	items: CanvasItem[];
	/** Directed flow edges between canvas items (optional on older bundles). */
	edges?: CanvasEdge[];
	/** canvasId → dismissed note ids */
	dismissed: DismissedByCanvas;
};

export type SyncBundle = {
	version:
		| typeof SYNC_BUNDLE_VERSION
		| typeof SYNC_BUNDLE_VERSION_V2
		| typeof SYNC_BUNDLE_VERSION_V1;
	exportedAt: number;
	notes: Note[];
	desk?: DeskSnapshot;
	tombstones?: SyncTombstone[];
};

export type DeskApplySummary = {
	canvasesUpserted: number;
	itemsUpserted: number;
	itemsSkipped: number;
	edgesUpserted: number;
	edgesSkipped: number;
};

export type SyncMergeSummary = {
	added: number;
	updated: number;
	unchanged: number;
	removed: number;
	results: MergeResult[];
	conflicts: SyncConflict[];
	desk?: DeskApplySummary;
};

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asString(v: unknown, fallback = ''): string {
	return typeof v === 'string' ? v : fallback;
}

function asNumber(v: unknown, fallback: number): number {
	return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function normalizeCanvas(raw: unknown, index: number): Canvas | string {
	if (!isRecord(raw)) return `Canvas ${index + 1} is not an object`;
	const id = asString(raw.id).trim();
	if (!id) return `Canvas ${index + 1} missing id`;
	const now = Date.now();
	return {
		id,
		folder: asString(raw.folder),
		title: asString(raw.title, 'Desk').slice(0, 200) || 'Desk',
		created: asNumber(raw.created, now),
		modified: asNumber(raw.modified, now)
	};
}

function normalizeCanvasItem(raw: unknown, index: number): CanvasItem | string {
	if (!isRecord(raw)) return `Canvas item ${index + 1} is not an object`;
	const id = asString(raw.id).trim() || newId();
	const canvasId = asString(raw.canvasId).trim();
	const noteId = asString(raw.noteId).trim();
	if (!canvasId || !noteId) return `Canvas item ${index + 1} missing canvasId/noteId`;
	const item: CanvasItem = {
		id,
		canvasId,
		noteId,
		x: asNumber(raw.x, 40),
		y: asNumber(raw.y, 40)
	};
	if (typeof raw.w === 'number' && Number.isFinite(raw.w)) item.w = raw.w;
	if (typeof raw.h === 'number' && Number.isFinite(raw.h)) item.h = raw.h;
	return item;
}

function normalizeCanvasEdge(raw: unknown, index: number): CanvasEdge | string {
	if (!isRecord(raw)) return `Canvas edge ${index + 1} is not an object`;
	const canvasId = asString(raw.canvasId).trim();
	const fromItemId = asString(raw.fromItemId).trim();
	const toItemId = asString(raw.toItemId).trim();
	if (!canvasId || !fromItemId || !toItemId) {
		return `Canvas edge ${index + 1} missing canvasId/from/to`;
	}
	if (fromItemId === toItemId) return `Canvas edge ${index + 1} is a self-loop`;
	return {
		id: asString(raw.id).trim() || newId(),
		canvasId,
		fromItemId,
		toItemId,
		created: asNumber(raw.created, Date.now())
	};
}

function normalizeDismissed(raw: unknown): DismissedByCanvas {
	if (!isRecord(raw)) return {};
	const out: DismissedByCanvas = {};
	for (const [canvasId, ids] of Object.entries(raw)) {
		if (!Array.isArray(ids)) continue;
		out[canvasId] = ids.filter((id): id is string => typeof id === 'string');
	}
	return out;
}

function normalizeDesk(raw: unknown): DeskSnapshot | string {
	if (raw == null) {
		return { canvases: [], items: [], edges: [], dismissed: {} };
	}
	if (!isRecord(raw)) return 'Desk snapshot is not an object';
	const canvasesRaw = Array.isArray(raw.canvases) ? raw.canvases : [];
	const itemsRaw = Array.isArray(raw.items) ? raw.items : [];
	const edgesRaw = Array.isArray(raw.edges) ? raw.edges : [];
	if (canvasesRaw.length > 200) return 'Too many canvases in sync bundle';
	if (itemsRaw.length > 20_000) return 'Too many canvas items in sync bundle';
	if (edgesRaw.length > 50_000) return 'Too many canvas edges in sync bundle';

	const canvases: Canvas[] = [];
	for (let i = 0; i < canvasesRaw.length; i++) {
		const c = normalizeCanvas(canvasesRaw[i], i);
		if (typeof c === 'string') return c;
		canvases.push(c);
	}
	const items: CanvasItem[] = [];
	for (let i = 0; i < itemsRaw.length; i++) {
		const item = normalizeCanvasItem(itemsRaw[i], i);
		if (typeof item === 'string') return item;
		items.push(item);
	}
	const edges: CanvasEdge[] = [];
	for (let i = 0; i < edgesRaw.length; i++) {
		const edge = normalizeCanvasEdge(edgesRaw[i], i);
		if (typeof edge === 'string') return edge;
		edges.push(edge);
	}
	return {
		canvases,
		items,
		edges,
		dismissed: normalizeDismissed(raw.dismissed)
	};
}

/** Load current desk layout from IndexedDB + local dismissals. */
export async function collectDeskSnapshot(): Promise<DeskSnapshot> {
	const canvases = await db.canvases.toArray();
	const items = await db.canvasItems.toArray();
	const edges = await db.canvasEdges.toArray();
	return {
		canvases: canvases.map((c) => ({ ...c })),
		items: items.map((i) => ({ ...i })),
		edges: edges.map((e) => ({ ...e })),
		dismissed: exportAllDismissed()
	};
}

export async function buildSyncBundle(notes: Note[]): Promise<SyncBundle> {
	const desk = await collectDeskSnapshot();
	const deleted = await getSyncTombstoneNotes(TOMBSTONE_RETENTION_MS);
	const active = notes
		.filter((n) => n.deletedAt == null)
		.map((n) => {
			const { deletedAt: _drop, ...rest } = n;
			return { ...rest };
		});
	const tombstones: SyncTombstone[] = deleted
		.filter((n) => typeof n.deletedAt === 'number')
		.map((n) => ({ id: n.id, deletedAt: n.deletedAt as number }));
	return {
		version: SYNC_BUNDLE_VERSION,
		exportedAt: Date.now(),
		notes: active,
		desk,
		tombstones
	};
}

function normalizeTombstones(raw: unknown): SyncTombstone[] | string {
	if (raw == null) return [];
	if (!Array.isArray(raw)) return 'Tombstones must be an array';
	if (raw.length > 5000) return 'Too many tombstones in sync bundle';
	const out: SyncTombstone[] = [];
	for (let i = 0; i < raw.length; i++) {
		const row = raw[i];
		if (!isRecord(row)) return `Tombstone ${i + 1} is not an object`;
		const id = asString(row.id).trim();
		const deletedAt = asNumber(row.deletedAt, NaN);
		if (!id || !Number.isFinite(deletedAt)) return `Tombstone ${i + 1} missing id/deletedAt`;
		out.push({ id, deletedAt });
	}
	return out;
}

export function parseSyncBundle(
	raw: string
): { ok: true; bundle: SyncBundle } | { ok: false; error: string } {
	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch {
		return { ok: false, error: 'Invalid JSON' };
	}
	if (!data || typeof data !== 'object') {
		return { ok: false, error: 'Not a sync bundle' };
	}
	const obj = data as Record<string, unknown>;
	const version = obj.version;
	if (
		version !== SYNC_BUNDLE_VERSION &&
		version !== SYNC_BUNDLE_VERSION_V2 &&
		version !== SYNC_BUNDLE_VERSION_V1
	) {
		return { ok: false, error: `Unsupported sync bundle version (${String(version)})` };
	}
	if (!Array.isArray(obj.notes)) {
		return { ok: false, error: 'Sync bundle missing notes array' };
	}
	if (obj.notes.length > 5000) {
		return { ok: false, error: 'Too many notes in sync bundle (max 5000)' };
	}

	const notes: Note[] = [];
	for (let i = 0; i < obj.notes.length; i++) {
		const result = normalizeImportedNote(obj.notes[i], i);
		if (typeof result === 'string') return { ok: false, error: result };
		// JSON / vault-style imports must not invent soft-deletes via deletedAt.
		const { deletedAt: _ignored, ...active } = result as Note & { deletedAt?: number };
		notes.push(active);
	}

	let desk: DeskSnapshot | undefined;
	if (version === SYNC_BUNDLE_VERSION || version === SYNC_BUNDLE_VERSION_V2) {
		const deskResult = normalizeDesk(obj.desk);
		if (typeof deskResult === 'string') return { ok: false, error: deskResult };
		desk = deskResult;
	}

	let tombstones: SyncTombstone[] | undefined;
	if (version === SYNC_BUNDLE_VERSION) {
		const tombResult = normalizeTombstones(obj.tombstones);
		if (typeof tombResult === 'string') return { ok: false, error: tombResult };
		tombstones = tombResult;
	}

	return {
		ok: true,
		bundle: {
			version: version as SyncBundle['version'],
			exportedAt: typeof obj.exportedAt === 'number' ? obj.exportedAt : Date.now(),
			notes,
			desk,
			tombstones
		}
	};
}

function stripCanvasForDeletedNote(noteId: string): Promise<void> {
	return (async () => {
		const items = await db.canvasItems.where('noteId').equals(noteId).toArray();
		for (const item of items) {
			const from = await db.canvasEdges.where('fromItemId').equals(item.id).toArray();
			const to = await db.canvasEdges.where('toItemId').equals(item.id).toArray();
			const ids = [...new Set([...from, ...to].map((e) => e.id))];
			if (ids.length > 0) await db.canvasEdges.bulkDelete(ids);
		}
		if (items.length > 0) {
			await db.canvasItems.bulkDelete(items.map((i) => i.id));
		}
	})();
}

/**
 * Merge remote bundle into local notes map.
 * Returns updated note list + conflict summary (LWW already chose winners).
 * Applies tombstones so deletes propagate across devices.
 */
export function mergeSyncBundle(
	localNotes: Note[],
	bundle: SyncBundle
): { notes: Note[]; summary: SyncMergeSummary } {
	const byId = new Map(localNotes.map((n) => [n.id, { ...n }]));
	const results: MergeResult[] = [];
	const conflicts: SyncConflict[] = [];
	let added = 0;
	let updated = 0;
	let unchanged = 0;
	let removed = 0;

	for (const remote of bundle.notes) {
		const local = byId.get(remote.id);
		if (!local) {
			byId.set(remote.id, { ...remote });
			added += 1;
			continue;
		}
		// Remote active note resurrects a locally soft-deleted note when newer.
		if (local.deletedAt != null) {
			if (remote.modified > local.deletedAt) {
				const { deletedAt: _d, ...rest } = local;
				const resurrected = { ...rest, ...remote };
				delete resurrected.deletedAt;
				byId.set(remote.id, resurrected);
				updated += 1;
			}
			continue;
		}
		const merged = mergeNotesLww(local, remote);
		results.push(merged);
		if (hasConflicts(merged)) {
			conflicts.push(...merged.conflicts);
		}
		const changed =
			merged.note.modified !== local.modified ||
			JSON.stringify(merged.note) !== JSON.stringify(local);
		if (changed) {
			byId.set(remote.id, merged.note);
			updated += 1;
		} else {
			unchanged += 1;
		}
	}

	for (const tomb of bundle.tombstones ?? []) {
		const local = byId.get(tomb.id);
		if (!local) {
			byId.set(tomb.id, {
				id: tomb.id,
				title: 'Deleted',
				body: '',
				folder: '',
				tags: [],
				created: tomb.deletedAt,
				modified: tomb.deletedAt,
				pinned: 0,
				deletedAt: tomb.deletedAt
			});
			removed += 1;
			continue;
		}
		if (local.deletedAt != null) {
			if (tomb.deletedAt > local.deletedAt) {
				byId.set(tomb.id, { ...local, deletedAt: tomb.deletedAt });
			}
			continue;
		}
		if (tomb.deletedAt >= local.modified) {
			byId.set(tomb.id, {
				...local,
				deletedAt: tomb.deletedAt,
				modified: Math.max(local.modified, tomb.deletedAt)
			});
			removed += 1;
		}
		// else: local is newer than tombstone — keep / drop tombstone on next export
	}

	const notes = [...byId.values()].sort((a, b) => b.modified - a.modified);
	return {
		notes,
		summary: { added, updated, unchanged, removed, results, conflicts }
	};
}

type DeskIdbApplyResult = DeskApplySummary & {
	remappedDismissed: DismissedByCanvas;
};

/**
 * Apply remote desk onto local IndexedDB only (no localStorage dismissals).
 * Canvases keyed by folder; items remapped to local canvas ids.
 * Newer canvas.modified wins placement for a note; otherwise keep local.
 * Joins an ambient Dexie transaction when one already covers these tables.
 */
async function applyDeskIdbSnapshot(
	desk: DeskSnapshot,
	knownNoteIds: Set<string>
): Promise<DeskIdbApplyResult> {
	const localCanvases = await db.canvases.toArray();
	const localByFolder = new Map(localCanvases.map((c) => [c.folder, c]));
	/** folder → effective modified used for LWW placement */
	const folderModified = new Map(localCanvases.map((c) => [c.folder, c.modified]));
	let canvasesUpserted = 0;
	let itemsUpserted = 0;
	let itemsSkipped = 0;
	let edgesUpserted = 0;
	let edgesSkipped = 0;

	/** remote canvas id → local canvas id */
	const idMap = new Map<string, string>();
	/** remote canvas item id → local canvas item id */
	const itemIdMap = new Map<string, string>();

	for (const remote of desk.canvases) {
		const local = localByFolder.get(remote.folder);
		if (!local) {
			const canvas: Canvas = {
				id: newId(),
				folder: remote.folder,
				title: remote.title,
				created: remote.created,
				modified: remote.modified
			};
			await db.canvases.put(canvas);
			idMap.set(remote.id, canvas.id);
			localByFolder.set(canvas.folder, canvas);
			folderModified.set(canvas.folder, canvas.modified);
			canvasesUpserted += 1;
			continue;
		}
		idMap.set(remote.id, local.id);
		if (remote.modified > local.modified) {
			await db.canvases.update(local.id, {
				title: remote.title,
				modified: remote.modified
			});
			folderModified.set(local.folder, remote.modified);
			canvasesUpserted += 1;
		}
	}

	for (const remoteItem of desk.items) {
		if (!knownNoteIds.has(remoteItem.noteId)) {
			itemsSkipped += 1;
			continue;
		}
		const localCanvasId = idMap.get(remoteItem.canvasId);
		const remoteCanvas = desk.canvases.find((c) => c.id === remoteItem.canvasId);
		if (!localCanvasId || !remoteCanvas) {
			itemsSkipped += 1;
			continue;
		}
		const localMod = folderModified.get(remoteCanvas.folder) ?? 0;
		const remoteNewer = remoteCanvas.modified >= localMod;

		const existing = await db.canvasItems
			.where('[canvasId+noteId]')
			.equals([localCanvasId, remoteItem.noteId])
			.first();

		if (!existing) {
			const localItemId = newId();
			await db.canvasItems.put({
				id: localItemId,
				canvasId: localCanvasId,
				noteId: remoteItem.noteId,
				x: remoteItem.x,
				y: remoteItem.y,
				w: remoteItem.w,
				h: remoteItem.h
			});
			itemIdMap.set(remoteItem.id, localItemId);
			itemsUpserted += 1;
			continue;
		}

		itemIdMap.set(remoteItem.id, existing.id);
		if (remoteNewer) {
			await db.canvasItems.update(existing.id, {
				x: remoteItem.x,
				y: remoteItem.y,
				w: remoteItem.w,
				h: remoteItem.h
			});
			itemsUpserted += 1;
		} else {
			itemsSkipped += 1;
		}
	}

	for (const remoteEdge of desk.edges ?? []) {
		const localCanvasId = idMap.get(remoteEdge.canvasId);
		const fromLocal = itemIdMap.get(remoteEdge.fromItemId);
		const toLocal = itemIdMap.get(remoteEdge.toItemId);
		if (!localCanvasId || !fromLocal || !toLocal || fromLocal === toLocal) {
			edgesSkipped += 1;
			continue;
		}
		const existing = await db.canvasEdges
			.where('[canvasId+fromItemId+toItemId]')
			.equals([localCanvasId, fromLocal, toLocal])
			.first();
		if (existing) {
			edgesSkipped += 1;
			continue;
		}
		await db.canvasEdges.put({
			id: newId(),
			canvasId: localCanvasId,
			fromItemId: fromLocal,
			toItemId: toLocal,
			created: remoteEdge.created
		});
		edgesUpserted += 1;
	}

	const remappedDismissed: DismissedByCanvas = {};
	for (const [remoteCanvasId, noteIds] of Object.entries(desk.dismissed)) {
		const localId = idMap.get(remoteCanvasId);
		if (!localId) continue;
		remappedDismissed[localId] = noteIds;
	}

	return {
		canvasesUpserted,
		itemsUpserted,
		itemsSkipped,
		edgesUpserted,
		edgesSkipped,
		remappedDismissed
	};
}

/**
 * Apply remote desk onto local IndexedDB, then merge dismissals into localStorage.
 */
export async function applyDeskSnapshot(
	desk: DeskSnapshot,
	knownNoteIds: Set<string>
): Promise<DeskApplySummary> {
	const { remappedDismissed, ...summary } = await applyDeskIdbSnapshot(desk, knownNoteIds);
	importDismissedMap(remappedDismissed);
	return summary;
}

/**
 * Persist merged notes + optional desk in one IndexedDB transaction.
 * Soft-deleted notes are written (tombstones) and stripped from canvases.
 * localStorage dismissals apply only after the transaction commits.
 */
export async function persistMergedSync(
	plainNotes: Note[],
	desk: DeskSnapshot | undefined,
	knownNoteIds: Set<string>
): Promise<{ desk?: DeskApplySummary }> {
	let deskSummary: DeskApplySummary | undefined;
	let remappedDismissed: DismissedByCanvas = {};
	const deletedIds = plainNotes.filter((n) => n.deletedAt != null).map((n) => n.id);

	await db.transaction('rw', db.notes, db.canvases, db.canvasItems, db.canvasEdges, async () => {
		await db.notes.bulkPut(plainNotes);
		for (const id of deletedIds) {
			await stripCanvasForDeletedNote(id);
		}
		if (desk) {
			const activeIds = new Set([...knownNoteIds].filter((id) => !deletedIds.includes(id)));
			const result = await applyDeskIdbSnapshot(desk, activeIds);
			const { remappedDismissed: remapped, ...summary } = result;
			deskSummary = summary;
			remappedDismissed = remapped;
		}
	});

	if (Object.keys(remappedDismissed).length > 0) {
		importDismissedMap(remappedDismissed);
	}

	return { desk: deskSummary };
}

export async function downloadSyncBundle(notes: Note[], filename = 'mash-sync-bundle.json') {
	const bundle = await buildSyncBundle(notes);
	const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	a.click();
	// Defer revoke — some browsers cancel the download if revoked synchronously.
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Human-readable conflict list for toasts / dialogs. */
export function formatConflictSummary(conflicts: SyncConflict[], limit = 6): string {
	if (conflicts.length === 0) return '';
	const lines = conflicts.slice(0, limit).map((c) => {
		const short = c.noteId.slice(0, 8);
		return `· ${short}… ${c.field} → kept ${c.chosen}`;
	});
	const more = conflicts.length > limit ? `\n· …and ${conflicts.length - limit} more` : '';
	return lines.join('\n') + more;
}
