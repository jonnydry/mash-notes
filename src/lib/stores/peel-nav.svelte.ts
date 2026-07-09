/**
 * Peel / dock navigation state (filter + scanner mode).
 */
import { tick } from 'svelte';
import type { DockAction } from '$lib/dock';
import type { PeelMode } from '$lib/components/PeelScanner.svelte';
import type { NavFilter } from '$lib/note-ui';
import { canvasFolderFromFilter, canvasKeyFromFilter, canvasTitleFromFilter } from '$lib/stores/note-library.svelte';

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
	_searchQuery: string,
	filter: NavFilter
): string {
	if (mode === 'folders') return 'Folders';
	if (mode === 'tags') return 'Tags';
	if (mode === 'linked') return 'Linked';
	// Header search has its own dropdown; peel titles reflect browse filters only.
	if (filter.type === 'pinned') return 'Pinned';
	if (filter.type === 'folder' && filter.value) return filter.value;
	if (filter.type === 'tag' && filter.value) return `#${filter.value}`;
	return 'All notes';
}

/** Header search updates the query only — it must not open the peel. */
export function handleGlobalSearchInput(
	current: string,
	next: string
): { searchQuery: string; openPeel: boolean } {
	return { searchQuery: next, openPeel: false };
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
	getSettingsOpen: () => boolean;
	openSettings: () => void;
	closeSettings: () => void;
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
			h.focusSearch();
			break;
		case 'settings':
			if (h.getSettingsOpen()) h.closeSettings();
			else {
				h.closePeel(true);
				h.openSettings();
			}
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

export type CreatePeelNavOpts = {
	clearSelection: () => void;
	newNote: () => void;
	getExpandedNoteId: () => string | null;
	getSelectedId: () => string | null;
	getFirstNoteId: () => string | null;
	getSettingsOpen: () => boolean;
	openSettings: () => void;
	closeSettings: () => void;
};

export function createPeelNav(opts: CreatePeelNavOpts) {
	let peelOpen = $state(false);
	let peelPinned = $state(false);
	let peelMode = $state<PeelMode>('notes');
	let peelFilterText = $state('');
	let foldersFlyout = $state(false);
	let tagsFlyout = $state(false);
	let linkedFlyout = $state(false);
	let linkedFocusId = $state<string | null>(null);
	let currentFilter = $state<NavFilter>({ type: null });
	let searchQuery = $state('');

	const peelTitle = $derived(peelTitleFor(peelMode, searchQuery, currentFilter));
	const canvasFolder = $derived(canvasFolderFromFilter(currentFilter));
	const canvasKey = $derived(canvasKeyFromFilter(currentFilter));
	const canvasTitle = $derived(canvasTitleFromFilter(currentFilter));

	function openPeel(mode: PeelMode = 'notes') {
		opts.closeSettings();
		const patch = peelOpenPatch(mode);
		peelMode = patch.peelMode;
		peelOpen = patch.peelOpen;
		foldersFlyout = patch.foldersFlyout;
		tagsFlyout = patch.tagsFlyout;
		linkedFlyout = patch.linkedFlyout;
	}

	function closePeel(force = false) {
		if (peelPinned && !force) return;
		const patch = peelClosePatch();
		peelOpen = patch.peelOpen;
		foldersFlyout = patch.foldersFlyout;
		tagsFlyout = patch.tagsFlyout;
		linkedFlyout = patch.linkedFlyout;
	}

	function openLinkedPeel(noteId: string) {
		linkedFocusId = noteId;
		openPeel('linked');
	}

	function setFilter(type: 'folder' | 'tag' | 'pinned', value?: string) {
		if (currentFilter.type === type && currentFilter.value === value) {
			currentFilter = { type: null };
		} else if (type === 'pinned') {
			currentFilter = { type: 'pinned' };
		} else {
			currentFilter = { type, value };
		}
		searchQuery = '';
		peelFilterText = '';
		opts.clearSelection();
	}

	function clearFilter() {
		currentFilter = { type: null };
		searchQuery = '';
		peelFilterText = '';
		opts.clearSelection();
	}

	function handleGlobalSearch(e: Event) {
		const next = (e.target as HTMLInputElement).value;
		const patch = handleGlobalSearchInput(searchQuery, next);
		searchQuery = patch.searchQuery;
	}

	function focusSearch() {
		void tick().then(() => {
			(document.getElementById('global-search') as HTMLInputElement | null)?.focus();
		});
	}

	function handleDockAction(action: DockAction) {
		dispatchDockAction(action, {
			clearFilter,
			setFilter: (type, value) => setFilter(type, value),
			openPeel,
			closePeel,
			getPeelOpen: () => peelOpen,
			getPeelMode: () => peelMode,
			setLinkedFocus: (id) => {
				linkedFocusId = id;
			},
			resolveLinkedFocus: () =>
				opts.getExpandedNoteId() ??
				opts.getSelectedId() ??
				linkedFocusId ??
				opts.getFirstNoteId(),
			newNote: opts.newNote,
			focusSearch,
			getSettingsOpen: opts.getSettingsOpen,
			openSettings: opts.openSettings,
			closeSettings: opts.closeSettings
		});
	}

	function togglePin() {
		peelPinned = !peelPinned;
	}

	return {
		get peelOpen() {
			return peelOpen;
		},
		set peelOpen(v: boolean) {
			peelOpen = v;
		},
		get peelPinned() {
			return peelPinned;
		},
		set peelPinned(v: boolean) {
			peelPinned = v;
		},
		get peelMode() {
			return peelMode;
		},
		set peelMode(v: PeelMode) {
			peelMode = v;
		},
		get peelFilterText() {
			return peelFilterText;
		},
		set peelFilterText(v: string) {
			peelFilterText = v;
		},
		get foldersFlyout() {
			return foldersFlyout;
		},
		set foldersFlyout(v: boolean) {
			foldersFlyout = v;
		},
		get tagsFlyout() {
			return tagsFlyout;
		},
		set tagsFlyout(v: boolean) {
			tagsFlyout = v;
		},
		get linkedFlyout() {
			return linkedFlyout;
		},
		set linkedFlyout(v: boolean) {
			linkedFlyout = v;
		},
		get linkedFocusId() {
			return linkedFocusId;
		},
		set linkedFocusId(v: string | null) {
			linkedFocusId = v;
		},
		get currentFilter() {
			return currentFilter;
		},
		set currentFilter(v: NavFilter) {
			currentFilter = v;
		},
		get searchQuery() {
			return searchQuery;
		},
		set searchQuery(v: string) {
			searchQuery = v;
		},
		get peelTitle() {
			return peelTitle;
		},
		get canvasFolder() {
			return canvasFolder;
		},
		get canvasKey() {
			return canvasKey;
		},
		get canvasTitle() {
			return canvasTitle;
		},
		openPeel,
		closePeel,
		openLinkedPeel,
		setFilter,
		clearFilter,
		handleGlobalSearch,
		handleDockAction,
		togglePin
	};
}
