/**
 * Command palette + operator action registries (⌘K / selection kitchen).
 */
import { createActionRegistry, type MashActionDefinition } from './action-registry';
import { keepableNoteIds } from './keep-selection';
import type { Note } from './types';
import { exportNotesJson } from './mash';
import type { ContentSplitMode } from './split-content';

export type CommandPaletteDeps = {
	closePalette: () => void;
	handleNewNote: () => void | Promise<void>;
	clickPdfInput: () => void;
	clickDocxInput: () => void;
	clickHtmlInput: () => void;
	clickImageInput: () => void;
	clickImportInput: () => void;
	clickMarkdownImportInput: () => void;
	clickSyncInput: () => void;
	showSpacesOverview: () => void;
	openSettings: () => void;
	openShortcuts: () => void;
	copySelection: () => void | Promise<void>;
	exportSelectionMarkdown: () => void;
	exportSelectionJson: () => void;
	exportSelectionPdf: () => void | Promise<void>;
	printSelection: () => void;
	downloadSelectionMarkdown: () => void;
	exportAllJson: () => void;
	exportSyncBundle: () => void | Promise<void>;
	getNotes: () => Note[];
	getSelectionIds: () => string[];
	getSelectedId: () => string | null;
	getSelectedNote: () => Note | null;
	getCanUnmash: () => boolean;
	getNotesById: () => Map<string, Note>;
	selectedCanvasCount: () => number;
	splitCandidate: (mode: ContentSplitMode) => unknown;
	setBulkMenu: (menu: 'tag' | 'folder' | 'align' | 'operators' | 'mash' | 'more' | null) => void;
	handleDelete: () => void | Promise<void>;
	handleStickyMetaChange: (id: string, patch: { pinned: 0 | 1 }) => void;
	clearFilter: () => void;
	combineSelection: () => void | Promise<void>;
	unmashSelection: () => void | Promise<void>;
	splitSelection: (mode: ContentSplitMode) => void | Promise<void>;
	stackSelection: () => void | Promise<void>;
	spreadSelection: () => void | Promise<void>;
	sequenceSelection: () => void | Promise<void>;
	sortSelection: (mode: 'title' | 'created') => void | Promise<void>;
	shuffleSelection: () => void | Promise<void>;
	deduplicateSelection: () => void | Promise<void>;
	keepSelection: () => void | Promise<void>;
	flashToast: (msg: string, ms?: number) => void;
};

export function buildBasePaletteActions(deps: CommandPaletteDeps): MashActionDefinition[] {
	const close = () => deps.closePalette();
	return createActionRegistry([
		{ label: 'New note', action: () => void deps.handleNewNote(), shortcut: '⌘N' },
		{
			label: 'Open PDF reader…',
			action: () => {
				close();
				deps.clickPdfInput();
			},
			shortcut: ''
		},
		{
			label: 'Open Word document…',
			action: () => {
				close();
				deps.clickDocxInput();
			},
			shortcut: ''
		},
		{
			label: 'Open HTML document…',
			action: () => {
				close();
				deps.clickHtmlInput();
			},
			shortcut: ''
		},
		{
			label: 'Open image…',
			action: () => {
				close();
				deps.clickImageInput();
			},
			shortcut: ''
		},
		{
			label: 'Open desks…',
			action: () => {
				close();
				deps.showSpacesOverview();
			},
			shortcut: '⌃↑'
		},
		{
			label: 'Open Settings…',
			action: () => {
				close();
				deps.openSettings();
			},
			shortcut: ''
		},
		{
			label: 'Copy selected as Markdown',
			action: () => {
				void deps.copySelection();
				close();
			},
			shortcut: ''
		},
		{
			label: 'Export selected as Markdown',
			action: () => {
				deps.exportSelectionMarkdown();
				close();
			},
			shortcut: ''
		},
		{
			label: 'Export selected as JSON',
			action: () => {
				deps.exportSelectionJson();
				close();
			},
			shortcut: ''
		},
		{
			label: 'Tag selected notes',
			action: () => {
				if (deps.getSelectionIds().length === 0) return;
				deps.setBulkMenu('tag');
				close();
			},
			shortcut: ''
		},
		{
			label: 'Move selected to folder',
			action: () => {
				if (deps.getSelectionIds().length === 0) return;
				deps.setBulkMenu('folder');
				close();
			},
			shortcut: ''
		},
		{
			label: 'Delete selected notes',
			action: () => {
				void deps.handleDelete();
				close();
			},
			shortcut: ''
		},
		{
			label: 'Toggle pin',
			action: () => {
				const id = deps.getSelectedId();
				if (!id) return;
				const np = deps.getSelectedNote()?.pinned === 1 ? 0 : 1;
				deps.handleStickyMetaChange(id, { pinned: np as 0 | 1 });
				close();
			},
			shortcut: '⌘P'
		},
		{
			label: 'Delete current note',
			action: () => {
				void deps.handleDelete();
				close();
			},
			shortcut: ''
		},
		{ label: 'Clear filters & search', action: deps.clearFilter, shortcut: 'Esc' },
		{
			label: 'Import notes from JSON…',
			action: () => {
				close();
				deps.clickImportInput();
			},
			shortcut: ''
		},
		{
			label: 'Import markdown vault…',
			action: () => {
				close();
				deps.clickMarkdownImportInput();
			},
			shortcut: ''
		},
		{
			label: 'Export all as JSON',
			action: () => {
				const notes = deps.getNotes();
				exportNotesJson(notes, 'mash-notes-export.json');
				deps.flashToast(`Exported ${notes.length} note${notes.length === 1 ? '' : 's'} as JSON`);
				close();
			},
			shortcut: ''
		},
		{
			label: 'Export sync bundle…',
			action: () => {
				void deps.exportSyncBundle();
				close();
			},
			shortcut: ''
		},
		{
			label: 'Import sync bundle…',
			action: () => {
				close();
				deps.clickSyncInput();
			},
			shortcut: ''
		},
		{
			label: 'Keyboard shortcuts',
			action: () => {
				close();
				deps.openShortcuts();
			},
			shortcut: '?'
		},
		{
			label: 'Undo tip: content vs layout',
			action: () => {
				close();
				deps.flashToast('In a sticky: ⌘Z undoes typing. On the board: ⌘Z undoes move/align.');
			},
			shortcut: '⌘Z'
		}
	]);
}

export function buildOperatorActions(deps: CommandPaletteDeps): MashActionDefinition[] {
	const multi = () => deps.selectedCanvasCount() >= 2;
	return createActionRegistry([
		{
			id: 'combine-selection',
			label: 'Mash selected notes',
			shortcut: '⌘M',
			mutation: 'content',
			surfaces: ['palette', 'shortcut', 'context'],
			available: multi,
			confirmation: 'required',
			undo: 'content',
			action: () => void deps.combineSelection()
		},
		{
			id: 'unmash-selection',
			label: 'Unmash selected result',
			shortcut: '',
			mutation: 'content',
			surfaces: ['palette', 'context'],
			available: () => deps.getCanUnmash(),
			undo: 'content',
			action: () => void deps.unmashSelection()
		},
		{
			id: 'split-selection-headings',
			label: 'Split selected card by headings',
			shortcut: '',
			mutation: 'content',
			surfaces: ['palette', 'selection'],
			available: () => Boolean(deps.splitCandidate('headings')),
			undo: 'content',
			action: () => void deps.splitSelection('headings')
		},
		{
			id: 'split-selection-paragraphs',
			label: 'Split selected card by paragraphs',
			shortcut: '',
			mutation: 'content',
			surfaces: ['palette', 'selection'],
			available: () => Boolean(deps.splitCandidate('paragraphs')),
			undo: 'content',
			action: () => void deps.splitSelection('paragraphs')
		},
		{
			id: 'split-selection-lines',
			label: 'Split selected card by lines',
			shortcut: '',
			mutation: 'content',
			surfaces: ['palette', 'selection'],
			available: () => Boolean(deps.splitCandidate('lines')),
			undo: 'content',
			action: () => void deps.splitSelection('lines')
		},
		{
			id: 'export-selection-pdf',
			label: 'Export selected as PDF',
			shortcut: '',
			mutation: 'none',
			surfaces: ['palette'],
			available: () => deps.getSelectionIds().length >= 1,
			action: () => void deps.exportSelectionPdf()
		},
		{
			id: 'print-selection',
			label: 'Print selected notes',
			shortcut: '',
			mutation: 'none',
			surfaces: ['palette'],
			available: () => deps.getSelectionIds().length >= 1,
			action: deps.printSelection
		},
		{
			id: 'export-selection-markdown',
			label: 'Download selected as Markdown',
			shortcut: '',
			mutation: 'none',
			surfaces: ['palette'],
			available: () => deps.getSelectionIds().length >= 1,
			action: deps.downloadSelectionMarkdown
		},
		{
			id: 'stack-selection',
			label: 'Stack selected cards',
			shortcut: '',
			mutation: 'layout',
			surfaces: ['palette', 'selection'],
			available: multi,
			undo: 'layout',
			action: () => void deps.stackSelection()
		},
		{
			id: 'spread-selection',
			label: 'Spread selected cards',
			shortcut: '',
			mutation: 'layout',
			surfaces: ['palette', 'selection'],
			available: multi,
			undo: 'layout',
			action: () => void deps.spreadSelection()
		},
		{
			id: 'sequence-selection',
			label: 'Sequence selected in reading order',
			shortcut: '',
			mutation: 'layout',
			surfaces: ['palette', 'selection'],
			available: multi,
			undo: 'layout',
			action: () => void deps.sequenceSelection()
		},
		{
			id: 'sort-selection-title',
			label: 'Sort selected by title',
			shortcut: '',
			mutation: 'layout',
			surfaces: ['palette', 'selection'],
			available: multi,
			undo: 'layout',
			action: () => void deps.sortSelection('title')
		},
		{
			id: 'sort-selection-created',
			label: 'Sort selected by creation time',
			shortcut: '',
			mutation: 'layout',
			surfaces: ['palette', 'selection'],
			available: multi,
			undo: 'layout',
			action: () => void deps.sortSelection('created')
		},
		{
			id: 'shuffle-selection',
			label: 'Shuffle selected cards',
			shortcut: '',
			mutation: 'layout',
			surfaces: ['palette', 'selection'],
			available: multi,
			undo: 'layout',
			action: () => void deps.shuffleSelection()
		},
		{
			id: 'deduplicate-selection',
			label: 'Deduplicate selected cards',
			shortcut: '',
			mutation: 'content',
			surfaces: ['palette', 'selection'],
			available: multi,
			undo: 'content',
			action: () => void deps.deduplicateSelection()
		},
		{
			id: 'keep-selection',
			label: 'Keep selected on this device',
			shortcut: '',
			mutation: 'content',
			surfaces: ['palette', 'selection'],
			available: () => keepableNoteIds(deps.getSelectionIds(), deps.getNotesById()).length > 0,
			action: () => void deps.keepSelection()
		}
	]);
}
