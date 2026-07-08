/**
 * Peel / dock navigation state (filter + scanner mode).
 */
import type { DockAction } from '$lib/dock';
import type { PeelMode } from '$lib/components/PeelScanner.svelte';
import type { NavFilter } from '$lib/note-ui';

export type PeelNavState = {
	peelOpen: boolean;
	peelPinned: boolean;
	peelMode: PeelMode;
	peelFilterText: string;
	foldersFlyout: boolean;
	tagsFlyout: boolean;
	linkedFlyout: boolean;
	linkedFocusId: string | null;
	currentFilter: NavFilter;
	searchQuery: string;
};

export function createPeelNavState(): PeelNavState {
	return {
		peelOpen: false,
		peelPinned: false,
		peelMode: 'notes',
		peelFilterText: '',
		foldersFlyout: false,
		tagsFlyout: false,
		linkedFlyout: false,
		linkedFocusId: null,
		currentFilter: { type: null },
		searchQuery: ''
	};
}

export function peelTitleFor(
	mode: PeelMode,
	searchQuery: string,
	filter: NavFilter
): string {
	if (mode === 'folders') return 'Folders';
	if (mode === 'tags') return 'Tags';
	if (mode === 'linked') return 'Linked';
	if (searchQuery.trim()) return 'Search results';
	if (filter.type === 'pinned') return 'Pinned';
	if (filter.type === 'folder' && filter.value) return filter.value;
	if (filter.type === 'tag' && filter.value) return `#${filter.value}`;
	return 'All notes';
}

export type PeelOpenResult = Pick<
	PeelNavState,
	'peelMode' | 'peelOpen' | 'foldersFlyout' | 'tagsFlyout' | 'linkedFlyout'
>;

export function peelOpenPatch(mode: PeelMode): PeelOpenResult {
	return {
		peelMode: mode,
		peelOpen: true,
		foldersFlyout: mode === 'folders',
		tagsFlyout: mode === 'tags',
		linkedFlyout: mode === 'linked'
	};
}

export function peelClosePatch(): Pick<
	PeelNavState,
	'peelOpen' | 'foldersFlyout' | 'tagsFlyout' | 'linkedFlyout'
> {
	return {
		peelOpen: false,
		foldersFlyout: false,
		tagsFlyout: false,
		linkedFlyout: false
	};
}

export type DockActionHandlers = {
	clearFilter: () => void;
	setFilter: (type: 'folder' | 'tag' | 'pinned', value?: string) => void;
	openPeel: (mode?: PeelMode) => void;
	closePeel: (force?: boolean) => void;
	getPeelOpen: () => boolean;
	getPeelMode: () => PeelMode;
	setLinkedFocus: (id: string | null) => void;
	resolveLinkedFocus: () => string | null;
	newNote: () => void;
	focusSearch: () => void;
};

export function dispatchDockAction(action: DockAction, h: DockActionHandlers): void {
	switch (action) {
		case 'all':
			h.clearFilter();
			h.openPeel('notes');
			break;
		case 'pinned':
			h.setFilter('pinned');
			h.openPeel('notes');
			break;
		case 'folders':
			if (h.getPeelOpen() && h.getPeelMode() === 'folders') h.closePeel(true);
			else h.openPeel('folders');
			break;
		case 'tags':
			if (h.getPeelOpen() && h.getPeelMode() === 'tags') h.closePeel(true);
			else h.openPeel('tags');
			break;
		case 'linked': {
			if (h.getPeelOpen() && h.getPeelMode() === 'linked') {
				h.closePeel(true);
			} else {
				const focus = h.resolveLinkedFocus();
				if (focus) h.setLinkedFocus(focus);
				h.openPeel('linked');
			}
			break;
		}
		case 'new':
			h.newNote();
			break;
		case 'search':
			h.openPeel('notes');
			h.focusSearch();
			break;
		default: {
			const _exhaustive: never = action;
			void _exhaustive;
		}
	}
}

/** Cap peel list window for very large libraries (search index stays full). */
export const PEEL_UI_CAP = 2500;

export function windowPeelNotes<T>(notes: T[]): T[] {
	return notes.length > PEEL_UI_CAP ? notes.slice(0, PEEL_UI_CAP) : notes;
}
