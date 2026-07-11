/**
 * Mash — Data Layer (Dexie + IndexedDB)
 *
 * Pure data layer. No imports from search.ts — the UI orchestrates search updates.
 * Dependency direction: search.ts → db.ts → (nothing)
 */

import Dexie, { type Table } from 'dexie';
import type {
	Canvas,
	CanvasEdge,
	CanvasItem,
	Note,
	Operation,
	Session,
	SessionMode
} from './types';
import { gridSlotPosition } from './canvas-geom';

// =============================================================================
// DATABASE
// =============================================================================

const DB_NAME = 'mashdb-notes-v1';
export const LEGACY_SESSION_ID = 'mash-legacy-kept-session-v1';

class MashDB extends Dexie {
	notes!: Table<Note, string>;
	sessions!: Table<Session, string>;
	canvases!: Table<Canvas, string>;
	canvasItems!: Table<CanvasItem, string>;
	canvasEdges!: Table<CanvasEdge, string>;
	operations!: Table<Operation, string>;

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
		this.version(7)
			.stores({
				notes: 'id, modified, folder, pinned, deletedAt, sessionId, scope, *tags',
				sessions: 'id, mode, status, modified, lastMeaningfulActivityAt, expiresAt, recoveryUntil',
				canvases: 'id, sessionId, folder, modified, &[sessionId+folder]',
				canvasItems: 'id, canvasId, noteId, &[canvasId+noteId]',
				canvasEdges: 'id, canvasId, fromItemId, toItemId, &[canvasId+fromItemId+toItemId]'
			})
			.upgrade(async (tx) => {
				const notes = (await tx.table('notes').toArray()) as Note[];
				const canvases = (await tx.table('canvases').toArray()) as Canvas[];
				if (notes.length === 0 && canvases.length === 0) return;

				const now = Date.now();
				const legacySession: Session = {
					id: LEGACY_SESSION_ID,
					title: 'My existing MASH desk',
					mode: 'kept',
					status: 'active',
					created: now,
					modified: now,
					lastMeaningfulActivityAt: now
				};
				await tx.table('sessions').put(legacySession);
				for (const note of notes) {
					await tx.table('notes').update(note.id, {
						sessionId: LEGACY_SESSION_ID,
						scope: 'kept',
						keptAt: note.modified || now
					});
				}
				for (const canvas of canvases) {
					await tx.table('canvases').update(canvas.id, { sessionId: LEGACY_SESSION_ID });
				}
			});
		this.version(8).stores({
			notes: 'id, modified, folder, pinned, deletedAt, sessionId, scope, operationId, *tags',
			sessions: 'id, mode, status, modified, lastMeaningfulActivityAt, expiresAt, recoveryUntil',
			canvases: 'id, sessionId, folder, modified, &[sessionId+folder]',
			canvasItems: 'id, canvasId, noteId, &[canvasId+noteId]',
			canvasEdges: 'id, canvasId, fromItemId, toItemId, &[canvasId+fromItemId+toItemId]',
			operations: 'id, sessionId, type, created, revertedAt, *inputNoteIds, *outputNoteIds'
		});
	}
}

export const db = new MashDB();
export const KEPT_COLLECTION_SESSION_ID = 'mash-kept-takeaways';

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
	operationId?: string;
	pinned?: 0 | 1;
	textAlign?: Note['textAlign'];
	source?: Note['source'];
	sessionId?: string;
	scope?: Note['scope'];
	keptAt?: number;
}): Promise<Note> {
	const note: Note = {
		id: newId(),
		title: normalizeTitle(partial.title),
		body: partial.body ?? '',
		folder: partial.folder ?? '',
		tags: partial.tags ?? [],
		links: partial.links ?? [],
		mashedFrom: partial.mashedFrom,
		operationId: partial.operationId,
		created: Date.now(),
		modified: Date.now(),
		pinned: partial.pinned === 1 ? 1 : 0,
		textAlign: partial.textAlign,
		source: partial.source,
		sessionId: partial.sessionId,
		scope: partial.scope,
		keptAt: partial.keptAt
	};

	await db.notes.add(note);
	return note;
}

/**
 * Retrieves active (non-deleted) notes, sorted by pinned (desc) then modified (desc).
 */
export async function getActiveNotes(opts?: {
	limit?: number;
	sessionId?: string;
	keptCollection?: boolean;
}): Promise<Note[]> {
	let notes = opts?.keptCollection
		? await db.notes.where('scope').equals('kept').toArray()
		: opts?.sessionId
			? await db.notes.where('sessionId').equals(opts.sessionId).toArray()
			: await db.notes.orderBy('modified').reverse().toArray();

	notes = notes.filter((n) => n.deletedAt == null);
	notes.sort((a, b) => {
		const aSystem = a.system === 'mash-team-welcome';
		const bSystem = b.system === 'mash-team-welcome';
		if (aSystem !== bSystem) return aSystem ? -1 : 1;
		if (a.pinned !== b.pinned) return b.pinned - a.pinned;
		return b.modified - a.modified;
	});
	if (opts?.limit) notes = notes.slice(0, opts.limit);

	return notes;
}

// =============================================================================
// SESSION LIFECYCLE
// =============================================================================

export async function createSessionRecord(input: {
	title?: string;
	mode: SessionMode;
	now?: number;
	expiresAt?: number;
}): Promise<Session> {
	const now = input.now ?? Date.now();
	const session: Session = {
		id: newId(),
		title: input.title?.trim() || (input.mode === 'scratch' ? 'Scratch desk' : 'Kept desk'),
		mode: input.mode,
		status: 'active',
		created: now,
		modified: now,
		lastMeaningfulActivityAt: now,
		expiresAt: input.mode === 'scratch' ? input.expiresAt : undefined
	};
	await db.sessions.add(session);
	return session;
}

export async function listSessionRecords(): Promise<Session[]> {
	const sessions = await db.sessions.toArray();
	return sessions.sort((a, b) => b.modified - a.modified);
}

export async function updateSessionRecord(id: string, patch: Partial<Session>): Promise<Session> {
	await db.sessions.update(id, patch);
	const session = await db.sessions.get(id);
	if (!session) throw new Error(`Session not found after update: ${id}`);
	return session;
}

function keptCollectionSession(now: number): Session {
	return {
		id: KEPT_COLLECTION_SESSION_ID,
		title: 'Kept takeaways',
		mode: 'kept',
		status: 'active',
		created: now,
		modified: now,
		lastMeaningfulActivityAt: now
	};
}

export async function promoteNotesToKept(
	sessionId: string,
	noteIds: string[],
	now = Date.now()
): Promise<Note[]> {
	const requested = new Set(noteIds);
	if (requested.size === 0) return [];
	return db.transaction('rw', db.sessions, db.notes, async () => {
		const candidates = await db.notes.where('sessionId').equals(sessionId).toArray();
		const promoted = candidates
			.filter((note) => requested.has(note.id) && note.deletedAt == null)
			.map((note) => ({ ...note, scope: 'kept' as const, keptAt: note.keptAt ?? now }));
		if (promoted.length === 0) return [];
		const existingCollection = await db.sessions.get(KEPT_COLLECTION_SESSION_ID);
		if (!existingCollection) await db.sessions.add(keptCollectionSession(now));
		else await db.sessions.update(KEPT_COLLECTION_SESSION_ID, { modified: now });
		await db.notes.bulkPut(promoted);
		return promoted;
	});
}

export async function deleteSessionPermanently(
	id: string,
	opts?: { preserveKeptNotes?: boolean }
): Promise<void> {
	await db.transaction(
		'rw',
		[db.sessions, db.notes, db.canvases, db.canvasItems, db.canvasEdges, db.operations],
		async () => {
			const canvases = await db.canvases.where('sessionId').equals(id).toArray();
			const canvasIds = canvases.map((canvas) => canvas.id);
			for (const canvasId of canvasIds) {
				await db.canvasEdges.where('canvasId').equals(canvasId).delete();
				await db.canvasItems.where('canvasId').equals(canvasId).delete();
			}
			if (canvasIds.length > 0) await db.canvases.bulkDelete(canvasIds);
			const notes = await db.notes.where('sessionId').equals(id).toArray();
			const keptNotes = opts?.preserveKeptNotes
				? notes.filter((note) => note.scope === 'kept' && note.deletedAt == null)
				: [];
			const keptIds = new Set(keptNotes.map((note) => note.id));
			const keptOperationIds = new Set(
				keptNotes
					.map((note) => note.operationId)
					.filter((operationId): operationId is string => Boolean(operationId))
			);
			if (keptNotes.length > 0) {
				const collection = await db.sessions.get(KEPT_COLLECTION_SESSION_ID);
				if (!collection) await db.sessions.add(keptCollectionSession(Date.now()));
				await db.notes.bulkPut(
					keptNotes.map((note) => ({ ...note, sessionId: KEPT_COLLECTION_SESSION_ID }))
				);
			}
			const deleteNoteIds = notes.filter((note) => !keptIds.has(note.id)).map((note) => note.id);
			if (deleteNoteIds.length > 0) await db.notes.bulkDelete(deleteNoteIds);
			const operations = await db.operations.where('sessionId').equals(id).toArray();
			for (const operation of operations) {
				if (keptOperationIds.has(operation.id)) {
					await db.operations.update(operation.id, { sessionId: KEPT_COLLECTION_SESSION_ID });
				} else {
					await db.operations.delete(operation.id);
				}
			}
			await db.sessions.delete(id);
		}
	);
}

export async function createOperationRecord(
	input: Omit<Operation, 'id' | 'created' | 'revertedAt'>
): Promise<Operation> {
	const operation: Operation = { ...input, id: newId(), created: Date.now() };
	await db.operations.add(operation);
	return operation;
}

export async function setOperationReverted(id: string, reverted: boolean): Promise<void> {
	await db.operations.update(id, { revertedAt: reverted ? Date.now() : undefined });
}

export async function listOperationRecords(sessionId: string): Promise<Operation[]> {
	const operations = await db.operations.where('sessionId').equals(sessionId).toArray();
	return operations.sort((a, b) => b.created - a.created);
}

/** Hard-replace generated note records during an in-session operation undo/redo. */
export async function replaceNoteSubset(
	affectedIds: string[],
	desiredNotes: Note[]
): Promise<void> {
	await db.transaction('rw', db.notes, async () => {
		if (affectedIds.length > 0) await db.notes.bulkDelete(affectedIds);
		if (desiredNotes.length > 0) {
			await db.notes.bulkPut(desiredNotes.map((note) => ({ ...note })));
		}
	});
}

/**
 * Updates a note by ID. Returns the full updated Note.
 */
export async function updateNote(id: string, changes: Partial<Note>): Promise<Note> {
	const existing = await db.notes.get(id);
	if (existing?.system === 'mash-team-welcome') return existing;
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
	if (existing.system === 'mash-team-welcome') return;
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
	return all.filter((n) => typeof n.deletedAt === 'number' && n.deletedAt >= cutoff);
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
	const existing = await db.notes.get(id);
	if (existing?.system === 'mash-team-welcome') return;
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
export async function getOrCreateFolderCanvas(folder: string, sessionId?: string): Promise<Canvas> {
	return db.transaction('rw', db.canvases, async () => {
		const existing = sessionId
			? await db.canvases.where('[sessionId+folder]').equals([sessionId, folder]).first()
			: await db.canvases.where('folder').equals(folder).first();
		if (existing) return existing;

		const now = Date.now();
		const title =
			folder === '__mash_pinned__' ? 'Pinned canvas' : folder ? `${folder} canvas` : 'Root canvas';
		const canvas: Canvas = {
			id: newId(),
			folder,
			title,
			created: now,
			modified: now,
			sessionId
		};
		try {
			await db.canvases.add(canvas);
			return canvas;
		} catch {
			const raced = sessionId
				? await db.canvases.where('[sessionId+folder]').equals([sessionId, folder]).first()
				: await db.canvases.where('folder').equals(folder).first();
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

/** Replace a known subset of canvas cards while preserving their stable ids (operator undo/redo). */
export async function replaceCanvasItemSubset(
	canvasId: string,
	affectedIds: string[],
	desiredItems: CanvasItem[]
): Promise<void> {
	await db.transaction('rw', db.canvasItems, db.canvases, async () => {
		if (affectedIds.length > 0) await db.canvasItems.bulkDelete(affectedIds);
		if (desiredItems.length > 0) await db.canvasItems.bulkPut(desiredItems);
		await db.canvases.update(canvasId, { modified: Date.now() });
	});
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
export async function replaceCanvasEdges(canvasId: string, edges: CanvasEdge[]): Promise<void> {
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
