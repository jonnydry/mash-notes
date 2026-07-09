import { describe, it, expect } from 'vitest';
import {
	wouldCreateCycle,
	wouldBreakLinearity,
	canLinkAsNextPage,
	listFlowSequences,
	orderCanvasFlow,
	flowOutlineMarkdown,
	flowPageBadges
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
});
