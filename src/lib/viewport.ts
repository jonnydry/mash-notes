/**
 * Persist canvas pan/zoom per canvas id (localStorage).
 */

export type CanvasViewport = { panX: number; panY: number; scale: number };

const PREFIX = 'mash.canvasViewport.';
const DEFAULT_VIEWPORT: CanvasViewport = { panX: 0, panY: 0, scale: 1 };

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
