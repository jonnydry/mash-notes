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
	/** Source note ids when this note was created by a Mash action. */
	mashedFrom?: string[];
}

export interface Folder {
	path: string;
	name: string;
	parent: string;
	created: number;
	modified: number;
}

/**
 * Freeform board inside a folder for arranging notes before combine/export.
 */
export interface Canvas {
	id: string;
	folder: string;
	title: string;
	created: number;
	modified: number;
}

/**
 * A note card placed on a canvas. Note content stays in the notes table.
 */
export interface CanvasItem {
	id: string;
	canvasId: string;
	noteId: string;
	x: number;
	y: number;
	w?: number;
	h?: number;
}

/**
 * Directed flow edge between two cards on a canvas (storyboard / page order).
 * References canvas items, not notes — same note can sit in different flows.
 */
export interface CanvasEdge {
	id: string;
	canvasId: string;
	fromItemId: string;
	toItemId: string;
	created: number;
}

/**
 * Partial updates for a Note, excluding system-generated fields.
 */
export type NoteUpdate = Partial<Omit<Note, 'id' | 'created' | 'modified'>>;
