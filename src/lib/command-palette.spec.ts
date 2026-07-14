import { describe, expect, it, vi } from 'vitest';
import { actionsForSurface } from './action-registry';
import {
	buildBasePaletteActions,
	buildOperatorActions,
	type CommandPaletteDeps
} from './command-palette';
import type { Note } from './types';

function note(partial: Partial<Note> & { id: string }): Note {
	return {
		title: partial.id,
		body: '',
		folder: '',
		tags: [],
		created: 1,
		modified: 1,
		pinned: 0,
		...partial
	};
}

function makeDeps(overrides: Partial<CommandPaletteDeps> = {}): CommandPaletteDeps {
	const notes = [note({ id: 'a' }), note({ id: 'b' })];
	const notesById = new Map(notes.map((n) => [n.id, n]));
	return {
		closePalette: vi.fn(),
		handleNewNote: vi.fn(),
		clickPdfInput: vi.fn(),
		clickDocxInput: vi.fn(),
		clickHtmlInput: vi.fn(),
		clickImageInput: vi.fn(),
		clickDelimitedInput: vi.fn(),
		clickWorkspaceRestoreInput: vi.fn(),
		clickImportInput: vi.fn(),
		clickMarkdownImportInput: vi.fn(),
		clickSyncInput: vi.fn(),
		showSpacesOverview: vi.fn(),
		openSettings: vi.fn(),
		openShortcuts: vi.fn(),
		copySelection: vi.fn(),
		exportSelectionMarkdown: vi.fn(),
		exportSelectionJson: vi.fn(),
		exportSelectionPdf: vi.fn(),
		printSelection: vi.fn(),
		downloadSelectionMarkdown: vi.fn(),
		exportAllJson: vi.fn(),
		exportSyncBundle: vi.fn(),
		exportWorkspaceBackup: vi.fn(),
		getNotes: () => notes,
		getSelectionIds: () => [],
		getSelectedId: () => null,
		getSelectedNote: () => null,
		getCanUnmash: () => false,
		getNotesById: () => notesById,
		selectedCanvasCount: () => 0,
		splitCandidate: () => null,
		setBulkMenu: vi.fn(),
		handleDelete: vi.fn(),
		handleStickyMetaChange: vi.fn(),
		clearFilter: vi.fn(),
		combineSelection: vi.fn(),
		unmashSelection: vi.fn(),
		splitSelection: vi.fn(),
		stackSelection: vi.fn(),
		spreadSelection: vi.fn(),
		sequenceSelection: vi.fn(),
		sortSelection: vi.fn(),
		shuffleSelection: vi.fn(),
		deduplicateSelection: vi.fn(),
		keepSelection: vi.fn(),
		flashToast: vi.fn(),
		...overrides
	};
}

describe('buildBasePaletteActions', () => {
	it('registers core desk commands with stable ids and shortcuts', () => {
		const deps = makeDeps();
		const actions = buildBasePaletteActions(deps);
		const byId = Object.fromEntries(actions.map((a) => [a.id, a]));

		expect(byId['new-note']?.shortcut).toBe('⌘N');
		expect(byId['toggle-pin']?.shortcut).toBe('⌘P');
		expect(byId['keyboard-shortcuts']?.shortcut).toBe('?');
		expect(byId['open-desks']?.shortcut).toBe('⌃↑');
		expect(byId['clear-filters-search']?.shortcut).toBe('Esc');

		// Reader / import entry points exist
		expect(byId['open-pdf-reader']).toBeTruthy();
		expect(byId['open-word-document']).toBeTruthy();
		expect(byId['open-html-document']).toBeTruthy();
		expect(byId['open-csv-tsv-table']).toBeTruthy();
		expect(byId['import-desk-bundle']).toBeTruthy();
		expect(byId['back-up-workspace']).toBeTruthy();
		expect(byId['restore-workspace-backup']).toBeTruthy();
	});

	it('closes the palette before opening external pickers', () => {
		const deps = makeDeps();
		const actions = buildBasePaletteActions(deps);
		const openPdf = actions.find((a) => a.id === 'open-pdf-reader')!;
		openPdf.action();
		expect(deps.closePalette).toHaveBeenCalled();
		expect(deps.clickPdfInput).toHaveBeenCalledOnce();
	});

	it('guards tag/folder bulk actions when nothing is selected', () => {
		const deps = makeDeps({ getSelectionIds: () => [] });
		const actions = buildBasePaletteActions(deps);
		actions.find((a) => a.id === 'tag-selected-notes')!.action();
		actions.find((a) => a.id === 'move-selected-to-folder')!.action();
		expect(deps.setBulkMenu).not.toHaveBeenCalled();

		const deps2 = makeDeps({ getSelectionIds: () => ['a'] });
		const actions2 = buildBasePaletteActions(deps2);
		actions2.find((a) => a.id === 'tag-selected-notes')!.action();
		expect(deps2.setBulkMenu).toHaveBeenCalledWith('tag');
		expect(deps2.closePalette).toHaveBeenCalled();
	});

	it('toggle pin flips pinned flag for the selected note', () => {
		const deps = makeDeps({
			getSelectedId: () => 'a',
			getSelectedNote: () => note({ id: 'a', pinned: 0 })
		});
		buildBasePaletteActions(deps)
			.find((a) => a.id === 'toggle-pin')!
			.action();
		expect(deps.handleStickyMetaChange).toHaveBeenCalledWith('a', { pinned: 1 });
	});
});

describe('buildOperatorActions', () => {
	it('hides multi-select layout ops until 2+ cards are selected', () => {
		const single = makeDeps({ selectedCanvasCount: () => 1, getSelectionIds: () => ['a'] });
		const multi = makeDeps({
			selectedCanvasCount: () => 3,
			getSelectionIds: () => ['a', 'b', 'c']
		});

		const singleIds = actionsForSurface(buildOperatorActions(single), 'palette').map((a) => a.id);
		const multiIds = actionsForSurface(buildOperatorActions(multi), 'palette').map((a) => a.id);

		expect(singleIds).not.toContain('combine-selection');
		expect(singleIds).not.toContain('stack-selection');
		expect(multiIds).toContain('combine-selection');
		expect(multiIds).toContain('stack-selection');
		expect(multiIds).toContain('shuffle-selection');
	});

	it('marks mash as content mutation requiring confirmation', () => {
		const deps = makeDeps({ selectedCanvasCount: () => 2 });
		const mash = buildOperatorActions(deps).find((a) => a.id === 'combine-selection')!;
		expect(mash.mutation).toBe('content');
		expect(mash.confirmation).toBe('required');
		expect(mash.shortcut).toBe('⌘M');
		expect(mash.undo).toBe('content');
	});

	it('shows unmash only when getCanUnmash is true', () => {
		const no = makeDeps({ getCanUnmash: () => false });
		const yes = makeDeps({ getCanUnmash: () => true });
		expect(
			actionsForSurface(buildOperatorActions(no), 'palette').some(
				(a) => a.id === 'unmash-selection'
			)
		).toBe(false);
		expect(
			actionsForSurface(buildOperatorActions(yes), 'palette').some(
				(a) => a.id === 'unmash-selection'
			)
		).toBe(true);
	});

	it('keeps export/print available for any non-empty selection', () => {
		const deps = makeDeps({ getSelectionIds: () => ['a'], selectedCanvasCount: () => 1 });
		const ids = actionsForSurface(buildOperatorActions(deps), 'palette').map((a) => a.id);
		expect(ids).toContain('export-selection-pdf');
		expect(ids).toContain('print-selection');
		expect(ids).toContain('export-selection-markdown');
	});

	it('offers keep only when selection has non-kept session notes', () => {
		const keptOnly = makeDeps({
			getSelectionIds: () => ['a'],
			getNotesById: () => new Map([['a', note({ id: 'a', scope: 'kept' })]])
		});
		const session = makeDeps({
			getSelectionIds: () => ['a'],
			getNotesById: () => new Map([['a', note({ id: 'a', scope: 'session' })]])
		});

		expect(
			actionsForSurface(buildOperatorActions(keptOnly), 'palette').some(
				(a) => a.id === 'keep-selection'
			)
		).toBe(false);
		expect(
			actionsForSurface(buildOperatorActions(session), 'palette').some(
				(a) => a.id === 'keep-selection'
			)
		).toBe(true);
	});

	it('invokes operator deps when actions run', () => {
		const deps = makeDeps({ selectedCanvasCount: () => 2 });
		const actions = buildOperatorActions(deps);
		actions.find((a) => a.id === 'combine-selection')!.action();
		actions.find((a) => a.id === 'stack-selection')!.action();
		expect(deps.combineSelection).toHaveBeenCalledOnce();
		expect(deps.stackSelection).toHaveBeenCalledOnce();
	});
});
