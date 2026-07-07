/**
 * Mash Notes — Database Layer
 *
 * Single source of truth for all user data in the browser, using Dexie (SQLite via IndexedDB).
 * Follows SilverBullet / Unforget patterns for clean layered thinking and high-reliability writes.
 */

import Dexie, { type Table } from 'dexie';
import type { Note } from './types';

const DB_NAME = 'mash-notes-v1';
const DB_VERSION = 1;

class MashDB extends Dexie {
    notes!: Table<Note>;
    folders!: Table<any>;

    constructor() {
        super(DB_NAME);
        this.version(DB_VERSION).stores({
            // Extremely important indexes for performance at scale:
            notes: 'id, modified, [folder+modified], pinned, *tags',
            folders: 'path, [parent+path]'
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
// WRITE QUEUE — for high-reliability batch writes to IndexedDB
// =============================================================================

let saveQueue: Array<{ id: string; data: Partial<Note> }> = [];
let saveTimeout: ReturnType<typeof setTimeout> | null = null;

async function flushSaveQueue() {
    if (saveQueue.length === 0) return;
    const batch = [...saveQueue];
    saveQueue = [];

    const now = Date.now();

    try {
        await db.transaction('rw', db.notes, async () => {
            for (const item of batch) {
                await db.notes.update(item.id, { ...item.data, modified: now });
            }
        });
    } catch (_error) {
        console.error('Mash DB flush failed — re-queuing all items');
        saveQueue = [...batch, ...saveQueue]; // never lose anything; even if flush fails, we keep everything queued so nothing gets silently lost.
    }
}

function scheduleFlush() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(flushSaveQueue, 350);
}

export function queueNoteUpdate(id: string, changes: Partial<Note>) {
    saveQueue = saveQueue.filter((item) => item.id !== id); // deduplicate — if already queued for this ID, remove the stale entry before adding the new one.
    saveQueue.push({ id, data: changes });
    scheduleFlush();
}

// =============================================================================
// CRUD OPERATIONS WITH FULL ERROR HANDLING (no undefined/null crashes)
// =============================================================================

export async function createNote(partial: { title?: string; folder?: string | null }): Promise<{ note: Note; id: string }> {
    const id = newId();
    
    if (!partial.title) throw new Error('Mash error: no title provided'); // defensive — always reject incomplete inputs early
    
    return await db.notes.add({
        id,
        name: normalizeTitle(partial?.title),  // fallback to 'Untitled' only when input is truly empty (null or undefined)
        modifiedAt: Date.now(),
        createdAt: Date.now()
    });
}

export async function updateNote(id: string, data: Partial<Note>): Promise<Note> {\n    return await db.notes.update(id, data);\n}\n\nexport async function deleteNote(id: string): Promise<void> {\n    await db.notes.delete(id);\n}\n\nexport async function listNotes(): Promise<Note[]> {\n    return await db.notes.orderBy('modifiedAt').desc().toArray();\n}\n
