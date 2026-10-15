import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
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
			getSelectionIds: () => notes.map((note) => note.id),
			getSelectionSet: () => new Set(notes.map((note) => note.id)),
			getSelectedId: () => notes[0]?.id ?? null,
			setSelection: () => undefined,
			selectNote: () => undefined,
			toggleSelection: () => undefined,
			deleteBlankNote: async () => undefined,
			removeNoteFromSearch: () => undefined,
			removeNoteFromLibrary: () => undefined
		});
	}

	it('runs drag, organize, and compact after an in-flight bump', async () => {
		const anchorNote = await createNote({ title: 'Anchor', body: 'open' });
		const neighborNote = await createNote({ title: 'Neighbor', body: 'aside' });
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
		const session = sessionFor([anchorNote, neighborNote]);
		await session.loadContextCanvas('');

		const originalUpdate = db.canvasItems.update.bind(db.canvasItems);
		let releaseBump: () => void = () => undefined;
		const bumpHeld = new Promise<void>((resolve) => {
			releaseBump = resolve;
		});
		const calls: string[] = [];
		let holding = true;
		db.canvasItems.update = (async (...args: Parameters<typeof originalUpdate>) => {
			const patch = args[1] as { x?: number; y?: number; w?: number; h?: number };
			const label = `${args[0]}:${patch.x},${patch.y},${patch.w ?? ''},${patch.h ?? ''}`;
			if (holding) {
				holding = false;
				calls.push(`hold:${label}`);
				await bumpHeld;
				calls.push(`release:${label}`);
				return originalUpdate(...args);
			}
			calls.push(`next:${label}`);
			return originalUpdate(...args);
		}) as typeof db.canvasItems.update;

		try {
			session.expandSticky(anchorNote.id);
			await vi.waitFor(() => {
				expect(calls.some((call) => call.startsWith('hold:'))).toBe(true);
			});

			const drag = session.handleCanvasMoveEnd([{ itemId: neighbor.id, x: 600, y: 48 }]);
			const organize = session.handleCanvasMoveEnd(
				[{ itemId: neighbor.id, x: 720, y: 48 }],
				undefined,
				{ label: 'Arrange' }
			);
			const compact = session.collapseSticky();
			expect(calls.filter((call) => call.startsWith('next:'))).toEqual([]);

			releaseBump();
			await Promise.all([drag, organize, compact]);

			const holdIndex = calls.findIndex((call) => call.startsWith('hold:'));
			const releaseIndex = calls.findIndex((call) => call.startsWith('release:'));
			expect(holdIndex).toBe(0);
			expect(releaseIndex).toBeGreaterThan(holdIndex);
			expect(calls.slice(releaseIndex + 1).some((call) => call.startsWith('next:'))).toBe(true);
			expect(calls.slice(0, releaseIndex).some((call) => call.startsWith('next:'))).toBe(false);

			const storedNeighbor = await db.canvasItems.get(neighbor.id);
			const storedAnchor = await db.canvasItems.get(anchor.id);
			// Collapse restores the neighbor after the drag, then compact shrinks the anchor.
			expect(storedNeighbor?.x).toBe(72);
			expect(storedNeighbor?.y).toBe(120);
			expect(storedAnchor?.w).toBe(220);
			expect(storedAnchor?.h).toBe(120);
		} finally {
			db.canvasItems.update = originalUpdate;
		}
	});
});
