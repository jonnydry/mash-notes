import { describe, it, expect } from 'vitest';
import {
	detectSnapZone,
	detectFillOrSnapZone,
	stageContentRect,
	applySnap,
	applySplitPair,
	closePane,
	layoutOf,
	emptySlotOf,
	zoneToSlot,
	oppositeSlot,
	type EditorPane
} from './editor-stage.svelte';

describe('editor-stage', () => {
	const rect = { left: 0, top: 0, width: 1000, height: 800 };

	it('detects edge snap zones', () => {
		expect(detectSnapZone(20, 400, rect)).toBe('left');
		expect(detectSnapZone(980, 400, rect)).toBe('right');
		expect(detectSnapZone(500, 20, rect)).toBe('maximize');
		expect(detectSnapZone(500, 400, rect)).toBe(null);
	});

	it('treats the empty half as a full drop target', () => {
		const panes = applySnap([], 'n1', 'left');
		expect(emptySlotOf(panes)).toBe('right');
		// Mid-right of stage (not just the thin edge strip)
		expect(detectFillOrSnapZone(750, 400, rect, panes)).toBe('right');
		// Occupied half only snaps via the thin edge strip
		expect(detectFillOrSnapZone(200, 400, rect, panes)).toBe(null);
		expect(detectFillOrSnapZone(20, 400, rect, panes)).toBe('left');
	});

	it('honors a resized split ratio for empty-half hit testing', () => {
		const panes = applySnap([], 'n1', 'left');
		// Divider at 30%: x=350 is still in the empty right half visually
		expect(detectFillOrSnapZone(350, 400, rect, panes, { h: 0.3 })).toBe('right');
		// Same point with default 50% split is still on the occupied left
		expect(detectFillOrSnapZone(350, 400, rect, panes)).toBe(null);
		// Far left of a wide left pane still only edge-snaps
		expect(detectFillOrSnapZone(200, 400, rect, panes, { h: 0.7 })).toBe(null);
		expect(detectFillOrSnapZone(20, 400, rect, panes, { h: 0.7 })).toBe('left');
	});

	it('insets the stage content rect for the side dock', () => {
		const board = { left: 0, top: 100, width: 1000, height: 800 };
		expect(stageContentRect(board)).toEqual({
			left: 84,
			top: 100,
			width: 916,
			height: 800
		});
		expect(stageContentRect(board, { mobile: true }).height).toBe(800 - 88);
	});

	it('maps zones to slots', () => {
		expect(zoneToSlot('left')).toBe('left');
		expect(zoneToSlot('maximize')).toBe('full');
		expect(oppositeSlot('left')).toBe('right');
		expect(oppositeSlot('full')).toBe(null);
	});

	it('opens maximize as a single full pane', () => {
		const next = applySnap([], 'n1', 'maximize');
		expect(next).toHaveLength(1);
		expect(next[0].slot).toBe('full');
		expect(layoutOf(next)).toBe('single');
	});

	it('keeps a side snap as waiting-h (half width)', () => {
		const panes = applySnap([], 'n1', 'left');
		expect(panes).toHaveLength(1);
		expect(panes[0].slot).toBe('left');
		expect(layoutOf(panes)).toBe('waiting-h');
		expect(emptySlotOf(panes)).toBe('right');
	});

	it('snaps a second note to the opposite half', () => {
		let panes = applySnap([], 'n1', 'left');
		expect(panes[0].slot).toBe('left');
		panes = applySnap(panes, 'n2', 'right');
		expect(layoutOf(panes)).toBe('split-h');
		expect(panes.map((p) => p.noteId).sort()).toEqual(['n1', 'n2']);
		expect(panes.find((p) => p.noteId === 'n1')?.slot).toBe('left');
		expect(panes.find((p) => p.noteId === 'n2')?.slot).toBe('right');
	});

	it('opens a selection pair as a split', () => {
		const panes = applySplitPair('a', 'b');
		expect(layoutOf(panes)).toBe('split-h');
		expect(panes[0].slot).toBe('left');
		expect(panes[1].slot).toBe('right');
	});

	it('maximize replaces a split', () => {
		let panes = applySnap([], 'n1', 'left');
		panes = applySnap(panes, 'n2', 'right');
		panes = applySnap(panes, 'n1', 'maximize');
		expect(panes).toHaveLength(1);
		expect(panes[0].noteId).toBe('n1');
		expect(panes[0].slot).toBe('full');
	});

	it('closing one half leaves the other waiting (empty drop target)', () => {
		let panes: EditorPane[] = applySnap([], 'n1', 'left');
		panes = applySnap(panes, 'n2', 'right');
		const left = panes.find((p) => p.noteId === 'n1')!;
		panes = closePane(panes, left.id);
		expect(panes).toHaveLength(1);
		expect(panes[0].noteId).toBe('n2');
		expect(panes[0].slot).toBe('right');
		expect(layoutOf(panes)).toBe('waiting-h');
		expect(emptySlotOf(panes)).toBe('left');
	});
});
