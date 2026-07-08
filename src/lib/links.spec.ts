import { describe, it, expect } from 'vitest';
import {
	findBacklinks,
	findOutgoingNotes,
	findNoteByTitle,
	linkSummary
} from './links';
import type { Note } from './types';

function note(partial: Partial<Note> & Pick<Note, 'id' | 'title'>): Note {
	return {
		body: '',
		folder: '',
		tags: [],
		created: 1,
		modified: 1,
		pinned: 0,
		...partial
	};
}

describe('links', () => {
	const alpha = note({
		id: 'a',
		title: 'Alpha',
		body: 'See [[Beta]] and [[Gamma]]',
		links: ['Beta', 'Gamma']
	});
	const beta = note({
		id: 'b',
		title: 'Beta',
		body: 'Back to [[Alpha]]',
		links: ['Alpha']
	});
	const gamma = note({ id: 'c', title: 'Gamma', body: 'solo' });
	const all = [alpha, beta, gamma];

	it('finds notes by title case-insensitively', () => {
		expect(findNoteByTitle(all, 'alpha')?.id).toBe('a');
	});

	it('resolves outgoing notes', () => {
		expect(findOutgoingNotes(all, alpha).map((n) => n.id).sort()).toEqual(['b', 'c']);
	});

	it('finds backlinks', () => {
		expect(findBacklinks(all, alpha).map((n) => n.id)).toEqual(['b']);
		expect(findBacklinks(all, beta).map((n) => n.id)).toEqual(['a']);
	});

	it('prefers body wikilinks over stale links cache', () => {
		const stale = note({
			id: 's',
			title: 'Stale',
			body: 'Now [[Beta]] only',
			links: ['Alpha', 'Gamma']
		});
		expect(findOutgoingNotes(all, stale).map((n) => n.id)).toEqual(['b']);
	});

	it('summarizes links and unresolved', () => {
		const orphan = note({
			id: 'd',
			title: 'Orphan',
			body: '[[Missing]]',
			links: ['Missing']
		});
		const s = linkSummary([...all, orphan], orphan);
		expect(s.outgoingCount).toBe(1);
		expect(s.unresolved).toEqual(['Missing']);
		expect(s.backlinkCount).toBe(0);
	});
});
