/**
 * Canvas flow — page sequences as linear next-page chains.
 *
 * A → B means “B is the next page after A” in that sequence.
 * Multiple disjoint chains on one board are separate export sequences.
 */
import type { CanvasEdge, CanvasItem } from './types';
import { GRID, GRID_ORIGIN, boundsOf, snapPoint, snapValue } from './canvas-geom';

export type FlowSequence = {
	id: string;
	/** Page order within this sequence (index 0 = page 1). */
	pages: CanvasItem[];
	/** True if this component isn’t a single path (branch/merge/cycle). */
	invalid: boolean;
};

export type FlowBoardResult = {
	sequences: FlowSequence[];
	/** Cards with no incident edges. */
	orphans: CanvasItem[];
};

function spatialCompare(a: CanvasItem, b: CanvasItem): number {
	if (a.y !== b.y) return a.y - b.y;
	if (a.x !== b.x) return a.x - b.x;
	return a.id.localeCompare(b.id);
}

function validEdges(items: CanvasItem[], edges: CanvasEdge[]): CanvasEdge[] {
	const itemIds = new Set(items.map((i) => i.id));
	return edges.filter(
		(e) => e.fromItemId !== e.toItemId && itemIds.has(e.fromItemId) && itemIds.has(e.toItemId)
	);
}

/** Would adding from→to create a cycle given existing edges? */
export function wouldCreateCycle(
	edges: CanvasEdge[],
	fromItemId: string,
	toItemId: string
): boolean {
	if (fromItemId === toItemId) return true;
	const adj = new Map<string, string[]>();
	for (const e of edges) {
		const list = adj.get(e.fromItemId);
		if (list) list.push(e.toItemId);
		else adj.set(e.fromItemId, [e.toItemId]);
	}
	const stack = [toItemId];
	const seen = new Set<string>();
	while (stack.length > 0) {
		const cur = stack.pop()!;
		if (cur === fromItemId) return true;
		if (seen.has(cur)) continue;
		seen.add(cur);
		const next = adj.get(cur);
		if (next) for (const n of next) stack.push(n);
	}
	return false;
}

/**
 * Next-page links must stay linear: each card has at most one successor
 * and one predecessor (so A→B means the immediate next page).
 */
export function wouldBreakLinearity(
	edges: CanvasEdge[],
	fromItemId: string,
	toItemId: string
): 'out' | 'in' | null {
	if (edges.some((e) => e.fromItemId === fromItemId)) return 'out';
	if (edges.some((e) => e.toItemId === toItemId)) return 'in';
	return null;
}

export type LinkBlockReason = 'self' | 'cycle' | 'out' | 'in';

export function canLinkAsNextPage(
	edges: CanvasEdge[],
	fromItemId: string,
	toItemId: string
): { ok: true } | { ok: false; reason: LinkBlockReason } {
	if (fromItemId === toItemId) return { ok: false, reason: 'self' };
	if (wouldCreateCycle(edges, fromItemId, toItemId)) {
		return { ok: false, reason: 'cycle' };
	}
	const branch = wouldBreakLinearity(edges, fromItemId, toItemId);
	if (branch) return { ok: false, reason: branch };
	return { ok: true };
}

/**
 * Split the board into independent page sequences (connected components
 * walked as linear chains). Branched/merged components are marked invalid.
 */
export function listFlowSequences(items: CanvasItem[], edges: CanvasEdge[]): FlowBoardResult {
	const byId = new Map(items.map((i) => [i.id, i]));
	const ve = validEdges(items, edges);

	const involved = new Set<string>();
	for (const e of ve) {
		involved.add(e.fromItemId);
		involved.add(e.toItemId);
	}

	const orphans = items.filter((i) => !involved.has(i.id)).sort(spatialCompare);

	if (ve.length === 0) {
		return { sequences: [], orphans };
	}

	const outs = new Map<string, string[]>();
	const ins = new Map<string, string[]>();
	for (const id of involved) {
		outs.set(id, []);
		ins.set(id, []);
	}
	for (const e of ve) {
		outs.get(e.fromItemId)!.push(e.toItemId);
		ins.get(e.toItemId)!.push(e.fromItemId);
	}

	// Undirected components
	const undirected = new Map<string, string[]>();
	for (const id of involved) undirected.set(id, []);
	for (const e of ve) {
		undirected.get(e.fromItemId)!.push(e.toItemId);
		undirected.get(e.toItemId)!.push(e.fromItemId);
	}

	const seen = new Set<string>();
	const components: string[][] = [];
	for (const start of [...involved].sort()) {
		if (seen.has(start)) continue;
		const stack = [start];
		const comp: string[] = [];
		seen.add(start);
		while (stack.length > 0) {
			const cur = stack.pop()!;
			comp.push(cur);
			for (const n of undirected.get(cur) ?? []) {
				if (seen.has(n)) continue;
				seen.add(n);
				stack.push(n);
			}
		}
		components.push(comp);
	}

	const sequences: FlowSequence[] = [];
	let seqIndex = 0;

	for (const comp of components) {
		const isLinear = comp.every(
			(id) => (outs.get(id)?.length ?? 0) <= 1 && (ins.get(id)?.length ?? 0) <= 1
		);

		const heads = comp
			.filter((id) => (ins.get(id)?.length ?? 0) === 0)
			.map((id) => byId.get(id)!)
			.filter(Boolean)
			.sort(spatialCompare);

		let pages: CanvasItem[] = [];
		let invalid = !isLinear || heads.length !== 1;

		if (isLinear && heads.length === 1) {
			let cur: string | undefined = heads[0].id;
			const walked = new Set<string>();
			while (cur && !walked.has(cur)) {
				walked.add(cur);
				const item = byId.get(cur);
				if (item) pages.push(item);
				cur = outs.get(cur)?.[0];
			}
			if (pages.length !== comp.length) invalid = true;
		} else {
			// Fallback display order for invalid components
			pages = comp
				.map((id) => byId.get(id)!)
				.filter(Boolean)
				.sort(spatialCompare);
			invalid = true;
		}

		seqIndex += 1;
		sequences.push({
			id: `seq-${seqIndex}`,
			pages,
			invalid
		});
	}

	// Stable order: by first page position
	sequences.sort((a, b) => {
		const ai = a.pages[0];
		const bi = b.pages[0];
		if (!ai || !bi) return 0;
		return spatialCompare(ai, bi);
	});
	// Re-id after sort for display
	sequences.forEach((s, i) => {
		s.id = `seq-${i + 1}`;
	});

	return { sequences, orphans };
}

/** @deprecated Prefer listFlowSequences — kept for callers that want a flat merge. */
export function orderCanvasFlow(
	items: CanvasItem[],
	edges: CanvasEdge[]
): { order: CanvasItem[]; cycles: boolean; orphans: CanvasItem[] } {
	const { sequences, orphans } = listFlowSequences(items, edges);
	const order = sequences.flatMap((s) => s.pages);
	const cycles = sequences.some((s) => s.invalid);
	return { order, cycles, orphans };
}

/** Markdown outline for one or more page sequences. */
export function flowOutlineMarkdown(
	sequences: FlowSequence[],
	notesById: Map<string, { title: string; body: string }>
): string {
	const blocks: string[] = [];
	for (let s = 0; s < sequences.length; s++) {
		const seq = sequences[s];
		const header =
			sequences.length > 1
				? `## Sequence ${s + 1}${seq.invalid ? ' (needs fixing)' : ''}`
				: `## Page sequence${seq.invalid ? ' (needs fixing)' : ''}`;
		const lines = seq.pages.map((item, i) => {
			const note = notesById.get(item.noteId);
			const title = note?.title?.trim() || 'Untitled';
			const firstLine =
				note?.body
					?.split('\n')
					.map((l) => l.trim())
					.find((l) => l.length > 0 && !l.startsWith('#')) ?? '';
			const snippet = firstLine.slice(0, 120);
			return snippet ? `${i + 1}. ${title} — ${snippet}` : `${i + 1}. ${title}`;
		});
		blocks.push([header, ...lines].join('\n'));
	}
	return blocks.join('\n\n');
}

/** Page badge lookup: itemId → { sequenceIndex (1-based), page (1-based) } */
export function flowPageBadges(
	sequences: FlowSequence[]
): Map<string, { sequence: number; page: number }> {
	const map = new Map<string, { sequence: number; page: number }>();
	sequences.forEach((seq, si) => {
		if (seq.invalid) return;
		seq.pages.forEach((item, pi) => {
			map.set(item.id, { sequence: si + 1, page: pi + 1 });
		});
	});
	return map;
}

/** Edges whose both ends sit in the given page set (the links that stitch a sequence). */
export function edgesInSequence(pages: CanvasItem[], edges: CanvasEdge[]): CanvasEdge[] {
	const ids = new Set(pages.map((p) => p.id));
	if (ids.size === 0) return [];
	return edges.filter((e) => ids.has(e.fromItemId) && ids.has(e.toItemId));
}

/** Edge ids that belong to invalid (branched/cyclic) sequences — for warn styling. */
export function invalidSequenceEdgeIds(
	sequences: FlowSequence[],
	edges: CanvasEdge[]
): Set<string> {
	const out = new Set<string>();
	for (const seq of sequences) {
		if (!seq.invalid) continue;
		for (const e of edgesInSequence(seq.pages, edges)) out.add(e.id);
	}
	return out;
}

/** Gap between sequenced cards — room for the arrow + unlink control. */
export const FLOW_LAYOUT_GAP = GRID * 3; // 72

/** Clearance between a sequence band and unrelated cards. */
export const FLOW_CLEAR_GAP = GRID; // 24

type FlowPageSize = { w?: number | null; h?: number | null };

/** Bounding size of a packed L→R sequence row (including inter-page gaps). */
export function flowSequenceFootprint(
	pages: FlowPageSize[],
	opts?: { gap?: number; defaultW?: number; defaultH?: number }
): { w: number; h: number } {
	if (pages.length === 0) return { w: 0, h: 0 };
	const gap = opts?.gap ?? FLOW_LAYOUT_GAP;
	const defaultW = opts?.defaultW ?? 220;
	const defaultH = opts?.defaultH ?? 120;
	let w = 0;
	let h = 0;
	for (let i = 0; i < pages.length; i++) {
		const page = pages[i]!;
		const pw = page.w && page.w > 0 ? page.w : defaultW;
		const ph = page.h && page.h > 0 ? page.h : defaultH;
		w += pw + (i > 0 ? gap : 0);
		h = Math.max(h, ph);
	}
	return { w, h };
}

function bandOverlapsObstacle(
	band: { x: number; y: number; w: number; h: number },
	obstacle: { x: number; y: number; w: number; h: number },
	gap: number
): boolean {
	return !(
		band.x + band.w + gap <= obstacle.x ||
		obstacle.x + obstacle.w + gap <= band.x ||
		band.y + band.h + gap <= obstacle.y ||
		obstacle.y + obstacle.h + gap <= band.y
	);
}

/**
 * Pick a snapped origin for a sequence row that doesn’t collide with
 * unrelated cards — including cards sitting in the arrow corridor.
 * Prefers the head’s current spot when that band is already clear.
 */
export function findClearFlowOrigin(
	pages: FlowPageSize[],
	obstacles: Array<{ x: number; y: number; w: number; h: number }>,
	opts?: {
		gap?: number;
		clearGap?: number;
		defaultW?: number;
		defaultH?: number;
		prefer?: { x: number; y: number };
	}
): { x: number; y: number } {
	const footprint = flowSequenceFootprint(pages, opts);
	const clearGap = opts?.clearGap ?? FLOW_CLEAR_GAP;
	const prefer = snapPoint(opts?.prefer?.x ?? GRID_ORIGIN, opts?.prefer?.y ?? GRID_ORIGIN);
	if (footprint.w <= 0 || footprint.h <= 0) return prefer;

	const isClear = (ox: number, oy: number) => {
		const band = { x: ox, y: oy, w: footprint.w, h: footprint.h };
		return !obstacles.some((o) => bandOverlapsObstacle(band, o, clearGap));
	};

	if (isClear(prefer.x, prefer.y)) return prefer;

	const bounds = boundsOf(obstacles);
	const belowPrefer = snapPoint(prefer.x, prefer.y + footprint.h + clearGap * 2);
	const candidates: Array<{ x: number; y: number }> = [belowPrefer];
	if (bounds) {
		candidates.push(
			snapPoint(prefer.x, bounds.maxY + clearGap * 2),
			snapPoint(GRID_ORIGIN, bounds.maxY + clearGap * 2),
			snapPoint(bounds.maxX + clearGap * 2, prefer.y)
		);
	}
	for (const c of candidates) {
		if (isClear(c.x, c.y)) return c;
	}

	// Scan downward from content bottom (or prefer) until a free band appears.
	let y = snapValue((bounds?.maxY ?? prefer.y + footprint.h) + clearGap * 2);
	for (let i = 0; i < 48; i++) {
		const origin = snapPoint(GRID_ORIGIN, y);
		if (isClear(origin.x, origin.y)) return origin;
		y = snapValue(y + GRID * 2);
	}
	return snapPoint(GRID_ORIGIN, y);
}

/**
 * Lay a valid page sequence into a left-to-right storyboard row.
 * Anchors on `opts.origin` or the first page’s snapped position; later
 * pages pack by each card’s real width + gap so tall/wide cards don’t overlap.
 */
export function layoutFlowSequence(
	pages: CanvasItem[],
	opts?: { gap?: number; defaultW?: number; origin?: { x: number; y: number } }
): Map<string, { x: number; y: number }> {
	const out = new Map<string, { x: number; y: number }>();
	if (pages.length === 0) return out;
	const gap = opts?.gap ?? FLOW_LAYOUT_GAP;
	const defaultW = opts?.defaultW ?? 220;
	const origin = opts?.origin
		? snapPoint(opts.origin.x, opts.origin.y)
		: snapPoint(pages[0].x, pages[0].y);
	let x = origin.x;
	for (const page of pages) {
		out.set(page.id, { x, y: origin.y });
		const w = page.w && page.w > 0 ? page.w : defaultW;
		x = snapValue(x + w + gap);
	}
	return out;
}

/** Build a short horizontal connector path from source → target. */
export function flowEdgePath(
	from: { x: number; y: number; w: number; h: number },
	to: { x: number; y: number; w: number; h: number }
): { d: string; midX: number; midY: number } {
	const x1 = from.x + from.w;
	const y1 = from.y + from.h / 2;
	const x2 = to.x;
	const y2 = to.y + to.h / 2;
	const dx = x2 - x1;
	const dy = y2 - y1;
	// Prefer a short stub when cards sit in order (target to the right).
	if (dx >= 16) {
		const cx = x1 + dx / 2;
		return {
			d: `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`,
			midX: (x1 + x2) / 2,
			midY: (y1 + y2) / 2
		};
	}
	// Fallback: gentle arc above when overlapping or reversed spatially.
	const lift = Math.max(36, Math.abs(dy) * 0.35 + 28);
	const midX = (x1 + x2) / 2;
	const midY = Math.min(y1, y2) - lift;
	return {
		d: `M ${x1} ${y1} Q ${midX} ${midY}, ${x2} ${y2}`,
		midX,
		midY
	};
}
