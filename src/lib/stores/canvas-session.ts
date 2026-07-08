/**
 * Canvas session helpers — card sizes, bump/restore, spawn sizing.
 * Page owns reactive state; this module holds shared constants + pure helpers.
 */
import type { CanvasItem } from '$lib/types';
import { bumpOverlappingRects } from '$lib/canvas-geom';

export const COLLAPSED_CARD = { w: 220, h: 120 };
export const EXPANDED_CARD = { w: 360, h: 320 };
export const BUMP_GAP = 16;
export const NOTE_MIME = 'application/x-mash-notes';

export type CardSize = { w: number; h: number };

export function cardDisplaySize(
	item: CanvasItem,
	expandedNoteId: string | null
): CardSize {
	if (expandedNoteId && item.noteId === expandedNoteId) {
		return {
			w: item.w && item.w >= EXPANDED_CARD.w ? item.w : EXPANDED_CARD.w,
			h: item.h && item.h >= EXPANDED_CARD.h ? item.h : EXPANDED_CARD.h
		};
	}
	return {
		w: item.w ?? COLLAPSED_CARD.w,
		h: item.h ?? COLLAPSED_CARD.h
	};
}

export type BumpMove = { itemId: string; x: number; y: number };

/**
 * Compute neighbor pushes when `fixedItemId` expands to `size`.
 * Returns moves + a restore map of previous positions.
 */
export function computeExpandBumps(
	items: CanvasItem[],
	fixedItemId: string,
	size: CardSize,
	expandedNoteId: string | null
): { moves: BumpMove[]; restore: Map<string, { x: number; y: number }> } {
	const fixed = items.find((i) => i.id === fixedItemId);
	if (!fixed) return { moves: [], restore: new Map() };

	const fixedRect = {
		id: fixed.id,
		x: fixed.x,
		y: fixed.y,
		w: size.w,
		h: size.h
	};
	const others = items
		.filter((i) => i.id !== fixedItemId)
		.map((i) => {
			const s = cardDisplaySize(i, expandedNoteId);
			return { id: i.id, x: i.x, y: i.y, w: s.w, h: s.h };
		});

	const pushed = bumpOverlappingRects(fixedRect, others, BUMP_GAP);
	const restore = new Map<string, { x: number; y: number }>();
	const moves: BumpMove[] = [];
	for (const [id, pos] of pushed) {
		const cur = items.find((i) => i.id === id);
		if (!cur) continue;
		if (cur.x === pos.x && cur.y === pos.y) continue;
		restore.set(id, { x: cur.x, y: cur.y });
		moves.push({ itemId: id, x: pos.x, y: pos.y });
	}
	return { moves, restore };
}
