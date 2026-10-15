import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { addNoteToCanvas, createNote, db, getOrCreateFolderCanvas } from '$lib/db';
import { createCanvasSession } from './canvas-session.svelte';

if (!globalThis.crypto?.randomUUID) {
	Object.defineProperty(globalThis.crypto, 'randomUUID', {
		value: webcrypto.randomUUID.bind(webcrypto),
		configurable: true
	});
}

describe('canvas session undo', () => {
	beforeEach(async () => {
		await db.delete();
		await db.open();
	});

	it('keeps the stored modified on session cards after undoing a removed duplicate', async () => {
		const notes = [
			await createNote({ title: 'Same', body: 'text' }),
			await createNote({ title: 'Same', body: 'text' })
		];
		const notesById = new Map(notes.map((note) => [note.id, note]));
		const canvas = await getOrCreateFolderCanvas('');
		await addNoteToCanvas(canvas.id, notes[0].id, { x: 0, y: 0 });
		await addNoteToCanvas(canvas.id, notes[1].id, { x: 400, y: 0 });

		const session = createCanvasSession({
			flashToast: () => undefined,
			getNotes: () => notes,
			getNotesById: () => notesById,
			getCanvasKey: () => '',
			getSelectionIds: () => [],
			getSelectionSet: () => new Set(),
			getSelectedId: () => null,
			setSelection: () => undefined,
			selectNote: () => undefined,
			toggleSelection: () => undefined,
			deleteBlankNote: async () => undefined,
			removeNoteFromSearch: () => undefined,
			removeNoteFromLibrary: () => undefined
		});

		await session.loadContextCanvas('');
		expect(session.canvasItems).toHaveLength(2);
		const modifiedBefore = new Map(session.canvasItems.map((item) => [item.id, item.modified]));

		const removed = await session.deduplicateCanvasSelection(
			notes.map((note) => note.id),
			notesById
		);
		expect(removed.removed).toBe(1);
		const keptIds = new Set(session.canvasItems.map((item) => item.id));
		const removedId = [...modifiedBefore.keys()].find((id) => !keptIds.has(id));
		expect(removedId).toBeTruthy();

		await session.undoCanvasLayout();

		// Session cards, not IndexedDB. The database stamp already exists on main;
		// this fails when undo puts the pre-delete snapshot back into canvasItems.
		const restored = session.canvasItems.find((item) => item.id === removedId);
		expect(restored?.modified).toBeGreaterThan(modifiedBefore.get(removedId!)!);
	});
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('layout write queue', () => {
	beforeEach(async () => {
		await db.delete();
		await db.open();
	});

	function sessionFor(notes: Awaited<ReturnType<typeof createNote>>[]) {
		const notesById = new Map(notes.map((note) => [note.id, note]));
		return createCanvasSession({
			flashToast: () => undefined,
			getNotes: () => notes,
			getNotesById: () => notesById,
			getCanvasKey: () => '',
			getSelectionIds: () => [],
			getSelectionSet: () => new Set(),
			getSelectedId: () => null,
			setSelection: () => undefined,
			selectNote: () => undefined,
			toggleSelection: () => undefined,
			deleteBlankNote: async () => undefined,
			removeNoteFromSearch: () => undefined,
			removeNoteFromLibrary: () => undefined
		});
	}

	async function setup() {
		const anchorNote = await createNote({ title: 'A', body: 'x' });
		const neighborNote = await createNote({ title: 'B', body: 'y' });
		const farNote = await createNote({ title: 'C', body: 'z' });
		const canvas = await getOrCreateFolderCanvas('');
		const anchor = await addNoteToCanvas(canvas.id, anchorNote.id, {
			x: 48,
			y: 48,
			w: 400,
			h: 400
		});
		const neighbor = await addNoteToCanvas(canvas.id, neighborNote.id, {
			x: 72,
			y: 120,
			w: 220,
			h: 120
		});
		const far = await addNoteToCanvas(canvas.id, farNote.id, {
			// On the 24px grid and clear of the anchor, so the bump write is the
			// one overlapping neighbor. An off-grid card is snapped into that write.
			x: 2016,
			y: 2016,
			w: 220,
			h: 120
		});
		const session = sessionFor([anchorNote, neighborNote, farNote]);
		await session.loadContextCanvas('');
		return { anchorNote, neighborNote, farNote, anchor, neighbor, far, session };
	}

	function holdFirstCanvasWrite() {
		const originalUpdate = db.canvasItems.update.bind(db.canvasItems);
		let releaseHeld: () => void = () => undefined;
		const held = new Promise<void>((resolve) => {
			releaseHeld = resolve;
		});
		const calls: string[] = [];
		let first = true;
		db.canvasItems.update = (async (...args: Parameters<typeof originalUpdate>) => {
			const patch = args[1] as { x?: number; y?: number; w?: number; h?: number };
			const label = `${args[0]}:${patch.x},${patch.y},${patch.w ?? ''},${patch.h ?? ''}`;
			if (first) {
				first = false;
				calls.push(`hold:${label}`);
				await held;
				calls.push(`release:${label}`);
				return originalUpdate(...args);
			}
			calls.push(`next:${label}`);
			return originalUpdate(...args);
		}) as typeof db.canvasItems.update;
		return {
			calls,
			release: () => releaseHeld(),
			restore: () => {
				db.canvasItems.update = originalUpdate;
			}
		};
	}

	it('drag waits behind a held bump', async () => {
		const { anchorNote, neighbor, session } = await setup();
		const held = holdFirstCanvasWrite();
		try {
			session.expandSticky(anchorNote.id);
			await vi.waitFor(() => {
				expect(held.calls.some((call) => call.startsWith('hold:'))).toBe(true);
			});
			const drag = session.handleCanvasMoveEnd([{ itemId: neighbor.id, x: 600, y: 48 }]);
			expect(session.canvasItems.find((item) => item.id === neighbor.id)?.x).toBe(600);
			await sleep(60);
			const early = held.calls.filter((call) => call.startsWith('next:'));
			held.release();
			await drag;
			expect(early).toEqual([]);
			expect((await db.canvasItems.get(neighbor.id))?.x).toBe(600);
		} finally {
			held.restore();
		}
	});

	it('compact waits behind a held bump', async () => {
		const { anchorNote, farNote, anchor, session } = await setup();
		const held = holdFirstCanvasWrite();
		try {
			session.expandSticky(anchorNote.id);
			await vi.waitFor(() => {
				expect(held.calls.some((call) => call.startsWith('hold:'))).toBe(true);
			});
			// Opening another note compacts the anchor and restores the bump.
			session.expandSticky(farNote.id);
			await sleep(60);
			const early = held.calls.filter((call) => call.startsWith('next:'));
			held.release();
			await sleep(60);
			expect(early).toEqual([]);
			expect((await db.canvasItems.get(anchor.id))?.w).toBe(220);
		} finally {
			held.restore();
		}
	});

	it('undo right after a queued drag leaves the database matching the screen', async () => {
		const { anchorNote, neighbor, session } = await setup();
		const held = holdFirstCanvasWrite();
		try {
			session.expandSticky(anchorNote.id);
			await vi.waitFor(() => {
				expect(held.calls.some((call) => call.startsWith('hold:'))).toBe(true);
			});
			const drag = session.handleCanvasMoveEnd([{ itemId: neighbor.id, x: 600, y: 48 }]);
			await sleep(5);
			const undo = session.undoCanvasLayout();
			await sleep(60);
			held.release();
			await Promise.all([drag, undo]);
			await sleep(30);
			const ui = session.canvasItems.find((item) => item.id === neighbor.id);
			const stored = await db.canvasItems.get(neighbor.id);
			expect({ x: stored?.x, y: stored?.y }).toEqual({ x: ui?.x, y: ui?.y });
		} finally {
			held.restore();
		}
	});

	it('keeps a dragged bumped card where the user put it after collapse', async () => {
		const anchorNote = await createNote({ title: 'Anchor', body: 'open' });
		const neighborNote = await createNote({ title: 'Neighbor', body: 'aside' });
		const otherNote = await createNote({ title: 'Other', body: 'stay' });
		const canvas = await getOrCreateFolderCanvas('');
		const neighbor = await addNoteToCanvas(canvas.id, neighborNote.id, {
			x: 72,
			y: 120,
			w: 220,
			h: 120
		});
		const other = await addNoteToCanvas(canvas.id, otherNote.id, {
			x: 300,
			y: 300,
			w: 220,
			h: 120
		});
		await addNoteToCanvas(canvas.id, anchorNote.id, { x: 48, y: 48, w: 400, h: 400 });
		const session = sessionFor([anchorNote, neighborNote, otherNote]);
		await session.loadContextCanvas('');

		session.expandSticky(anchorNote.id);
		const bumpedOther = session.canvasItems.find((item) => item.id === other.id);
		expect(bumpedOther?.x !== 300 || bumpedOther?.y !== 300).toBe(true);
		await session.handleCanvasMoveEnd([{ itemId: neighbor.id, x: 600, y: 48 }]);
		await session.collapseSticky();

		const uiNeighbor = session.canvasItems.find((item) => item.id === neighbor.id);
		const storedNeighbor = await db.canvasItems.get(neighbor.id);
		expect(uiNeighbor?.x).toBe(600);
		expect(uiNeighbor?.y).toBe(48);
		expect(storedNeighbor?.x).toBe(600);
		expect(storedNeighbor?.y).toBe(48);

		const uiOther = session.canvasItems.find((item) => item.id === other.id);
		const storedOther = await db.canvasItems.get(other.id);
		expect(uiOther?.x).toBe(300);
		expect(uiOther?.y).toBe(300);
		expect(storedOther?.x).toBe(300);
		expect(storedOther?.y).toBe(300);
	});
});
