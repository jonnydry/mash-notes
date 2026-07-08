/**
 * File-based sync transport on top of LWW merge.
 * Bundle v2 includes notes + desk layout (canvases, placements, dismissals).
 * v1 bundles (notes only) still import.
 */
import type { Canvas, CanvasItem, Note } from './types';
import { mergeNotesLww, hasConflicts, type MergeResult, type SyncConflict } from './sync-model';
import { normalizeImportedNote } from './import-notes';
import { db, newId } from './db';
import {
	exportAllDismissed,
	importDismissedMap,
	type DismissedByCanvas
} from './canvas-dismiss';

export const SYNC_BUNDLE_VERSION = 2 as const;
export const SYNC_BUNDLE_VERSION_V1 = 1 as const;

export type DeskSnapshot = {
	canvases: Canvas[];
	items: CanvasItem[];
	/** canvasId → dismissed note ids */
	dismissed: DismissedByCanvas;
};

export type SyncBundle = {
	version: typeof SYNC_BUNDLE_VERSION | typeof SYNC_BUNDLE_VERSION_V1;
	exportedAt: number;
	notes: Note[];
	desk?: DeskSnapshot;
};

export type DeskApplySummary = {
	canvasesUpserted: number;
	itemsUpserted: number;
	itemsSkipped: number;
};

export type SyncMergeSummary = {
	added: number;
	updated: number;
	unchanged: number;
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
		return { canvases: [], items: [], dismissed: {} };
	}
	if (!isRecord(raw)) return 'Desk snapshot is not an object';
	const canvasesRaw = Array.isArray(raw.canvases) ? raw.canvases : [];
	const itemsRaw = Array.isArray(raw.items) ? raw.items : [];
	if (canvasesRaw.length > 200) return 'Too many canvases in sync bundle';
	if (itemsRaw.length > 20_000) return 'Too many canvas items in sync bundle';

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
	return {
		canvases,
		items,
		dismissed: normalizeDismissed(raw.dismissed)
	};
}

/** Load current desk layout from IndexedDB + local dismissals. */
export async function collectDeskSnapshot(): Promise<DeskSnapshot> {
	const canvases = await db.canvases.toArray();
	const items = await db.canvasItems.toArray();
	return {
		canvases: canvases.map((c) => ({ ...c })),
		items: items.map((i) => ({ ...i })),
		dismissed: exportAllDismissed()
	};
}

export async function buildSyncBundle(notes: Note[]): Promise<SyncBundle> {
	const desk = await collectDeskSnapshot();
	return {
		version: SYNC_BUNDLE_VERSION,
		exportedAt: Date.now(),
		notes: notes.map((n) => ({ ...n })),
		desk
	};
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
	if (version !== SYNC_BUNDLE_VERSION && version !== SYNC_BUNDLE_VERSION_V1) {
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
		notes.push(result);
	}

	let desk: DeskSnapshot | undefined;
	if (version === SYNC_BUNDLE_VERSION) {
		const deskResult = normalizeDesk(obj.desk);
		if (typeof deskResult === 'string') return { ok: false, error: deskResult };
		desk = deskResult;
	}

	return {
		ok: true,
		bundle: {
			version: version as SyncBundle['version'],
			exportedAt: typeof obj.exportedAt === 'number' ? obj.exportedAt : Date.now(),
			notes,
			desk
		}
	};
}

/**
 * Merge remote bundle into local notes map.
 * Returns updated note list + conflict summary (LWW already chose winners).
 */
export function mergeSyncBundle(
	localNotes: Note[],
	bundle: SyncBundle
): { notes: Note[]; summary: SyncMergeSummary } {
	const byId = new Map(localNotes.map((n) => [n.id, n]));
	const results: MergeResult[] = [];
	const conflicts: SyncConflict[] = [];
	let added = 0;
	let updated = 0;
	let unchanged = 0;

	for (const remote of bundle.notes) {
		const local = byId.get(remote.id);
		if (!local) {
			byId.set(remote.id, { ...remote });
			added += 1;
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

	return {
		notes: [...byId.values()].sort((a, b) => b.modified - a.modified),
		summary: { added, updated, unchanged, results, conflicts }
	};
}

/**
 * Apply remote desk onto local IndexedDB.
 * Canvases keyed by folder; items remapped to local canvas ids.
 * Newer canvas.modified wins placement for a note; otherwise keep local.
 */
export async function applyDeskSnapshot(
	desk: DeskSnapshot,
	knownNoteIds: Set<string>
): Promise<DeskApplySummary> {
	const localCanvases = await db.canvases.toArray();
	const localByFolder = new Map(localCanvases.map((c) => [c.folder, c]));
	/** folder → effective modified used for LWW placement */
	const folderModified = new Map(localCanvases.map((c) => [c.folder, c.modified]));
	let canvasesUpserted = 0;
	let itemsUpserted = 0;
	let itemsSkipped = 0;

	/** remote canvas id → local canvas id */
	const idMap = new Map<string, string>();

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
			await db.canvasItems.put({
				id: newId(),
				canvasId: localCanvasId,
				noteId: remoteItem.noteId,
				x: remoteItem.x,
				y: remoteItem.y,
				w: remoteItem.w,
				h: remoteItem.h
			});
			itemsUpserted += 1;
			continue;
		}

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

	const remapped: DismissedByCanvas = {};
	for (const [remoteCanvasId, noteIds] of Object.entries(desk.dismissed)) {
		const localId = idMap.get(remoteCanvasId);
		if (!localId) continue;
		remapped[localId] = noteIds;
	}
	importDismissedMap(remapped);

	return { canvasesUpserted, itemsUpserted, itemsSkipped };
}

export async function downloadSyncBundle(
	notes: Note[],
	filename = 'mash-sync-bundle.json'
) {
	const bundle = await buildSyncBundle(notes);
	const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}

/** Human-readable conflict list for toasts / dialogs. */
export function formatConflictSummary(conflicts: SyncConflict[], limit = 6): string {
	if (conflicts.length === 0) return '';
	const lines = conflicts.slice(0, limit).map((c) => {
		const short = c.noteId.slice(0, 8);
		return `· ${short}… ${c.field} → kept ${c.chosen}`;
	});
	const more =
		conflicts.length > limit ? `\n· …and ${conflicts.length - limit} more` : '';
	return lines.join('\n') + more;
}
