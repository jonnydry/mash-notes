import { describe, expect, it } from 'vitest';
import type { CanvasItem, Note } from './types';
import {
	isMashWelcomeForPinnedEmptyState,
	isPermanentMashWelcomeNote,
	MASH_SPOON_LOGO,
	shouldShowCanvasEmptyState
} from './canvas-empty-state';

function note(partial: Partial<Note> & Pick<Note, 'id' | 'title'>): Note {
	return {
		body: '',
		folder: '',
		tags: [],
		created: 1,
		modified: 1,
		pinned: 1,
		...partial
	};
}

function item(noteId: string): CanvasItem {
	return { id: `item-${noteId}`, canvasId: 'pinned', noteId, x: 48, y: 48 };
}

describe('canvas empty state', () => {
	it('recognizes permanent and legacy Mash welcome notes', () => {
		expect(
			isMashWelcomeForPinnedEmptyState({
				id: 'mash-team-welcome-v1',
				title: 'A quick hello from Scoop',
				tags: ['welcome', 'mash-team']
			})
		).toBe(true);
		expect(
			isMashWelcomeForPinnedEmptyState({
				id: 'legacy',
				title: 'Welcome to Mash',
				tags: ['welcome']
			})
		).toBe(true);
		expect(
			isMashWelcomeForPinnedEmptyState({
				id: 'regular',
				title: 'Welcome clients',
				tags: ['welcome']
			})
		).toBe(false);
	});

	it('uses the Scoop mark only for the permanent welcome identity', () => {
		expect(
			isPermanentMashWelcomeNote({
				id: 'mash-team-welcome-v1',
				title: 'A quick hello from Scoop',
				tags: ['welcome', 'mash-team']
			})
		).toBe(true);
		expect(
			isPermanentMashWelcomeNote({
				id: 'legacy',
				title: 'Welcome to Mash',
				tags: ['welcome']
			})
		).toBe(false);
		expect(MASH_SPOON_LOGO).toContain('Mashed%20potato%20character@2x.png');
	});

	it('keeps the pinned heart visible only when welcome is the sole card', () => {
		const welcome = note({ id: 'welcome', title: 'Welcome to Mash', tags: ['welcome'] });
		const favorite = note({ id: 'favorite', title: 'Favorite' });
		const notes = new Map([
			[welcome.id, welcome],
			[favorite.id, favorite]
		]);

		expect(shouldShowCanvasEmptyState([], notes, true)).toBe(true);
		expect(shouldShowCanvasEmptyState([item(welcome.id)], notes, true)).toBe(true);
		expect(shouldShowCanvasEmptyState([item(favorite.id)], notes, true)).toBe(false);
		expect(shouldShowCanvasEmptyState([item(welcome.id), item(favorite.id)], notes, true)).toBe(
			false
		);
		expect(shouldShowCanvasEmptyState([item(welcome.id)], notes, false)).toBe(false);
	});

	it('treats orphan placements as empty', () => {
		const notes = new Map<string, Note>();
		expect(shouldShowCanvasEmptyState([item('missing')], notes, false)).toBe(true);
	});
});
