import type { CanvasArrowEndpoint, CanvasColor, CanvasElement, CanvasItem } from './types';

export const CANVAS_COLORS = ['green', 'amber', 'blue', 'rose', 'violet', 'slate'] as const;
export const CANVAS_ARROW_ANCHORS = ['auto', 'top', 'right', 'bottom', 'left'] as const;

export function isCanvasColor(value: unknown): value is CanvasColor {
	return typeof value === 'string' && (CANVAS_COLORS as readonly string[]).includes(value);
}

export function canvasElementItemIds(element: CanvasElement): string[] {
	const ids: string[] = [];
	if (element.start.type === 'item') ids.push(element.start.itemId);
	if (element.end.type === 'item') ids.push(element.end.itemId);
	return [...new Set(ids)];
}

export function canvasElementBindsItem(element: CanvasElement, itemId: string): boolean {
	return canvasElementItemIds(element).includes(itemId);
}

export function cloneCanvasElement(element: CanvasElement): CanvasElement {
	return {
		...element,
		start: { ...element.start },
		end: { ...element.end }
	};
}

export function remapCanvasElement(
	element: CanvasElement,
	canvasId: string,
	itemIdMap: ReadonlyMap<string, string>,
	id: string
): CanvasElement | null {
	const remapEndpoint = (endpoint: CanvasArrowEndpoint): CanvasArrowEndpoint | null => {
		if (endpoint.type === 'point') return { ...endpoint };
		const itemId = itemIdMap.get(endpoint.itemId);
		return itemId ? { ...endpoint, itemId } : null;
	};
	const start = remapEndpoint(element.start);
	const end = remapEndpoint(element.end);
	if (!start || !end) return null;
	return { ...cloneCanvasElement(element), id, canvasId, start, end };
}

/** Return only elements whose canvas and bound card references still exist. */
export function cleanCanvasElements(
	elements: CanvasElement[],
	canvasIds: ReadonlySet<string>,
	items: Pick<CanvasItem, 'id' | 'canvasId'>[]
): CanvasElement[] {
	const itemCanvas = new Map(items.map((item) => [item.id, item.canvasId]));
	return elements.filter((element) => {
		if (!canvasIds.has(element.canvasId)) return false;
		return canvasElementItemIds(element).every(
			(itemId) => itemCanvas.get(itemId) === element.canvasId
		);
	});
}
