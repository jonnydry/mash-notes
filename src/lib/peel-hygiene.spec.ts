import { describe, expect, it } from 'vitest';
import {
	filterNotesByPeelScope,
	isDeskIngredient,
	isKeptPantryNote,
	mergeSessionAndKeptPantry,
	peelScopeCounts,
	peelScopeSubtitle,
	rankSearchIdsForPeel,
	sortNotesForPeel
} from './peel-hygiene';
import type { Note } from './types';

function note(partial: Partial<Note> & Pick<Note, 'id'>): Note {
	return {
		id: partial.id,
		title: partial.title ?? partial.id,
		body: partial.body ?? '',
		folder: partial.folder ?? '',
		tags: partial.tags ?? [],
		created: partial.created ?? 1,
		modified: partial.modified ?? 1,
		pinned: partial.pinned ?? 0,
		scope: partial.scope,
		system: partial.system,
		deletedAt: partial.deletedAt
	};
}

describe('peel-hygiene', () => {
	it('classifies desk vs kept', () => {
		expect(isDeskIngredient(note({ id: 'a', scope: 'session' }))).toBe(true);
		expect(isDeskIngredient(note({ id: 'b' }))).toBe(true);
		expect(isDeskIngredient(note({ id: 'c', scope: 'kept' }))).toBe(false);
		expect(isKeptPantryNote(note({ id: 'c', scope: 'kept' }))).toBe(true);
	});

	it('filters by peel scope and counts', () => {
		const notes = [
			note({ id: 'd1', scope: 'session' }),
			note({ id: 'k1', scope: 'kept' }),
			note({ id: 'd2' })
		];
		expect(filterNotesByPeelScope(notes, 'desk').map((n) => n.id)).toEqual(['d1', 'd2']);
		expect(filterNotesByPeelScope(notes, 'kept').map((n) => n.id)).toEqual(['k1']);
		expect(peelScopeCounts(notes)).toEqual({ desk: 2, kept: 1, total: 3 });
	});

	it('sorts desk before kept', () => {
		const sorted = sortNotesForPeel([
			note({ id: 'k', scope: 'kept', modified: 9 }),
			note({ id: 'd', scope: 'session', modified: 2 })
		]);
		expect(sorted.map((n) => n.id)).toEqual(['d', 'k']);
	});

	it('writes plain subtitles', () => {
		expect(peelScopeSubtitle({ desk: 2, kept: 3, total: 5 }, 'ingredients')).toBe(
			'2 on desk · 3 kept'
		);
		expect(peelScopeSubtitle({ desk: 1, kept: 0, total: 1 }, 'ingredients')).toBe('1 on desk');
		expect(peelScopeSubtitle({ desk: 0, kept: 4, total: 4 }, 'kept')).toBe('4 kept on this device');
	});

	it('ranks search hits desk-first', () => {
		const map = new Map([
			['k', note({ id: 'k', scope: 'kept', modified: 99 })],
			['d', note({ id: 'd', scope: 'session', modified: 1 })]
		]);
		expect(rankSearchIdsForPeel(['k', 'd'], map)).toEqual(['d', 'k']);
	});

	it('merges pantry without duplicating session rows', () => {
		const merged = mergeSessionAndKeptPantry(
			[note({ id: 'shared', scope: 'session', title: 'session wins', modified: 5 })],
			[
				note({ id: 'shared', scope: 'kept', title: 'old kept', modified: 1 }),
				note({ id: 'only-kept', scope: 'kept', modified: 3 })
			]
		);
		expect(merged.find((n) => n.id === 'shared')?.title).toBe('session wins');
		expect(merged.map((n) => n.id).sort()).toEqual(['only-kept', 'shared']);
	});
});
