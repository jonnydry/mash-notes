/**
 * Lightweight undo stack for canvas layout mutations (move / resize / align).
 */

export type CanvasLayoutSnapshot = {
	itemId: string;
	x: number;
	y: number;
	w?: number;
	h?: number;
};

export type CanvasUndoEntry = {
	label: string;
	before: CanvasLayoutSnapshot[];
	after: CanvasLayoutSnapshot[];
};

const MAX_ENTRIES = 40;

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

	push(entry: CanvasUndoEntry): void {
		if (entry.before.length === 0) return;
		const meaningful = entry.before.some((b) => {
			const a = entry.after.find((x) => x.itemId === b.itemId);
			if (!a) return true;
			return a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h;
		});
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
}

/** Spatial reading order for canvas shift-range selection. */
export function spatialNoteOrder(
	items: Array<{ noteId: string; x: number; y: number }>
): string[] {
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
