/**
 * Canonical keyboard shortcut catalog for the shortcuts modal + Settings.
 * Keys use ⌘ for Mac-style display; Windows/Linux users still press Ctrl.
 */

export type ShortcutRow = {
	keys: string;
	label: string;
};

export type ShortcutGroup = {
	id: string;
	title: string;
	rows: ShortcutRow[];
};

export const KEYBOARD_SHORTCUT_GROUPS: ShortcutGroup[] = [
	{
		id: 'general',
		title: 'General',
		rows: [
			{ keys: '⌘K', label: 'Command palette' },
			{ keys: '⌘N', label: 'New note' },
			{ keys: '⌃↑', label: 'Open desks (Screenplay / folder boards)' },
			{ keys: '/', label: 'Focus header search' },
			{ keys: '?', label: 'Keyboard shortcuts' },
			{ keys: 'Esc', label: 'Dismiss overlay, peel, or selection' }
		]
	},
	{
		id: 'notes',
		title: 'Notes & selection',
		rows: [
			{ keys: '⌘M', label: 'Mash selected notes' },
			{ keys: '⌘P', label: 'Toggle pin (selected note)' },
			{ keys: '⌘A', label: 'Select all notes on the desk' },
			{ keys: 'Shift / ⌘ click', label: 'Add to selection' },
			{ keys: 'Drag empty board', label: 'Marquee select' }
		]
	},
	{
		id: 'board',
		title: 'Desk & canvas',
		rows: [
			{ keys: '⌘Z', label: 'Undo layout (on board) / typing (in sticky)' },
			{ keys: '⌘⇧Z', label: 'Redo layout' },
			{ keys: 'Space + drag', label: 'Pan the desk' },
			{ keys: '⌘ / Ctrl + scroll', label: 'Zoom toward cursor' },
			{ keys: '⌘+ / ⌘−', label: 'Zoom from the center' },
			{ keys: '⌘1', label: 'Fit all cards' },
			{ keys: '⌘0', label: 'Reset pan & zoom' },
			{ keys: 'Arrow keys', label: 'Nudge selection' },
			{ keys: 'Shift + arrows', label: 'Nudge selection farther' },
			{ keys: 'Enter', label: 'Open focused / selected card in large editor' },
			{ keys: 'Alt + drag', label: 'Temporarily invert Snap' },
			{ keys: 'Free / Snap', label: 'Placement preference (Snap = grid only)' },
			{ keys: 'Organize', label: 'Snap all cards and clear overlaps' },
			{ keys: 'Sequence', label: 'Link pages in order (click last → next)' },
			{ keys: 'Drag to screen edge', label: 'Open note in half / full editor' }
		]
	},
	{
		id: 'peel',
		title: 'Peel scanner',
		rows: [
			{ keys: 'Enter', label: 'Open highlighted / focused note' },
			{ keys: 'Space', label: 'Select note in list' },
			{ keys: 'Drag handle', label: 'Drop note onto the desk' }
		]
	}
];

export function flatShortcutRows(
	groups: ShortcutGroup[] = KEYBOARD_SHORTCUT_GROUPS
): ShortcutRow[] {
	return groups.flatMap((g) => g.rows);
}
