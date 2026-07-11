import type { CanvasItem, Note } from './types';

export type SetSortMode = 'title' | 'created';

function spatialCompare(a: CanvasItem, b: CanvasItem): number {
	return a.y - b.y || a.x - b.x || a.id.localeCompare(b.id);
}

/** Stable top-to-bottom, left-to-right reading order for set operations. */
export function spatialSetItems(items: CanvasItem[]): CanvasItem[] {
	return [...items].sort(spatialCompare);
}

/** Collapse a selection into a readable cascade while preserving its order. */
export function stackedSetMoves(
	items: CanvasItem[],
	offset: { x: number; y: number } = { x: 18, y: 16 }
): Array<{ itemId: string; x: number; y: number }> {
	if (items.length === 0) return [];
	const ordered = spatialSetItems(items);
	const originX = Math.min(...items.map((item) => item.x));
	const originY = Math.min(...items.map((item) => item.y));
	return ordered.map((item, index) => ({
		itemId: item.id,
		x: originX + index * offset.x,
		y: originY + index * offset.y
	}));
}

/** Expand a stack/set into a compact grid anchored at its current top-left. */
export function spreadSetMoves(
	items: CanvasItem[],
	gap = 24
): Array<{ itemId: string; x: number; y: number }> {
	if (items.length === 0) return [];
	const ordered = spatialSetItems(items);
	const originX = Math.min(...items.map((item) => item.x));
	const originY = Math.min(...items.map((item) => item.y));
	const columns = Math.ceil(Math.sqrt(items.length));
	const cellW = Math.max(...items.map((item) => item.w ?? 220));
	const cellH = Math.max(...items.map((item) => item.h ?? 120));
	return ordered.map((item, index) => ({
		itemId: item.id,
		x: originX + (index % columns) * (cellW + gap),
		y: originY + Math.floor(index / columns) * (cellH + gap)
	}));
}

export function sortedSetMoves(
	items: CanvasItem[],
	notesById: Map<string, Note>,
	mode: SetSortMode
): Array<{ itemId: string; x: number; y: number }> {
	const slots = spatialSetItems(items).map(({ x, y }) => ({ x, y }));
	const ordered = [...items].sort((a, b) => {
		const an = notesById.get(a.noteId);
		const bn = notesById.get(b.noteId);
		if (mode === 'created') {
			return (an?.created ?? 0) - (bn?.created ?? 0) || a.id.localeCompare(b.id);
		}
		return (
			(an?.title ?? '').localeCompare(bn?.title ?? '', undefined, { sensitivity: 'base' }) ||
			a.id.localeCompare(b.id)
		);
	});
	return ordered.map((item, index) => ({ itemId: item.id, ...slots[index]! }));
}

export function shuffledSetMoves(
	items: CanvasItem[],
	random: () => number = Math.random
): Array<{ itemId: string; x: number; y: number }> {
	const slots = spatialSetItems(items).map(({ x, y }) => ({ x, y }));
	const ordered = spatialSetItems(items);
	for (let index = ordered.length - 1; index > 0; index--) {
		const swap = Math.max(0, Math.min(index, Math.floor(random() * (index + 1))));
		[ordered[index], ordered[swap]] = [ordered[swap]!, ordered[index]!];
	}
	if (
		ordered.length > 1 &&
		ordered.every((item, index) => item.id === spatialSetItems(items)[index]?.id)
	) {
		ordered.push(ordered.shift()!);
	}
	return ordered.map((item, index) => ({ itemId: item.id, ...slots[index]! }));
}

function contentKey(note: Note | undefined): string | null {
	if (!note) return null;
	const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
	return `${normalize(note.title)}\n${normalize(note.body)}`;
}

export function deduplicateSet(
	items: CanvasItem[],
	notesById: Map<string, Note>
): { keepItemIds: string[]; removeItemIds: string[]; keepNoteIds: string[] } {
	const seen = new Set<string>();
	const keepItemIds: string[] = [];
	const removeItemIds: string[] = [];
	const keepNoteIds: string[] = [];
	for (const item of spatialSetItems(items)) {
		const key = contentKey(notesById.get(item.noteId));
		if (key === null || !seen.has(key)) {
			if (key !== null) seen.add(key);
			keepItemIds.push(item.id);
			keepNoteIds.push(item.noteId);
		} else {
			removeItemIds.push(item.id);
		}
	}
	return { keepItemIds, removeItemIds, keepNoteIds };
}
