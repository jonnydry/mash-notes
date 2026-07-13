import type { CanvasBowl, CanvasItem } from './types';

export const BOWL_MIN_ITEMS = 2;
export const BOWL_PAD_X = 72;
export const BOWL_PAD_Y = 64;

export function cleanCanvasBowls(
	bowls: CanvasBowl[],
	validItemIds: Iterable<string>
): CanvasBowl[] {
	const valid = new Set(validItemIds);
	const claimed = new Set<string>();
	const cleaned: CanvasBowl[] = [];
	for (const bowl of bowls) {
		const itemIds = [...new Set(bowl.itemIds)].filter((id) => valid.has(id) && !claimed.has(id));
		if (itemIds.length < BOWL_MIN_ITEMS) continue;
		for (const id of itemIds) claimed.add(id);
		cleaned.push({ ...bowl, name: bowl.name.trim().slice(0, 80) || 'New bowl', itemIds });
	}
	return cleaned;
}

export function createBowlMembership(
	bowls: CanvasBowl[],
	itemIds: string[],
	input: { id: string; name?: string; now?: number }
): CanvasBowl[] {
	const ids = [...new Set(itemIds)];
	if (ids.length < BOWL_MIN_ITEMS) return bowls;
	const moving = new Set(ids);
	const now = input.now ?? Date.now();
	const remaining = bowls
		.map((bowl) => ({ ...bowl, itemIds: bowl.itemIds.filter((id) => !moving.has(id)) }))
		.filter((bowl) => bowl.itemIds.length >= BOWL_MIN_ITEMS);
	return [
		...remaining,
		{
			id: input.id,
			name: input.name?.trim().slice(0, 80) || 'New bowl',
			itemIds: ids,
			created: now,
			modified: now
		}
	];
}

export function removeItemsFromBowls(bowls: CanvasBowl[], itemIds: Iterable<string>): CanvasBowl[] {
	const remove = new Set(itemIds);
	return bowls
		.map((bowl) => ({ ...bowl, itemIds: bowl.itemIds.filter((id) => !remove.has(id)) }))
		.filter((bowl) => bowl.itemIds.length >= BOWL_MIN_ITEMS);
}

export function canvasBowlBounds(
	bowl: CanvasBowl,
	items: CanvasItem[],
	sizeFor: (item: CanvasItem) => { w: number; h: number }
): { x: number; y: number; w: number; h: number } | null {
	const memberIds = new Set(bowl.itemIds);
	const members = items.filter((item) => memberIds.has(item.id));
	if (members.length < BOWL_MIN_ITEMS) return null;
	let left = Infinity;
	let top = Infinity;
	let right = -Infinity;
	let bottom = -Infinity;
	for (const item of members) {
		const size = sizeFor(item);
		left = Math.min(left, item.x);
		top = Math.min(top, item.y);
		right = Math.max(right, item.x + size.w);
		bottom = Math.max(bottom, item.y + size.h);
	}
	return {
		x: left - BOWL_PAD_X,
		y: top - BOWL_PAD_Y,
		w: right - left + BOWL_PAD_X * 2,
		h: bottom - top + BOWL_PAD_Y * 2
	};
}
