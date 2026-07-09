/**
 * Canvas flow — page sequences as linear next-page chains.
 *
 * A → B means “B is the next page after A” in that sequence.
 * Multiple disjoint chains on one board are separate export sequences.
 */
import type { CanvasEdge, CanvasItem } from './types';

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
		(e) =>
			e.fromItemId !== e.toItemId &&
			itemIds.has(e.fromItemId) &&
			itemIds.has(e.toItemId)
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
export function listFlowSequences(
	items: CanvasItem[],
	edges: CanvasEdge[]
): FlowBoardResult {
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
