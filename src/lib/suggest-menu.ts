/** Shared positioning for portaled folder/tag suggest menus. */

export type SuggestMenuPos = {
	left: number;
	width: number;
	maxHeight: number;
	placement: 'above' | 'below';
	/** px from viewport top when placement is below */
	top: number;
	/** px from viewport bottom when placement is above */
	bottom: number;
};

export function computeSuggestMenuPos(
	anchor: DOMRect,
	opts: { gap?: number; maxH?: number; minWidth?: number } = {}
): SuggestMenuPos {
	const gap = opts.gap ?? 6;
	const maxH = opts.maxH ?? 200;
	const minWidth = opts.minWidth ?? 160;
	const width = Math.max(anchor.width, minWidth);
	const left = Math.min(Math.max(8, anchor.left), window.innerWidth - width - 8);
	const spaceBelow = window.innerHeight - anchor.bottom - gap;
	const spaceAbove = anchor.top - gap;
	const openUp = spaceBelow < Math.min(maxH, 120) && spaceAbove > spaceBelow;

	if (openUp) {
		return {
			left,
			width,
			maxHeight: Math.min(maxH, Math.max(spaceAbove, 80)),
			placement: 'above',
			top: 0,
			bottom: window.innerHeight - anchor.top + gap
		};
	}
	return {
		left,
		width,
		maxHeight: Math.min(maxH, Math.max(spaceBelow, 80)),
		placement: 'below',
		top: anchor.bottom + gap,
		bottom: 0
	};
}

export function suggestMenuStyle(pos: SuggestMenuPos): string {
	const base = `position:fixed;left:${pos.left}px;width:${pos.width}px;max-height:${pos.maxHeight}px;z-index:80;`;
	if (pos.placement === 'above') {
		return `${base}bottom:${pos.bottom}px;top:auto;`;
	}
	return `${base}top:${pos.top}px;bottom:auto;`;
}

export function sameSuggestPos(a: SuggestMenuPos | null, b: SuggestMenuPos): boolean {
	if (!a) return false;
	return (
		a.left === b.left &&
		a.width === b.width &&
		a.maxHeight === b.maxHeight &&
		a.placement === b.placement &&
		a.top === b.top &&
		a.bottom === b.bottom
	);
}

/** Keep a floating menu pinned to an anchor; only writes when the rect moves. */
export function trackSuggestAnchor(
	getAnchor: () => HTMLElement | undefined,
	onPos: (pos: SuggestMenuPos) => void,
	opts?: { gap?: number; maxH?: number; minWidth?: number }
): () => void {
	let last: SuggestMenuPos | null = null;
	let raf = 0;

	const sync = () => {
		const el = getAnchor();
		if (!el) return;
		const next = computeSuggestMenuPos(el.getBoundingClientRect(), opts);
		if (sameSuggestPos(last, next)) return;
		last = next;
		onPos(next);
	};

	sync();
	const onReposition = () => sync();
	window.addEventListener('resize', onReposition);
	window.addEventListener('scroll', onReposition, true);

	const tick = () => {
		sync();
		raf = requestAnimationFrame(tick);
	};
	raf = requestAnimationFrame(tick);

	return () => {
		cancelAnimationFrame(raf);
		window.removeEventListener('resize', onReposition);
		window.removeEventListener('scroll', onReposition, true);
	};
}
