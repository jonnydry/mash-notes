/**
 * Mash — Search Layer (MiniSearch)
 *
 * Fast, client-side full-text + fuzzy search over notes.
 * One-directional dependency: imports from db.ts only for hydration.
 * Never imported by db.ts — the UI layer orchestrates search updates.
 */

import MiniSearch from 'minisearch';
import type { Note } from './types';
import { getAllNotesForSearchIndex } from './db';

// =============================================================================
// TYPES
// =============================================================================

export interface SearchResult {
	id: string;
	title: string;
	folder: string;
	tags: string[];
	modified: number;
	pinned: 0 | 1;
	score: number;
}

export interface SearchFilters {
	folder?: string;
	tags?: string[];
}

// =============================================================================
// MINI SEARCH INSTANCE
// =============================================================================

const miniSearch = new MiniSearch<Note>({
	fields: ['title', 'body', 'tagsJoined'],
	storeFields: ['id', 'title', 'folder', 'tags', 'modified', 'pinned'],
	searchOptions: {
		boost: { title: 2 },
		prefix: true,
		fuzzy: 0.2,
		combineWith: 'AND',
	},
});

let isInitialized = false;

// =============================================================================
// INITIALIZATION
// =============================================================================

/**
 * Hydrate the search index from IndexedDB. Call once on app startup.
 */
export async function initSearchIndex(): Promise<void> {
	if (isInitialized) return;

	const notes = await getAllNotesForSearchIndex();
	const docs = notes.map(prepareDocForIndex);
	miniSearch.addAll(docs);

	isInitialized = true;
}

// =============================================================================
// INCREMENTAL UPDATES — called by the UI layer after DB mutations
// =============================================================================

/**
 * Normalize text for consistent indexing and querying:
 * - NFC Unicode normalization (canonical decomposition + composition)
 * - Strip HTML tags to spaces (prevents word-merging across tag boundaries)
 * - Remove zero-width / BOM characters that silently break matching
 * - Collapse whitespace and trim
 */
function normalizeForSearch(s: string): string {
	return s
		.normalize('NFC')
		.replace(/<[^>]+>/g, ' ')          // HTML tags → space
		.replace(/[\u200B-\u200D\uFEFF]/g, '') // zero-width + BOM
		.replace(/\s+/g, ' ')
		.trim();
}

function prepareDocForIndex(note: Note) {
	return {
		...note,
		title: normalizeForSearch(note.title),
		body: normalizeForSearch(note.body),
		tagsJoined: normalizeForSearch(note.tags.join(' ')),
	};
}

export function addNoteToSearch(note: Note): void {
	if (!isInitialized) return;
	miniSearch.add(prepareDocForIndex(note));
}

export function updateNoteInSearch(
	partial: Partial<Note> & { id: string },
	fullNote?: Note,
): void {
	if (!isInitialized) return;
	miniSearch.discard(partial.id);
	const docToAdd = fullNote ?? partial;
	if (docToAdd.title || docToAdd.body) {
		miniSearch.add(prepareDocForIndex(docToAdd as Note));
	}
}

export function removeNoteFromSearch(id: string): void {
	if (!isInitialized) return;
	miniSearch.discard(id);
}

// =============================================================================
// SEARCH
// =============================================================================

/**
 * Search notes by free-text query with optional structured filters.
 * Returns empty array when no query and no filters are active.
 */
export function searchNotes(query: string, filters: SearchFilters = {}): SearchResult[] {
	if (!query.trim() && !filters.folder && (!filters.tags || filters.tags.length === 0)) {
		return [];
	}

	let results = miniSearch.search(normalizeForSearch(query.trim() || ''));

	if (filters.folder) {
		const folderPrefix = filters.folder;
		results = results.filter(
			(r) => r.folder === folderPrefix || r.folder.startsWith(folderPrefix + '/'),
		);
	}

	if (filters.tags && filters.tags.length > 0) {
		const requiredTags = filters.tags;
		results = results.filter((r) => requiredTags.every((tag) => r.tags.includes(tag)));
	}

	return results.map((r) => ({
		id: r.id,
		title: r.title,
		folder: r.folder,
		tags: r.tags,
		modified: r.modified,
		pinned: r.pinned,
		score: r.score,
	}));
}

/**
 * Returns the current number of documents in the search index.
 */
export function getSearchIndexSize(): number {
	return miniSearch.documentCount;
}

/**
 * Test-only: reset the MiniSearch singleton and re-allow initialization.
 * Production code should never call this.
 */
export function resetSearchIndexForTests(): void {
	miniSearch.removeAll();
	isInitialized = false;
}