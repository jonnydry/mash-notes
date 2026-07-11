/**
 * Persist canvas pan/zoom per canvas id (localStorage).
 */

export type CanvasViewport = { panX: number; panY: number; scale: number };

export type MobileAutoFitInput = {
	isMobile: boolean;
	canvasId: string | null;
	itemCount: number;
	boardWidth: number;
	boardHeight: number;
	entry: number;
	lastAppliedKey: string | null;
};

const PREFIX = 'mash.canvasViewport.';
const DEFAULT_VIEWPORT: CanvasViewport = { panX: 0, panY: 0, scale: 1 };

/**
 * Mobile desks get one content fit per desk entry (and once when crossing the
 * mobile breakpoint). Subsequent edits keep the user's chosen pan and zoom.
 */
export function mobileAutoFitKey(input: MobileAutoFitInput): string | null {
	if (
		!input.isMobile ||
		!input.canvasId ||
		input.itemCount === 0 ||
		input.boardWidth <= 0 ||
		input.boardHeight <= 0
	) {
		return null;
	}
	const key = `${input.canvasId}:${input.entry}`;
	return key === input.lastAppliedKey ? null : key;
}

export function loadCanvasViewport(canvasId: string): CanvasViewport {
	try {
		const raw = localStorage.getItem(PREFIX + canvasId);
		if (!raw) return { ...DEFAULT_VIEWPORT };
		const parsed = JSON.parse(raw) as Partial<CanvasViewport>;
		const scale =
			typeof parsed.scale === 'number' && Number.isFinite(parsed.scale)
				? Math.min(2, Math.max(0.4, parsed.scale))
				: 1;
		return {
			panX: typeof parsed.panX === 'number' && Number.isFinite(parsed.panX) ? parsed.panX : 0,
			panY: typeof parsed.panY === 'number' && Number.isFinite(parsed.panY) ? parsed.panY : 0,
			scale
		};
	} catch {
		return { ...DEFAULT_VIEWPORT };
	}
}

export function saveCanvasViewport(canvasId: string, viewport: CanvasViewport): void {
	try {
		localStorage.setItem(PREFIX + canvasId, JSON.stringify(viewport));
	} catch {
		/* ignore quota / private mode */
	}
}

export function clearCanvasViewport(canvasId: string): void {
	try {
		localStorage.removeItem(PREFIX + canvasId);
	} catch {
		/* ignore */
	}
}
