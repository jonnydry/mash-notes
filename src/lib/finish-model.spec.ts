import { describe, expect, it } from 'vitest';
import {
	createFinishSnapshot,
	defaultFinishScope,
	EMPTY_CANVAS_FINISH_COPY,
	finishExportSourceLabel,
	finishScopeOptions,
	finishTakeawayAnnouncement,
	finishTakeawayPreview,
	notesForFinishScope,
	spatialNoteIds
} from './finish-model';
import type { CanvasItem, Note, Operation } from './types';

function note(id: string, created: number, sessionId = 'desk'): Note {
	return {
		id,
		title: id.toUpperCase(),
		body: `${id} body`,
		folder: '',
		tags: [],
		created,
		modified: created,
		pinned: 0,
		sessionId,
		scope: 'session'
	};
}

function item(id: string, noteId: string, x: number, y: number): CanvasItem {
	return { id, noteId, x, y, canvasId: 'canvas' };
}

function operation(partial: Partial<Operation> & Pick<Operation, 'id'>): Operation {
	return {
		id: partial.id,
		sessionId: partial.sessionId ?? 'desk',
		type: partial.type ?? 'mash',
		inputNoteIds: partial.inputNoteIds ?? [],
		outputNoteIds: partial.outputNoteIds ?? [],
		created: partial.created ?? 1,
		revertedAt: partial.revertedAt
	};
}

describe('Finish snapshot', () => {
	it('orders current-canvas cards spatially and appends unplaced desk notes by creation', () => {
		const notes = [note('a', 4), note('b', 2), note('c', 3), note('d', 1)];
		const canvasItems = [
			item('ia', 'a', 200, 100),
			item('ic', 'c', 20, 10),
			item('ib', 'b', 10, 100)
		];

		const snapshot = createFinishSnapshot({
			sessionId: 'desk',
			canvasId: 'canvas',
			notes,
			canvasItems,
			selectedNoteIds: [],
			operations: [],
			openedAt: 20
		});

		expect(snapshot.canvasNoteIds).toEqual(['c', 'b', 'a']);
		expect(snapshot.deskNoteIds).toEqual(['c', 'b', 'a', 'd']);
		expect(snapshot.latestOperationType).toBeNull();
		expect(snapshot.openedAt).toBe(20);
	});

	it('keeps ordered valid selection and newest active result outputs without duplicates', () => {
		const notes = [note('a', 1), note('b', 2), note('c', 3), note('foreign', 4, 'other')];
		const snapshot = createFinishSnapshot({
			sessionId: 'desk',
			canvasId: 'canvas',
			notes,
			canvasItems: [item('ia', 'a', 0, 0), item('ib', 'b', 10, 0), item('ic', 'c', 20, 0)],
			selectedNoteIds: ['b', 'missing', 'a', 'b', 'foreign'],
			operations: [
				operation({ id: 'old', outputNoteIds: ['a', 'b'], created: 2 }),
				operation({ id: 'new', outputNoteIds: ['c', 'a'], created: 3 }),
				operation({ id: 'undone', outputNoteIds: ['b'], created: 4, revertedAt: 5 }),
				operation({ id: 'other', sessionId: 'other', outputNoteIds: ['foreign'], created: 6 })
			]
		});

		expect(snapshot.selectedNoteIds).toEqual(['b', 'a']);
		expect(snapshot.resultNoteIds).toEqual(['c', 'a', 'b']);
		expect(defaultFinishScope(snapshot)).toBe('selected');
	});

	it('falls back from results to the whole desk and exposes accurate summaries', () => {
		const notes = [note('a', 1), note('b', 2)];
		const notesById = new Map(notes.map((row) => [row.id, row]));
		const snapshot = createFinishSnapshot({
			sessionId: 'desk',
			canvasId: null,
			notes,
			canvasItems: [item('ia', 'a', 0, 0), item('ib', 'b', 40, 0)],
			selectedNoteIds: [],
			operations: []
		});

		expect(defaultFinishScope(snapshot)).toBe('desk');
		expect(finishScopeOptions(snapshot, notesById)).toMatchObject([
			{ scope: 'selected', count: 0, enabled: false },
			{ scope: 'results', count: 0, enabled: false },
			{ scope: 'desk', count: 2, enabled: true, preview: 'A, B' }
		]);
		expect(notesForFinishScope(snapshot, 'desk', notesById).map((row) => row.id)).toEqual([
			'a',
			'b'
		]);
	});

	it('keeps a counted Whole desk label when the desk is larger for a reason other than Split by lines', () => {
		const notes = [note('a', 1), note('b', 2)];
		const notesById = new Map(notes.map((row) => [row.id, row]));
		const snapshot = createFinishSnapshot({
			sessionId: 'desk',
			canvasId: 'canvas',
			notes,
			canvasItems: [item('ia', 'a', 0, 0), item('ib', 'b', 10, 0)],
			selectedNoteIds: ['a'],
			operations: [operation({ id: 'mash', type: 'mash', outputNoteIds: ['a'], created: 2 })]
		});
		const desk = finishScopeOptions(snapshot, notesById).find((option) => option.scope === 'desk');
		expect(desk?.count).toBe(2);
		expect(desk?.choiceLabel).toBe('Whole desk · 2');
		expect(desk?.countLabel).toBe('2 cards');
		expect(finishExportSourceLabel(snapshot, 'desk', notesById)).toBe('Whole desk · 2 cards');
	});

	it('uses stable source order for cards with identical coordinates', () => {
		expect(spatialNoteIds([item('one', 'a', 10, 10), item('two', 'b', 10, 10)])).toEqual([
			'a',
			'b'
		]);
	});

	it('says the canvas is empty and does not offer off-canvas notes as a takeaway', () => {
		const pantry = note('pantry', 1);
		pantry.title = 'Pantry staple';
		const notesById = new Map([[pantry.id, pantry]]);
		const snapshot = createFinishSnapshot({
			sessionId: 'desk',
			canvasId: 'canvas',
			notes: [pantry],
			canvasItems: [],
			selectedNoteIds: [pantry.id],
			operations: [
				operation({ id: 'split', type: 'split-lines', outputNoteIds: [pantry.id], created: 2 })
			]
		});

		expect(snapshot.canvasNoteIds).toEqual([]);
		expect(snapshot.selectedNoteIds).toEqual([]);
		expect(snapshot.resultNoteIds).toEqual([]);
		expect(snapshot.deskNoteIds).toEqual([]);
		const options = finishScopeOptions(snapshot, notesById);
		expect(options.map((option) => option.count)).toEqual([0, 0, 0]);
		expect(options.every((option) => !option.preview.includes('Pantry staple'))).toBe(true);
		expect(finishTakeawayPreview(snapshot, options[2])).toBe(EMPTY_CANVAS_FINISH_COPY);
		expect(finishTakeawayAnnouncement(snapshot, options[2])).toBe(EMPTY_CANVAS_FINISH_COPY);
		expect(finishTakeawayAnnouncement(snapshot, options[2]).toLowerCase()).not.toContain(
			'takeaway'
		);
		expect(EMPTY_CANVAS_FINISH_COPY).toBe('The canvas is empty.');
	});

	it('names the extra cards after Split by lines instead of a bare higher Whole desk count', () => {
		const milk = note('milk', 1);
		const eggs = note('eggs', 2);
		const grocery = note('grocery', 3);
		const spice = note('spice', 4);
		const herb = note('herb', 5);
		milk.title = 'Milk';
		eggs.title = 'Eggs';
		grocery.title = 'Grocery';
		spice.title = 'Spice';
		herb.title = 'Herb';
		const notes = [milk, eggs, grocery, spice, herb];
		const notesById = new Map(notes.map((row) => [row.id, row]));
		const snapshot = createFinishSnapshot({
			sessionId: 'desk',
			canvasId: 'canvas',
			notes,
			canvasItems: [item('im', 'milk', 0, 0), item('ie', 'eggs', 20, 0)],
			selectedNoteIds: ['milk', 'eggs'],
			operations: [
				operation({
					id: 'split',
					type: 'split-lines',
					inputNoteIds: ['grocery'],
					outputNoteIds: ['milk', 'eggs'],
					created: 4
				})
			]
		});

		const options = finishScopeOptions(snapshot, notesById);
		const selected = options.find((option) => option.scope === 'selected');
		const desk = options.find((option) => option.scope === 'desk');
		expect(selected?.count).toBe(2);
		expect(desk?.count).toBeGreaterThan(selected?.count ?? 0);
		expect(desk?.choiceLabel).toBe('Whole desk includes Grocery, Spice, and Herb');
		expect(desk?.countLabel).toBe('Whole desk includes Grocery, Spice, and Herb');
		expect(desk?.choiceLabel).not.toMatch(/Whole desk · \d+$/);
		expect(desk?.countLabel).not.toMatch(/^\d+ cards?$/);
		expect(finishTakeawayAnnouncement(snapshot, desk)).toBe(desk?.choiceLabel);
		expect(finishExportSourceLabel(snapshot, 'desk', notesById)).toBe(desk?.choiceLabel);
		expect(finishTakeawayAnnouncement(snapshot, selected)).toBe('Selected takeaway, 2 cards');
		expect(finishExportSourceLabel(snapshot, 'selected', notesById)).toBe('Selected · 2 cards');
	});

	it('names one or two extra cards without a bare higher number', () => {
		function deskLabel(extraTitles: string[]): string | undefined {
			const lines = [note('milk', 1), note('eggs', 2)];
			lines[0]!.title = 'Milk';
			lines[1]!.title = 'Eggs';
			const extras = extraTitles.map((title, index) => {
				const row = note(title.toLowerCase(), 10 + index);
				row.title = title;
				return row;
			});
			const notes = [...lines, ...extras];
			const snapshot = createFinishSnapshot({
				sessionId: 'desk',
				canvasId: 'canvas',
				notes,
				canvasItems: [item('im', 'milk', 0, 0), item('ie', 'eggs', 20, 0)],
				selectedNoteIds: ['milk', 'eggs'],
				operations: [
					operation({
						id: 'split',
						type: 'split-lines',
						outputNoteIds: ['milk', 'eggs'],
						created: 3
					})
				]
			});
			return finishScopeOptions(snapshot, new Map(notes.map((row) => [row.id, row]))).find(
				(option) => option.scope === 'desk'
			)?.choiceLabel;
		}

		expect(deskLabel(['Grocery'])).toBe('Whole desk includes Grocery');
		expect(deskLabel(['Grocery', 'Spice'])).toBe('Whole desk includes Grocery and Spice');
	});

	it('keeps a plain Whole desk count when the desk is not larger after Split by lines', () => {
		const milk = note('milk', 1);
		const eggs = note('eggs', 2);
		milk.title = 'Milk';
		eggs.title = 'Eggs';
		const notes = [milk, eggs];
		const notesById = new Map(notes.map((row) => [row.id, row]));
		const snapshot = createFinishSnapshot({
			sessionId: 'desk',
			canvasId: 'canvas',
			notes,
			canvasItems: [item('im', 'milk', 0, 0), item('ie', 'eggs', 20, 0)],
			selectedNoteIds: ['milk', 'eggs'],
			operations: [
				operation({
					id: 'split',
					type: 'split-lines',
					outputNoteIds: ['milk', 'eggs'],
					created: 3
				})
			]
		});
		const desk = finishScopeOptions(snapshot, notesById).find((option) => option.scope === 'desk');
		expect(desk?.count).toBe(2);
		expect(desk?.choiceLabel).toBe('Whole desk · 2');
		expect(desk?.namesExtras).toBe(false);
	});
});
