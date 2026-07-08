/**
 * Note library helpers — filter, selection, search-facing list shaping.
 */
import type { Note } from '$lib/types';
import type { NavFilter } from '$lib/note-ui';
import { searchNotes } from '$lib/search';

export function filterNotes(
	notes: Note[],
	currentFilter: NavFilter,
	searchQuery: string
): Note[] {
	let list = [...notes];

	list = list.filter((n) => {
		if (currentFilter.type === 'pinned') return n.pinned === 1;
		if (currentFilter.type === 'folder' && currentFilter.value) {
			return n.folder === currentFilter.value || n.folder.startsWith(currentFilter.value + '/');
		}
		if (currentFilter.type === 'tag' && currentFilter.value) {
			return n.tags.includes(currentFilter.value);
		}
		return true;
	});

	if (searchQuery.trim()) {
		const results = searchNotes(searchQuery, {
			folder: currentFilter.type === 'folder' ? currentFilter.value : undefined,
			tags:
				currentFilter.type === 'tag' && currentFilter.value ? [currentFilter.value] : undefined
		});
		const idSet = new Set(results.map((r) => r.id));
		list = list.filter((n) => idSet.has(n.id));
	}

	list.sort((a, b) => {
		if (a.pinned !== b.pinned) return b.pinned - a.pinned;
		return b.modified - a.modified;
	});
	return list;
}

export function filterPeelNotes(notes: Note[], peelFilterText: string): Note[] {
	const q = peelFilterText.trim().toLowerCase();
	if (!q) return notes;
	return notes.filter(
		(n) =>
			n.title.toLowerCase().includes(q) ||
			n.body.toLowerCase().includes(q) ||
			n.folder.toLowerCase().includes(q) ||
			n.tags.some((t) => t.toLowerCase().includes(q))
	);
}

export function uniqueFoldersFrom(notes: Note[]): string[] {
	return [...new Set(notes.map((n) => n.folder).filter(Boolean))].sort();
}

export function uniqueTagsFrom(notes: Note[]): string[] {
	return [...new Set(notes.flatMap((n) => n.tags))].sort();
}

export function canvasFolderFromFilter(filter: NavFilter): string {
	return filter.type === 'folder' && filter.value !== undefined ? filter.value : '';
}

export function canvasTitleFromFilter(filter: NavFilter): string {
	if (filter.type === 'folder' && filter.value) return filter.value;
	return 'Desk';
}
