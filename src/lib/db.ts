/**
 * Mash — Data Layer (Dexie + IndexedDB)
 *
 * Pure data layer. No imports from search.ts — the UI orchestrates search updates.
 * Dependency direction: search.ts → db.ts → (nothing)
 */

import Dexie, { type Table } from 'dexie';
import type { Note } from './types';

// =============================================================================
// DATABASE
// =============================================================================

const DB_NAME = 'mashdb-notes-v1';
const DB_VERSION = 1;

class MashDB extends Dexie {
	notes!: Table<Note, string>;

	constructor() {
		super(DB_NAME);
		this.version(DB_VERSION).stores({
			notes: 'id, modified, folder, pinned, *tags',
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
// CRUD — DB only. Search index updates are the UI's responsibility.
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
}): Promise<Note> {
	const note: Note = {
		id: newId(),
		title: normalizeTitle(partial.title),
		body: partial.body ?? '',
		folder: partial.folder ?? '',
		tags: partial.tags ?? [],
		links: partial.links ?? [],
		created: Date.now(),
		modified: Date.now(),
		pinned: 0,
	};

	await db.notes.add(note);
	return note;
}

/**
 * Retrieves all notes, sorted by pinned (desc) then modified (desc).
 */
export async function getActiveNotes(opts?: { limit?: number }): Promise<Note[]> {
	let collection = db.notes.orderBy('modified').reverse();

	if (opts?.limit) {
		collection = collection.limit(opts.limit);
	}

	const notes = await collection.toArray();

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
 * Deletes a note by ID. DB only — caller should also removeNoteFromSearch.
 */
export async function deleteNote(id: string): Promise<void> {
	await db.notes.delete(id);
}

/**
 * Fire-and-forget DB write. Used for optimistic UI updates where the
 * full Note is already known. Does NOT touch search — caller does that.
 */
export function syncNoteUpdate(id: string, partial: Partial<Note>): void {
	db.notes.update(id, { ...partial, modified: Date.now() }).catch((e) =>
		console.error('Mash syncNoteUpdate DB write failed:', e),
	);
}

/**
 * Returns all notes for search index hydration on startup.
 */
export async function getAllNotesForSearchIndex(): Promise<Note[]> {
	return db.notes.toArray();
}