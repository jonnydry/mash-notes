/**
 * Global keyboard shortcuts for the desk (⌘K, ⌘N, ⌘M, Esc stack, etc.).
 */
export type AppKeyboardDeps = {
	canvasUndo: () => void | Promise<void>;
	canvasRedo: () => void | Promise<void>;
	togglePalette: () => void;
	handleNewNote: () => void | Promise<void>;
	startTypingNote: (initialTitle: string) => void | Promise<void>;
	canStartTypingNote: () => boolean;
	invokeCombineSelection: () => void | Promise<void>;
	getSelectionCount: () => number;
	getSelectedId: () => string | null;
	getSelectedNote: () => { id: string; pinned?: 0 | 1 } | null | undefined;
	togglePinSelected: (noteId: string, pinned: 0 | 1) => void;
	openShortcuts: () => void;
	showSpacesOverview: () => void;
	focusGlobalSearch: () => void;
	/** Esc dismiss chain — return true if handled. */
	onEscape: () => boolean;
};

function isTypingTarget(target: EventTarget | null): boolean {
	const el = target as HTMLElement | null;
	if (!el) return false;
	const tag = el.tagName;
	if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
	return Boolean(el.isContentEditable);
}

export function createAppKeydown(deps: AppKeyboardDeps) {
	return function handleKeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
			if (!isTypingTarget(e.target)) {
				e.preventDefault();
				if (e.shiftKey) void deps.canvasRedo();
				else void deps.canvasUndo();
				return;
			}
		}
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			deps.togglePalette();
		}
		if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
			e.preventDefault();
			void deps.handleNewNote();
		}
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'm') {
			if (!isTypingTarget(e.target) && deps.getSelectionCount() >= 2) {
				e.preventDefault();
				void deps.invokeCombineSelection();
			}
		}
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p') {
			if (!isTypingTarget(e.target) && deps.getSelectedId()) {
				e.preventDefault();
				const note = deps.getSelectedNote();
				if (note) {
					const np = note.pinned === 1 ? 0 : 1;
					deps.togglePinSelected(note.id, np as 0 | 1);
				}
			}
		}
		if (e.key === '?') {
			if (!isTypingTarget(e.target)) {
				e.preventDefault();
				deps.openShortcuts();
			}
		}
		if (e.ctrlKey && e.key === 'ArrowUp') {
			if (!isTypingTarget(e.target)) {
				e.preventDefault();
				deps.showSpacesOverview();
			}
		}
		if (e.key === '/' && document.activeElement?.tagName === 'BODY') {
			e.preventDefault();
			deps.focusGlobalSearch();
		}
		if (
			e.key.length === 1 &&
			/\S/u.test(e.key) &&
			!e.repeat &&
			!e.isComposing &&
			e.key !== '?' &&
			e.key !== '/' &&
			!e.metaKey &&
			!e.ctrlKey &&
			!e.altKey &&
			!isTypingTarget(e.target) &&
			document.activeElement?.tagName === 'BODY' &&
			deps.canStartTypingNote()
		) {
			e.preventDefault();
			void deps.startTypingNote(e.key);
			return;
		}
		if (e.key === 'Escape') {
			if (deps.onEscape()) return;
		}
	};
}
