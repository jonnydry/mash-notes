/**
 * Mash — Shared Type Definitions
 * 
 * Central place for core domain types so we don't duplicate them across
 * db, search, UI components, and future sync layers.
 */

export interface Note {
    id: string;
    title: string;
    body: string;
    folder: string;
    tags: string[];
    created: number;
    modified: number;
    pinned: 0 | 1;
    links?: string[];
}

export interface Folder {
    path: string;
    name: string;
    parent: string;
    created: number;
    modified: number;
}

/**
 * Partial updates for a Note, excluding system-generated fields.
 */
export type NoteUpdate = Partial<Omit<Note, 'id' | 'created' | 'modified'>>;
