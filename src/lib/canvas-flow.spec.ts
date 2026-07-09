import { describe, it, expect } from 'vitest';
import {
	wouldCreateCycle,
	wouldBreakLinearity,
	canLinkAsNextPage,
	listFlowSequences,
	orderCanvasFlow,
	flowOutlineMarkdown,
	flowPageBadges,
	layoutFlowSequence,
	findClearFlowOrigin,
	flowSequenceFootprint,
	FLOW_LAYOUT_GAP,
	flowEdgePath,
	edgesInSequence,
	invalidSequenceEdgeIds
} from './canvas-flow';
import type { CanvasEdge, CanvasItem } from './types';

function item(id: string, x: number, y: number, noteId = id): CanvasItem {
	return { id, canvasId: 'c', noteId, x, y, w: 220, h: 120 };
}

function edge(from: string, to: string, id = `${from}->${to}`): CanvasEdge {
	return { id, canvasId: 'c', fromItemId: from, toItemId: to, created: 1 };
}

describe('canvas-flow page sequences', () => {
	it('orders a simple next-page chain as one sequence', () => {
		const items = [item('a', 0, 0), item('b', 100, 0), item('c', 200, 0)];
		const edges = [edge('a', 'b'), edge('b', 'c')];
		const { sequences, orphans } = listFlowSequences(items, edges);
		expect(sequences).toHaveLength(1);
		expect(sequences[0].invalid).toBe(false);
		expect(sequences[0].pages.map((i) => i.id)).toEqual(['a', 'b', 'c']);
		expect(orphans).toHaveLength(0);
	});

	it('keeps two disjoint chains as separate sequences', () => {
		const items = [
			item('a', 0, 0),
			item('b', 100, 0),
			item('x', 0, 200),
			item('y', 100, 200),
			item('lonely', 0, 400)
		];
		const edges = [edge('a', 'b'), edge('x', 'y')];
		const { sequences, orphans } = listFlowSequences(items, edges);
		expect(sequences).toHaveLength(2);
		expect(sequences[0].pages.map((i) => i.id)).toEqual(['a', 'b']);
		expect(sequences[1].pages.map((i) => i.id)).toEqual(['x', 'y']);
		expect(orphans.map((i) => i.id)).toEqual(['lonely']);
	});

	it('rejects branching (already has a next page)', () => {
		const edges = [edge('a', 'b')];
		expect(wouldBreakLinearity(edges, 'a', 'c')).toBe('out');
		expect(canLinkAsNextPage(edges, 'a', 'c')).toEqual({ ok: false, reason: 'out' });
		expect(wouldBreakLinearity(edges, 'c', 'b')).toBe('in');
		expect(canLinkAsNextPage(edges, 'c', 'b')).toEqual({ ok: false, reason: 'in' });
		expect(canLinkAsNextPage(edges, 'b', 'c')).toEqual({ ok: true });
	});

	it('detects cycles', () => {
		const edges = [edge('a', 'b'), edge('b', 'c')];
		expect(wouldCreateCycle(edges, 'c', 'a')).toBe(true);
		expect(canLinkAsNextPage(edges, 'c', 'a')).toEqual({ ok: false, reason: 'cycle' });
	});

	it('marks branched components invalid', () => {
		const items = [item('a', 0, 0), item('b', 0, 50), item('c', 100, 100)];
		// Force a branch into storage (bypass canLink) to verify detection
		const edges = [edge('a', 'b'), edge('a', 'c')];
		const { sequences } = listFlowSequences(items, edges);
		expect(sequences).toHaveLength(1);
		expect(sequences[0].invalid).toBe(true);
	});

	it('builds multi-sequence outline and page badges', () => {
		const items = [item('a', 0, 0, 'n1'), item('b', 10, 0, 'n2'), item('x', 0, 100, 'n3')];
		const edges = [edge('a', 'b')];
		// x alone with no edge is orphan; add x→ self via second chain with y
		items.push(item('y', 10, 100, 'n4'));
		edges.push(edge('x', 'y'));
		const { sequences } = listFlowSequences(items, edges);
		const notes = new Map([
			['n1', { title: 'Logline', body: 'She gets everything.' }],
			['n2', { title: 'Act I', body: 'The golden cage.' }],
			['n3', { title: 'Alt open', body: 'Cold open B.' }],
			['n4', { title: 'Alt close', body: 'End card.' }]
		]);
		const md = flowOutlineMarkdown(sequences, notes);
		expect(md).toContain('## Sequence 1');
		expect(md).toContain('## Sequence 2');
		expect(md).toContain('1. Logline');
		const badges = flowPageBadges(sequences);
		expect(badges.get('a')).toEqual({ sequence: 1, page: 1 });
		expect(badges.get('b')).toEqual({ sequence: 1, page: 2 });
	});

	it('orderCanvasFlow still flattens for legacy callers', () => {
		const items = [item('a', 0, 0), item('b', 10, 0)];
		const { order } = orderCanvasFlow(items, [edge('a', 'b')]);
		expect(order.map((i) => i.id)).toEqual(['a', 'b']);
	});

	it('layoutFlowSequence packs pages left-to-right from the head', () => {
		const pages = [item('a', 50, 70), item('b', 10, 200), item('c', 400, 10)];
		const next = layoutFlowSequence(pages);
		expect(next.get('a')).toEqual({ x: 48, y: 72 });
		// 220 + 72 gap from 48 → 340, snapped to grid
		expect(next.get('b')).toEqual({ x: 336, y: 72 });
		expect(next.get('c')).toEqual({ x: 624, y: 72 });
	});

	it('layoutFlowSequence respects real card widths so tall cards do not overlap', () => {
		const pages = [
			{ ...item('a', 48, 48), w: 360, h: 320 },
			{ ...item('b', 100, 48), w: 220, h: 120 }
		];
		const next = layoutFlowSequence(pages);
		expect(next.get('a')).toEqual({ x: 48, y: 48 });
		// 48 + 360 + 72 = 480 (already on grid)
		expect(next.get('b')).toEqual({ x: 480, y: 48 });
	});

	it('layoutFlowSequence accepts an explicit origin', () => {
		const pages = [item('a', 50, 70), item('b', 10, 200)];
		const next = layoutFlowSequence(pages, { origin: { x: 96, y: 240 } });
		expect(next.get('a')).toEqual({ x: 96, y: 240 });
		expect(next.get('b')).toEqual({ x: 384, y: 240 });
	});

	it('layoutFlowSequence is a no-op for an empty chain', () => {
		expect(layoutFlowSequence([])).toEqual(new Map());
	});

	it('findClearFlowOrigin keeps the head when the sequence band is free', () => {
		const pages = [item('a', 48, 48), item('b', 100, 48)];
		const origin = findClearFlowOrigin(pages, [{ x: 48, y: 400, w: 220, h: 120 }], {
			prefer: { x: 48, y: 48 }
		});
		expect(origin).toEqual({ x: 48, y: 48 });
	});

	it('findClearFlowOrigin moves the row when a card sits in the arrow corridor', () => {
		const pages = [item('a', 48, 48), item('b', 400, 48)];
		// Obstacle between the two pages (same y band, in the gap).
		const mid = {
			x: 280,
			y: 48,
			w: 220,
			h: 120
		};
		const footprint = flowSequenceFootprint(pages);
		expect(footprint.w).toBe(220 + FLOW_LAYOUT_GAP + 220);
		const origin = findClearFlowOrigin(pages, [mid], {
			prefer: { x: 48, y: 48 }
		});
		expect(origin.y).toBeGreaterThan(48);
		expect(origin.x).toBe(48);
	});

	it('flowEdgePath runs left-to-right when target is to the right', () => {
		const path = flowEdgePath(
			{ x: 0, y: 0, w: 220, h: 120 },
			{ x: 260, y: 0, w: 220, h: 120 }
		);
		expect(path.d.startsWith('M 220 60')).toBe(true);
		expect(path.d.includes('260 60')).toBe(true);
		expect(path.midX).toBeGreaterThan(220);
	});

	it('edgesInSequence returns only links inside the page set', () => {
		const pages = [item('a', 0, 0), item('b', 100, 0)];
		const edges = [edge('a', 'b'), edge('b', 'c'), edge('x', 'y')];
		expect(edgesInSequence(pages, edges).map((e) => e.id)).toEqual(['a->b']);
	});

	it('invalidSequenceEdgeIds collects edges from invalid components only', () => {
		const items = [item('a', 0, 0), item('b', 100, 0), item('c', 200, 0)];
		// Branch: a→b and a→c is invalid
		const edges = [edge('a', 'b'), edge('a', 'c')];
		const { sequences } = listFlowSequences(items, edges);
		expect(sequences.some((s) => s.invalid)).toBe(true);
		const ids = invalidSequenceEdgeIds(sequences, edges);
		expect(ids.has('a->b')).toBe(true);
		expect(ids.has('a->c')).toBe(true);
	});
});
