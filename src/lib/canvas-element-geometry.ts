import type {
	CanvasArrowAnchor,
	CanvasArrowElement,
	CanvasArrowEndpoint,
	CanvasItem
} from './types';

export type CanvasPoint = { x: number; y: number };
export type CanvasRect = { x: number; y: number; w: number; h: number };
export type CanvasArrowPath = {
	d: string;
	start: CanvasPoint;
	end: CanvasPoint;
	c1: CanvasPoint;
	c2: CanvasPoint;
	midX: number;
	midY: number;
};

function itemCenter(rect: CanvasRect): CanvasPoint {
	return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

function autoAnchor(rect: CanvasRect, toward: CanvasPoint): CanvasArrowAnchor {
	const center = itemCenter(rect);
	const dx = toward.x - center.x;
	const dy = toward.y - center.y;
	if (Math.abs(dx) * rect.h >= Math.abs(dy) * rect.w) return dx >= 0 ? 'right' : 'left';
	return dy >= 0 ? 'bottom' : 'top';
}

function pointForAnchor(
	rect: CanvasRect,
	anchor: CanvasArrowAnchor,
	toward: CanvasPoint
): CanvasPoint {
	const resolved = anchor === 'auto' ? autoAnchor(rect, toward) : anchor;
	switch (resolved) {
		case 'top':
			return { x: rect.x + rect.w / 2, y: rect.y };
		case 'right':
			return { x: rect.x + rect.w, y: rect.y + rect.h / 2 };
		case 'bottom':
			return { x: rect.x + rect.w / 2, y: rect.y + rect.h };
		case 'left':
			return { x: rect.x, y: rect.y + rect.h / 2 };
		default:
			return itemCenter(rect);
	}
}

function endpointHint(
	endpoint: CanvasArrowEndpoint,
	itemRects: ReadonlyMap<string, CanvasRect>
): CanvasPoint | null {
	if (endpoint.type === 'point') return { x: endpoint.x, y: endpoint.y };
	const rect = itemRects.get(endpoint.itemId);
	return rect ? itemCenter(rect) : null;
}

export function resolveCanvasArrowEndpoint(
	endpoint: CanvasArrowEndpoint,
	toward: CanvasPoint,
	itemRects: ReadonlyMap<string, CanvasRect>
): CanvasPoint | null {
	if (endpoint.type === 'point') return { x: endpoint.x, y: endpoint.y };
	const rect = itemRects.get(endpoint.itemId);
	return rect ? pointForAnchor(rect, endpoint.anchor, toward) : null;
}

export function canvasArrowPath(
	element: CanvasArrowElement,
	itemRects: ReadonlyMap<string, CanvasRect>
): CanvasArrowPath | null {
	const startHint = endpointHint(element.start, itemRects);
	const endHint = endpointHint(element.end, itemRects);
	if (!startHint || !endHint) return null;
	const start = resolveCanvasArrowEndpoint(element.start, endHint, itemRects);
	const end = resolveCanvasArrowEndpoint(element.end, startHint, itemRects);
	if (!start || !end) return null;

	const dx = end.x - start.x;
	const dy = end.y - start.y;
	const horizontal = Math.abs(dx) >= Math.abs(dy);
	const bend = Math.max(36, Math.min(180, Math.max(Math.abs(dx), Math.abs(dy)) * 0.42));
	const c1 = horizontal
		? { x: start.x + Math.sign(dx || 1) * bend, y: start.y }
		: { x: start.x, y: start.y + Math.sign(dy || 1) * bend };
	const c2 = horizontal
		? { x: end.x - Math.sign(dx || 1) * bend, y: end.y }
		: { x: end.x, y: end.y - Math.sign(dy || 1) * bend };

	const midX = (start.x + 3 * c1.x + 3 * c2.x + end.x) / 8;
	const midY = (start.y + 3 * c1.y + 3 * c2.y + end.y) / 8;
	return {
		d: `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`,
		start,
		end,
		c1,
		c2,
		midX,
		midY
	};
}

export function canvasItemRects(
	items: CanvasItem[],
	sizeFor: (item: CanvasItem) => { w: number; h: number }
): Map<string, CanvasRect> {
	return new Map(
		items.map((item) => {
			const size = sizeFor(item);
			return [item.id, { x: item.x, y: item.y, w: size.w, h: size.h }];
		})
	);
}
