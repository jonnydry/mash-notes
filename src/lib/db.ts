/**
 * Mash — Data Layer (Dexie + IndexedDB)
 *
 * Pure data layer. No imports from search.ts — the UI orchestrates search updates.
 * Dependency direction: search.ts → db.ts → (nothing)
 */

import Dexie, { type Table } from 'dexie';
import type { Canvas, CanvasEdge, CanvasItem, Note } from './types';
import { gridSlotPosition } from './canvas-geom';

// =============================================================================
// DATABASE
// =============================================================================

const DB_NAME = 'mashdb-notes-v1';

class MashDB extends Dexie {
	notes!: Table<Note, string>;
	canvases!: Table<Canvas, string>;
	canvasItems!: Table<CanvasItem, string>;
	canvasEdges!: Table<CanvasEdge, string>;

	constructor() {
		super(DB_NAME);
		this.version(1).stores({
			notes: 'id, modified, folder, pinned, *tags'
		});
		this.version(2).stores({
			notes: 'id, modified, folder, pinned, *tags',
			canvases: 'id, folder, modified',
			canvasItems: 'id, canvasId, noteId'
		});
		this.version(3)
			.stores({
				notes: 'id, modified, folder, pinned, *tags',
				canvases: 'id, folder, modified',
				canvasItems: 'id, canvasId, noteId, &[canvasId+noteId]'
			})
			.upgrade(async (tx) => {
				// Deduplicate any (canvasId, noteId) pairs before unique index applies.
				const table = tx.table('canvasItems');
				const all = await table.toArray();
				const seen = new Set<string>();
				const toDelete: string[] = [];
				for (const item of all) {
					const key = `${item.canvasId}::${item.noteId}`;
					if (seen.has(key)) toDelete.push(item.id);
					else seen.add(key);
				}
				if (toDelete.length > 0) await table.bulkDelete(toDelete);
			});
		this.version(4)
			.stores({
				notes: 'id, modified, folder, pinned, *tags',
				canvases: 'id, &folder, modified',
				canvasItems: 'id, canvasId, noteId, &[canvasId+noteId]'
			})
			.upgrade(async (tx) => {
				// One canvas per folder — keep the newest, drop the rest.
				const table = tx.table('canvases');
				const all = (await table.toArray()) as Canvas[];
				const best = new Map<string, Canvas>();
				const toDelete: string[] = [];
				for (const canvas of all) {
					const prev = best.get(canvas.folder);
					if (!prev || canvas.modified > prev.modified) {
						if (prev) toDelete.push(prev.id);
						best.set(canvas.folder, canvas);
					} else {
						toDelete.push(canvas.id);
					}
				}
				if (toDelete.length > 0) {
					const items = tx.table('canvasItems');
					for (const canvasId of toDelete) {
						await items.where('canvasId').equals(canvasId).delete();
					}
					await table.bulkDelete(toDelete);
				}
			});
		this.version(5).stores({
			notes: 'id, modified, folder, pinned, *tags',
			canvases: 'id, &folder, modified',
			canvasItems: 'id, canvasId, noteId, &[canvasId+noteId]',
			canvasEdges: 'id, canvasId, fromItemId, toItemId, &[canvasId+fromItemId+toItemId]'
		});
		this.version(6).stores({
			notes: 'id, modified, folder, pinned, deletedAt, *tags',
			canvases: 'id, &folder, modified',
			canvasItems: 'id, canvasId, noteId, &[canvasId+noteId]',
			canvasEdges: 'id, canvasId, fromItemId, toItemId, &[canvasId+fromItemId+toItemId]'
		});
	}
}

export const db = new MashDB();

// =============================================================================
// UTILITIES
// =============================================================================

export function newId(): string {
	return crypto.randomUUID();
}

function normalizeTitle(title: string | undefined): string {
	return (title?.trim() || 'Untitled').slice(0, 200);
}

// =============================================================================
// NOTES CRUD — DB only. Search index updates are the UI's responsibility.
// =============================================================================

/**
 * Creates a new note. Returns the full Note object.
 */
export async function createNote(partial: {
	title?: string;
	body?: string;
	folder?: string;
	tags?: string[];
	links?: string[];
	mashedFrom?: string[];
	pinned?: 0 | 1;
	textAlign?: Note['textAlign'];
}): Promise<Note> {
	const note: Note = {
		id: newId(),
		title: normalizeTitle(partial.title),
		body: partial.body ?? '',
		folder: partial.folder ?? '',
		tags: partial.tags ?? [],
		links: partial.links ?? [],
		mashedFrom: partial.mashedFrom,
		created: Date.now(),
		modified: Date.now(),
		pinned: partial.pinned === 1 ? 1 : 0,
		textAlign: partial.textAlign
	};

	await db.notes.add(note);
	return note;
}

/**
 * Retrieves active (non-deleted) notes, sorted by pinned (desc) then modified (desc).
 */
export async function getActiveNotes(opts?: { limit?: number }): Promise<Note[]> {
	let collection = db.notes.orderBy('modified').reverse();

	if (opts?.limit) {
		collection = collection.limit(opts.limit);
	}

	const notes = (await collection.toArray()).filter((n) => n.deletedAt == null);

	notes.sort((a, b) => {
		if (a.pinned !== b.pinned) return b.pinned - a.pinned;
		return b.modified - a.modified;
	});

	return notes;
}

/**
 * Updates a note by ID. Returns the full updated Note.
 */
export async function updateNote(id: string, changes: Partial<Note>): Promise<Note> {
	await db.notes.update(id, { ...changes, modified: Date.now() });
	const updated = await db.notes.get(id);
	if (!updated) throw new Error(`Note not found after update: ${id}`);
	return updated;
}

/**
 * Soft-deletes a note by ID. Sets deletedAt, strips canvas placements.
 * DB only — caller should also removeNoteFromSearch.
 */
export async function deleteNote(id: string): Promise<void> {
	const existing = await db.notes.get(id);
	if (!existing) return;
	const deletedAt = Date.now();
	await db.notes.put({ ...existing, deletedAt, modified: Math.max(existing.modified, deletedAt) });
	// Drop canvas placements + incident flow edges for this note
	const items = await db.canvasItems.where('noteId').equals(id).toArray();
	for (const item of items) {
		await removeEdgesForItem(item.id);
	}
	await db.canvasItems.where('noteId').equals(id).delete();
}

/**
 * Soft-deleted notes still within the sync tombstone retention window.
 */
export async function getSyncTombstoneNotes(maxAgeMs: number): Promise<Note[]> {
	const cutoff = Date.now() - maxAgeMs;
	const all = await db.notes.toArray();
	return all.filter(
		(n) => typeof n.deletedAt === 'number' && n.deletedAt >= cutoff
	);
}

/**
 * Fire-and-forget DB write. Used for optimistic UI updates where the
 * full Note is already known. Does NOT touch search — caller does that.
 */
export function syncNoteUpdate(id: string, partial: Partial<Note>): void {
	void syncNoteUpdateAsync(id, partial).catch((e) =>
		console.error('Mash syncNoteUpdate DB write failed:', e)
	);
}

/** Awaitable sticky persist — used when flushing before sync import. */
export async function syncNoteUpdateAsync(id: string, partial: Partial<Note>): Promise<void> {
	await db.notes.update(id, { ...partial, modified: Date.now() });
}

/**
 * Returns active notes for search index hydration on startup.
 */
export async function getAllNotesForSearchIndex(): Promise<Note[]> {
	const notes = await db.notes.toArray();
	return notes.filter((n) => n.deletedAt == null);
}

// =============================================================================
// CANVAS CRUD
// =============================================================================

/**
 * Get or create the default canvas for a folder path.
 * Unique on `folder` — concurrent callers share one canvas.
 * Pass `PINNED_CANVAS_KEY` for the dedicated Pinned desk.
 */
export async function getOrCreateFolderCanvas(folder: string): Promise<Canvas> {
	return db.transaction('rw', db.canvases, async () => {
		const existing = await db.canvases.where('folder').equals(folder).first();
		if (existing) return existing;

		const now = Date.now();
		const title =
			folder === '__mash_pinned__'
				? 'Pinned canvas'
				: folder
					? `${folder} canvas`
					: 'Root canvas';
		const canvas: Canvas = {
			id: newId(),
			folder,
			title,
			created: now,
			modified: now
		};
		try {
			await db.canvases.add(canvas);
			return canvas;
		} catch {
			const raced = await db.canvases.where('folder').equals(folder).first();
			if (raced) return raced;
			throw new Error('Failed to create folder canvas');
		}
	});
}

export async function getCanvasItems(canvasId: string): Promise<CanvasItem[]> {
	return db.canvasItems.where('canvasId').equals(canvasId).toArray();
}

export async function addNoteToCanvas(
	canvasId: string,
	noteId: string,
	pos?: { x: number; y: number; w?: number; h?: number }
): Promise<CanvasItem> {
	return db.transaction('rw', db.canvasItems, db.canvases, async () => {
		const existing = await db.canvasItems
			.where('[canvasId+noteId]')
			.equals([canvasId, noteId])
			.first();
		if (existing) return existing;

		const count = await db.canvasItems.where('canvasId').equals(canvasId).count();
		const slot = gridSlotPosition(count);
		const item: CanvasItem = {
			id: newId(),
			canvasId,
			noteId,
			x: pos?.x ?? slot.x,
			y: pos?.y ?? slot.y,
			w: pos?.w ?? 220,
			h: pos?.h ?? 120
		};
		try {
			await db.canvasItems.add(item);
			await db.canvases.update(canvasId, { modified: Date.now() });
			return item;
		} catch {
			const raced = await db.canvasItems
				.where('[canvasId+noteId]')
				.equals([canvasId, noteId])
				.first();
			if (raced) return raced;
			throw new Error('Failed to add note to canvas');
		}
	});
}

export async function updateCanvasItemPosition(
	id: string,
	pos: { x: number; y: number; w?: number; h?: number }
): Promise<void> {
	const item = await db.canvasItems.get(id);
	const patch: Partial<CanvasItem> = { x: pos.x, y: pos.y };
	if (pos.w !== undefined) patch.w = pos.w;
	if (pos.h !== undefined) patch.h = pos.h;
	await db.canvasItems.update(id, patch);
	if (item) {
		await db.canvases.update(item.canvasId, { modified: Date.now() });
	}
}

export async function removeCanvasItem(id: string): Promise<void> {
	const item = await db.canvasItems.get(id);
	await removeEdgesForItem(id);
	await db.canvasItems.delete(id);
	if (item) {
		await db.canvases.update(item.canvasId, { modified: Date.now() });
	}
}

export async function removeNotesFromCanvas(canvasId: string, noteIds: string[]): Promise<void> {
	if (noteIds.length === 0) return;
	const idSet = new Set(noteIds);
	const items = await db.canvasItems.where('canvasId').equals(canvasId).toArray();
	const toDelete = items.filter((i) => idSet.has(i.noteId)).map((i) => i.id);
	for (const itemId of toDelete) {
		await removeEdgesForItem(itemId);
	}
	await db.canvasItems.bulkDelete(toDelete);
	if (toDelete.length > 0) {
		await db.canvases.update(canvasId, { modified: Date.now() });
	}
}

// =============================================================================
// CANVAS FLOW EDGES
// =============================================================================

export async function listCanvasEdges(canvasId: string): Promise<CanvasEdge[]> {
	return db.canvasEdges.where('canvasId').equals(canvasId).toArray();
}

export async function addCanvasEdge(
	canvasId: string,
	fromItemId: string,
	toItemId: string
): Promise<CanvasEdge> {
	if (fromItemId === toItemId) {
		throw new Error('Cannot link a card to itself');
	}
	return db.transaction('rw', db.canvasEdges, db.canvases, async () => {
		const existing = await db.canvasEdges
			.where('[canvasId+fromItemId+toItemId]')
			.equals([canvasId, fromItemId, toItemId])
			.first();
		if (existing) return existing;

		const edge: CanvasEdge = {
			id: newId(),
			canvasId,
			fromItemId,
			toItemId,
			created: Date.now()
		};
		try {
			await db.canvasEdges.add(edge);
			await db.canvases.update(canvasId, { modified: Date.now() });
			return edge;
		} catch {
			const raced = await db.canvasEdges
				.where('[canvasId+fromItemId+toItemId]')
				.equals([canvasId, fromItemId, toItemId])
				.first();
			if (raced) return raced;
			throw new Error('Failed to add canvas edge');
		}
	});
}

export async function removeCanvasEdge(id: string): Promise<void> {
	const edge = await db.canvasEdges.get(id);
	await db.canvasEdges.delete(id);
	if (edge) {
		await db.canvases.update(edge.canvasId, { modified: Date.now() });
	}
}

/** Replace all edges on a canvas (used by undo/redo of link actions). */
export async function replaceCanvasEdges(
	canvasId: string,
	edges: CanvasEdge[]
): Promise<void> {
	await db.transaction('rw', db.canvasEdges, db.canvases, async () => {
		const existing = await db.canvasEdges.where('canvasId').equals(canvasId).toArray();
		if (existing.length > 0) {
			await db.canvasEdges.bulkDelete(existing.map((e) => e.id));
		}
		const next = edges.filter((e) => e.canvasId === canvasId);
		if (next.length > 0) {
			await db.canvasEdges.bulkAdd(next);
		}
		await db.canvases.update(canvasId, { modified: Date.now() });
	});
}

/** Delete all flow edges that touch a canvas item (as source or target). */
export async function removeEdgesForItem(itemId: string): Promise<void> {
	const from = await db.canvasEdges.where('fromItemId').equals(itemId).toArray();
	const to = await db.canvasEdges.where('toItemId').equals(itemId).toArray();
	const ids = [...new Set([...from, ...to].map((e) => e.id))];
	if (ids.length === 0) return;
	const canvasId = from[0]?.canvasId ?? to[0]?.canvasId;
	await db.canvasEdges.bulkDelete(ids);
	if (canvasId) {
		await db.canvases.update(canvasId, { modified: Date.now() });
	}
}
