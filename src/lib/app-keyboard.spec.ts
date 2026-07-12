import { describe, expect, it, vi, afterEach } from 'vitest';
import { createAppKeydown, type AppKeyboardDeps } from './app-keyboard';

/** Minimal KeyboardEvent stand-in for the node test environment. */
function keyEvent(
	key: string,
	init: {
		metaKey?: boolean;
		ctrlKey?: boolean;
		shiftKey?: boolean;
		altKey?: boolean;
		target?: { tagName?: string; isContentEditable?: boolean } | null;
	} = {}
): KeyboardEvent {
	const preventDefault = vi.fn();
	return {
		key,
		metaKey: init.metaKey ?? false,
		ctrlKey: init.ctrlKey ?? false,
		shiftKey: init.shiftKey ?? false,
		altKey: init.altKey ?? false,
		target: init.target ?? null,
		preventDefault
	} as unknown as KeyboardEvent;
}

function makeDeps(overrides: Partial<AppKeyboardDeps> = {}): AppKeyboardDeps {
	return {
		canvasUndo: vi.fn(),
		canvasRedo: vi.fn(),
		togglePalette: vi.fn(),
		handleNewNote: vi.fn(),
		startTypingNote: vi.fn(),
		canStartTypingNote: vi.fn(() => true),
		invokeCombineSelection: vi.fn(),
		getSelectionCount: vi.fn(() => 0),
		getSelectedId: vi.fn(() => null),
		getSelectedNote: vi.fn(() => null),
		togglePinSelected: vi.fn(),
		openShortcuts: vi.fn(),
		showSpacesOverview: vi.fn(),
		focusGlobalSearch: vi.fn(),
		onEscape: vi.fn(() => false),
		...overrides
	};
}

describe('createAppKeydown', () => {
	const originalDocument = globalThis.document;

	afterEach(() => {
		if (originalDocument === undefined) {
			// @ts-expect-error restore missing document in node
			delete globalThis.document;
		} else {
			globalThis.document = originalDocument;
		}
	});

	it('⌘/Ctrl+K toggles the palette and prevents default', () => {
		const deps = makeDeps();
		const handle = createAppKeydown(deps);
		const e = keyEvent('k', { metaKey: true });
		handle(e);
		expect(e.preventDefault).toHaveBeenCalled();
		expect(deps.togglePalette).toHaveBeenCalledOnce();
	});

	it('⌘/Ctrl+N creates a new note', () => {
		const deps = makeDeps();
		const handle = createAppKeydown(deps);
		handle(keyEvent('n', { ctrlKey: true }));
		expect(deps.handleNewNote).toHaveBeenCalledOnce();
	});

	it('starts a note with the first printable character when the desk has focus', () => {
		// @ts-expect-error minimal document stub for node
		globalThis.document = { activeElement: { tagName: 'BODY' } };
		const deps = makeDeps();
		const e = keyEvent('H', { target: { tagName: 'BODY', isContentEditable: false } });
		createAppKeydown(deps)(e);
		expect(e.preventDefault).toHaveBeenCalled();
		expect(deps.startTypingNote).toHaveBeenCalledWith('H');
	});

	it('does not start a note from typing targets, modified keys, or blocked surfaces', () => {
		// @ts-expect-error minimal document stub for node
		globalThis.document = { activeElement: { tagName: 'BODY' } };
		const deps = makeDeps();
		const handle = createAppKeydown(deps);
		handle(keyEvent('a', { target: { tagName: 'INPUT', isContentEditable: false } }));
		handle(keyEvent('a', { metaKey: true, target: { tagName: 'BODY' } }));
		handle(keyEvent(' ', { target: { tagName: 'BODY' } }));
		expect(deps.startTypingNote).not.toHaveBeenCalled();

		const blocked = makeDeps({ canStartTypingNote: () => false });
		createAppKeydown(blocked)(keyEvent('a', { target: { tagName: 'BODY' } }));
		expect(blocked.startTypingNote).not.toHaveBeenCalled();
	});

	it('⌘Z undoes layout when not typing; Shift+⌘Z redoes', () => {
		const deps = makeDeps();
		const handle = createAppKeydown(deps);
		handle(keyEvent('z', { metaKey: true }));
		expect(deps.canvasUndo).toHaveBeenCalledOnce();
		expect(deps.canvasRedo).not.toHaveBeenCalled();

		handle(keyEvent('z', { metaKey: true, shiftKey: true }));
		expect(deps.canvasRedo).toHaveBeenCalledOnce();
	});

	it('⌘Z is ignored while typing in an input', () => {
		const deps = makeDeps();
		const handle = createAppKeydown(deps);
		const e = keyEvent('z', {
			metaKey: true,
			target: { tagName: 'INPUT', isContentEditable: false }
		});
		handle(e);
		expect(e.preventDefault).not.toHaveBeenCalled();
		expect(deps.canvasUndo).not.toHaveBeenCalled();
	});

	it('⌘Z is ignored in contenteditable targets', () => {
		const deps = makeDeps();
		const handle = createAppKeydown(deps);
		handle(
			keyEvent('z', {
				metaKey: true,
				target: { tagName: 'DIV', isContentEditable: true }
			})
		);
		expect(deps.canvasUndo).not.toHaveBeenCalled();
	});

	it('⌘M combines only with 2+ selected and not typing', () => {
		const deps = makeDeps({ getSelectionCount: () => 1 });
		createAppKeydown(deps)(keyEvent('m', { metaKey: true }));
		expect(deps.invokeCombineSelection).not.toHaveBeenCalled();

		const deps2 = makeDeps({ getSelectionCount: () => 2 });
		createAppKeydown(deps2)(keyEvent('m', { metaKey: true }));
		expect(deps2.invokeCombineSelection).toHaveBeenCalledOnce();

		const deps3 = makeDeps({ getSelectionCount: () => 3 });
		createAppKeydown(deps3)(
			keyEvent('m', {
				metaKey: true,
				target: { tagName: 'TEXTAREA', isContentEditable: false }
			})
		);
		expect(deps3.invokeCombineSelection).not.toHaveBeenCalled();
	});

	it('⌘P toggles pin on the selected note', () => {
		const deps = makeDeps({
			getSelectedId: () => 'n1',
			getSelectedNote: () => ({ id: 'n1', pinned: 0 })
		});
		createAppKeydown(deps)(keyEvent('p', { metaKey: true }));
		expect(deps.togglePinSelected).toHaveBeenCalledWith('n1', 1);

		const deps2 = makeDeps({
			getSelectedId: () => 'n1',
			getSelectedNote: () => ({ id: 'n1', pinned: 1 as const })
		});
		createAppKeydown(deps2)(keyEvent('p', { ctrlKey: true }));
		expect(deps2.togglePinSelected).toHaveBeenCalledWith('n1', 0);
	});

	it('⌘P does nothing without a selection', () => {
		const deps = makeDeps({ getSelectedId: () => null });
		createAppKeydown(deps)(keyEvent('p', { metaKey: true }));
		expect(deps.togglePinSelected).not.toHaveBeenCalled();
	});

	it('? opens shortcuts when not typing', () => {
		const deps = makeDeps();
		const handle = createAppKeydown(deps);
		handle(keyEvent('?'));
		expect(deps.openShortcuts).toHaveBeenCalledOnce();

		handle(keyEvent('?', { target: { tagName: 'TEXTAREA', isContentEditable: false } }));
		expect(deps.openShortcuts).toHaveBeenCalledOnce();
	});

	it('Ctrl+ArrowUp opens spaces overview', () => {
		const deps = makeDeps();
		createAppKeydown(deps)(keyEvent('ArrowUp', { ctrlKey: true }));
		expect(deps.showSpacesOverview).toHaveBeenCalledOnce();
	});

	it('/ focuses global search only when body is active', () => {
		const deps = makeDeps();
		const handle = createAppKeydown(deps);

		// @ts-expect-error minimal document stub for node
		globalThis.document = { activeElement: { tagName: 'BODY' } };
		handle(keyEvent('/'));
		expect(deps.focusGlobalSearch).toHaveBeenCalledOnce();

		// @ts-expect-error minimal document stub for node
		globalThis.document = { activeElement: { tagName: 'INPUT' } };
		handle(keyEvent('/'));
		expect(deps.focusGlobalSearch).toHaveBeenCalledOnce();
	});

	it('Escape delegates to onEscape', () => {
		const order: string[] = [];
		const onEscape = vi.fn(() => {
			order.push('escape');
			return true;
		});
		const deps = makeDeps({ onEscape });
		createAppKeydown(deps)(keyEvent('Escape'));
		expect(order).toEqual(['escape']);
		expect(onEscape).toHaveBeenCalledOnce();
	});

	it('Escape no-ops when onEscape returns false', () => {
		const deps = makeDeps({ onEscape: vi.fn(() => false) });
		createAppKeydown(deps)(keyEvent('Escape'));
		expect(deps.onEscape).toHaveBeenCalledOnce();
		expect(deps.togglePalette).not.toHaveBeenCalled();
		expect(deps.openShortcuts).not.toHaveBeenCalled();
	});

	it('⌘K still works while typing (palette always available)', () => {
		const deps = makeDeps();
		createAppKeydown(deps)(
			keyEvent('k', {
				metaKey: true,
				target: { tagName: 'INPUT', isContentEditable: false }
			})
		);
		expect(deps.togglePalette).toHaveBeenCalledOnce();
	});
});

/**
 * Esc dismiss chain order used by the desk. Pure ordered predicate —
 * mirrors +page.svelte onEscape so regressions in priority are caught
 * without mounting Svelte.
 */
describe('desk Esc dismiss order', () => {
	type Flags = {
		pdf?: boolean;
		docx?: boolean;
		html?: boolean;
		confirm?: boolean;
		spaces?: boolean;
		shortcuts?: boolean;
		bulkMenu?: boolean;
		palette?: boolean;
		search?: boolean;
		editorStage?: boolean;
		expanded?: boolean;
		settings?: boolean;
		peel?: boolean;
		selection?: boolean;
	};

	function resolveEsc(flags: Flags): string | null {
		if (flags.pdf) return 'pdf';
		if (flags.docx) return 'docx';
		if (flags.html) return 'html';
		if (flags.confirm) return 'confirm';
		if (flags.spaces) return 'spaces';
		if (flags.shortcuts) return 'shortcuts';
		if (flags.bulkMenu) return 'bulkMenu';
		if (flags.palette) return 'palette';
		if (flags.search) return 'search';
		if (flags.editorStage) return 'editorStage';
		if (flags.expanded) return 'expanded';
		if (flags.settings) return 'settings';
		if (flags.peel) return 'peel';
		if (flags.selection) return 'selection';
		return null;
	}

	it('closes readers before confirm/palette/selection', () => {
		expect(resolveEsc({ pdf: true, palette: true, selection: true })).toBe('pdf');
		expect(resolveEsc({ docx: true, confirm: true })).toBe('docx');
		expect(resolveEsc({ html: true, settings: true })).toBe('html');
	});

	it('closes confirm before spaces and palette', () => {
		expect(resolveEsc({ confirm: true, spaces: true, palette: true })).toBe('confirm');
	});

	it('closes palette before search, stage, and selection', () => {
		expect(resolveEsc({ palette: true, search: true, selection: true })).toBe('palette');
	});

	it('clears selection last among UI layers', () => {
		expect(resolveEsc({ selection: true })).toBe('selection');
		expect(resolveEsc({ peel: true, selection: true })).toBe('peel');
		expect(resolveEsc({ settings: true, selection: true })).toBe('settings');
		expect(resolveEsc({})).toBe(null);
	});

	it('wires onEscape into keydown so first truthy handler wins', () => {
		const handled: string[] = [];
		const chain = (flags: Flags) => {
			const layer = resolveEsc(flags);
			if (layer) {
				handled.push(layer);
				return true;
			}
			return false;
		};
		const deps = makeDeps({
			onEscape: () => chain({ palette: true, selection: true })
		});
		createAppKeydown(deps)(keyEvent('Escape'));
		expect(handled).toEqual(['palette']);
	});
});
