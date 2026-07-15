/**
 * Lightweight undo stack for canvas layout + flow-edge mutations.
 */

import type { CanvasEdge, CanvasElement, CanvasItem, Note } from './types';

export type CanvasLayoutSnapshot = {
	itemId: string;
	x: number;
	y: number;
	w?: number;
	h?: number;
};

export type CanvasUndoEntry = {
	label: string;
	/** Stable registry action id when this entry came from an operator. */
	actionId?: string;
	operationId?: string;
	operationRevertedBefore?: boolean;
	operationRevertedAfter?: boolean;
	mutation?: 'layout' | 'content';
	affectedNoteIds?: string[];
	before: CanvasLayoutSnapshot[];
	after: CanvasLayoutSnapshot[];
	/** Canvas-card membership before/after a content operator. */
	itemsBefore?: CanvasItem[];
	itemsAfter?: CanvasItem[];
	/** Generated note records before/after a content operator. */
	notesBefore?: Note[];
	notesAfter?: Note[];
	selectionBefore?: string[];
	selectionAfter?: string[];
	dismissedBefore?: string[];
	dismissedAfter?: string[];
	/** Full edge list before the action (when links changed). */
	edgesBefore?: CanvasEdge[];
	/** Full edge list after the action. */
	edgesAfter?: CanvasEdge[];
	/** Full cosmetic element list before/after a visual annotation action. */
	elementsBefore?: CanvasElement[];
	elementsAfter?: CanvasElement[];
};

const MAX_ENTRIES = 40;

function layoutChanged(before: CanvasLayoutSnapshot[], after: CanvasLayoutSnapshot[]): boolean {
	if (before.length === 0 && after.length === 0) return false;
	return before.some((b) => {
		const a = after.find((x) => x.itemId === b.itemId);
		if (!a) return true;
		return a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h;
	});
}

function edgesChanged(before?: CanvasEdge[], after?: CanvasEdge[]): boolean {
	if (!before && !after) return false;
	const b = before ?? [];
	const a = after ?? [];
	if (b.length !== a.length) return true;
	const aIds = new Set(a.map((e) => e.id));
	return b.some((e) => !aIds.has(e.id));
}

function itemsChanged(before?: CanvasItem[], after?: CanvasItem[]): boolean {
	if (!before && !after) return false;
	const b = before ?? [];
	const a = after ?? [];
	if (b.length !== a.length) return true;
	const byId = new Map(a.map((item) => [item.id, item]));
	return b.some((item) => {
		const next = byId.get(item.id);
		return !next || JSON.stringify(item) !== JSON.stringify(next);
	});
}

function elementsChanged(before?: CanvasElement[], after?: CanvasElement[]): boolean {
	if (!before && !after) return false;
	const b = before ?? [];
	const a = after ?? [];
	if (b.length !== a.length) return true;
	const byId = new Map(a.map((element) => [element.id, element]));
	return b.some((element) => JSON.stringify(element) !== JSON.stringify(byId.get(element.id)));
}

function notesChanged(before?: Note[], after?: Note[]): boolean {
	if (!before && !after) return false;
	const b = before ?? [];
	const a = after ?? [];
	if (b.length !== a.length) return true;
	const byId = new Map(a.map((note) => [note.id, note]));
	return b.some((note) => JSON.stringify(note) !== JSON.stringify(byId.get(note.id)));
}

export class CanvasUndoStack {
	private stack: CanvasUndoEntry[] = [];
	private redoStack: CanvasUndoEntry[] = [];

	get canUndo(): boolean {
		return this.stack.length > 0;
	}

	get canRedo(): boolean {
		return this.redoStack.length > 0;
	}

	get undoLabel(): string | null {
		return this.stack.at(-1)?.label ?? null;
	}

	get undoOperationId(): string | null {
		return this.stack.at(-1)?.operationId ?? null;
	}

	push(entry: CanvasUndoEntry): void {
		const meaningful =
			layoutChanged(entry.before, entry.after) ||
			edgesChanged(entry.edgesBefore, entry.edgesAfter) ||
			elementsChanged(entry.elementsBefore, entry.elementsAfter) ||
			itemsChanged(entry.itemsBefore, entry.itemsAfter) ||
			notesChanged(entry.notesBefore, entry.notesAfter);
		if (!meaningful) return;
		this.stack.push(entry);
		if (this.stack.length > MAX_ENTRIES) this.stack.shift();
		this.redoStack = [];
	}

	undo(): CanvasUndoEntry | null {
		const entry = this.stack.pop() ?? null;
		if (entry) this.redoStack.push(entry);
		return entry;
	}

	redo(): CanvasUndoEntry | null {
		const entry = this.redoStack.pop() ?? null;
		if (entry) this.stack.push(entry);
		return entry;
	}

	clear(): void {
		this.stack = [];
		this.redoStack = [];
	}

	/**
	 * Drop undo/redo entries that are invalidated by removed cards.
	 * Layout-only entries are pruned when they mention a removed id.
	 * Edge mutations are pruned only when a removed id appears on an edge
	 * (so dismissing an unrelated card keeps Link/Unlink history).
	 */
	pruneItemIds(itemIds: Iterable<string>): void {
		const drop = new Set(itemIds);
		if (drop.size === 0) return;
		const keep = (entry: CanvasUndoEntry): CanvasUndoEntry | null => {
			for (const item of [...(entry.itemsBefore ?? []), ...(entry.itemsAfter ?? [])]) {
				if (drop.has(item.id)) return null;
			}
			for (const element of [...(entry.elementsBefore ?? []), ...(entry.elementsAfter ?? [])]) {
				if (element.kind !== 'arrow') continue;
				if (element.start.type === 'item' && drop.has(element.start.itemId)) return null;
				if (element.end.type === 'item' && drop.has(element.end.itemId)) return null;
			}
			const hasEdgeChange =
				(entry.edgesBefore?.length ?? 0) > 0 || (entry.edgesAfter?.length ?? 0) > 0;
			if (hasEdgeChange) {
				for (const e of entry.edgesBefore ?? []) {
					if (drop.has(e.fromItemId) || drop.has(e.toItemId)) return null;
				}
				for (const e of entry.edgesAfter ?? []) {
					if (drop.has(e.fromItemId) || drop.has(e.toItemId)) return null;
				}
				return {
					...entry,
					before: entry.before.filter((s) => !drop.has(s.itemId)),
					after: entry.after.filter((s) => !drop.has(s.itemId))
				};
			}
			for (const s of entry.before) {
				if (drop.has(s.itemId)) return null;
			}
			for (const s of entry.after) {
				if (drop.has(s.itemId)) return null;
			}
			return entry;
		};
		this.stack = this.stack.map(keep).filter((e): e is CanvasUndoEntry => e !== null);
		this.redoStack = this.redoStack.map(keep).filter((e): e is CanvasUndoEntry => e !== null);
	}
}

/** Spatial reading order for canvas shift-range selection. */
export function spatialNoteOrder(items: Array<{ noteId: string; x: number; y: number }>): string[] {
	return [...items]
		.sort((a, b) => a.y - b.y || a.x - b.x || a.noteId.localeCompare(b.noteId))
		.map((i) => i.noteId);
}

export function rangeBetween(order: string[], fromId: string, toId: string): string[] {
	const from = order.indexOf(fromId);
	const to = order.indexOf(toId);
	if (from < 0 || to < 0) return [toId];
	const [lo, hi] = from < to ? [from, to] : [to, from];
	return order.slice(lo, hi + 1);
}
