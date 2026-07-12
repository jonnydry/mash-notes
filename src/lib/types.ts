/**
 * Mash — Shared Type Definitions
 *
 * Central place for core domain types so we don't duplicate them across
 * db, search, UI components, and future sync layers.
 */

/** Body text alignment in the sticky editor / preview. */
export type TextAlign = 'left' | 'center' | 'right';

export type SessionMode = 'scratch' | 'kept';
export type SessionStatus = 'active' | 'recovering';

/** A local working desk. Scratch sessions expire; kept sessions do not. */
export interface Session {
	id: string;
	title: string;
	mode: SessionMode;
	status: SessionStatus;
	created: number;
	modified: number;
	lastMeaningfulActivityAt: number;
	expiresAt?: number;
	recoveryUntil?: number;
}

export type NoteSource =
	| {
			kind: 'pdf';
			title: string;
			page: number;
	  }
	| {
			kind: 'docx';
			title: string;
	  }
	| {
			kind: 'image';
			title: string;
	  }
	| {
			kind: 'url';
			title: string;
			url: string;
	  }
	| {
			kind: 'html';
			title: string;
	  };

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
	/** Durable receipt that produced this note, for chained provenance. */
	operationId?: string;
	/** Sticky body alignment (edit + preview). Defaults to left when unset. */
	textAlign?: TextAlign;
	/** Origin metadata for captured source material such as PDF excerpts. */
	source?: NoteSource;
	/** Soft-delete timestamp for sync tombstones. Active notes omit this. */
	deletedAt?: number;
	/** Product-owned system note marker (e.g. permanent Mash team welcome). */
	system?: string;
	/** Desk that owns this note. Legacy/imported notes may omit until migration. */
	sessionId?: string;
	/** Session notes expire with a scratch desk; kept notes remain locally. */
	scope?: 'session' | 'kept';
	keptAt?: number;
}

/** Binary image payload stored out-of-line from note bodies (mash-blob: refs). */
export type NoteBlobMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';

export interface NoteBlob {
	id: string;
	mime: NoteBlobMime;
	bytes: ArrayBuffer;
	width: number;
	height: number;
	created: number;
}

/** A durable, local receipt for a deterministic set/content operation. */
export interface Operation {
	id: string;
	sessionId: string;
	type: string;
	inputNoteIds: string[];
	outputNoteIds: string[];
	payload?: Record<string, unknown>;
	created: number;
	revertedAt?: number;
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
	/** Owning desk. Legacy canvas records may omit until migration. */
	sessionId?: string;
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
