import { describe, expect, it } from 'vitest';
import {
	createFinishSnapshot,
	defaultFinishScope,
	finishScopeOptions,
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

		expect(snapshot.deskNoteIds).toEqual(['c', 'b', 'a', 'd']);
		expect(snapshot.openedAt).toBe(20);
	});

	it('keeps ordered valid selection and newest active result outputs without duplicates', () => {
		const notes = [note('a', 1), note('b', 2), note('c', 3), note('foreign', 4, 'other')];
		const snapshot = createFinishSnapshot({
			sessionId: 'desk',
			canvasId: 'canvas',
			notes,
			canvasItems: [],
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
			canvasItems: [],
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

	it('uses stable source order for cards with identical coordinates', () => {
		expect(spatialNoteIds([item('one', 'a', 10, 10), item('two', 'b', 10, 10)])).toEqual([
			'a',
			'b'
		]);
	});
});
