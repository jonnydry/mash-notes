import { describe, expect, it } from 'vitest';
import { KEYBOARD_SHORTCUT_GROUPS, flatShortcutRows } from './keyboard-shortcuts';

describe('keyboard-shortcuts catalog', () => {
	it('has grouped rows with keys and labels', () => {
		expect(KEYBOARD_SHORTCUT_GROUPS.length).toBeGreaterThan(0);
		for (const group of KEYBOARD_SHORTCUT_GROUPS) {
			expect(group.id).toBeTruthy();
			expect(group.title).toBeTruthy();
			expect(group.rows.length).toBeGreaterThan(0);
			for (const row of group.rows) {
				expect(row.keys).toBeTruthy();
				expect(row.label).toBeTruthy();
			}
		}
	});

	it('flattens groups for Settings preview', () => {
		const flat = flatShortcutRows();
		expect(flat.length).toBe(KEYBOARD_SHORTCUT_GROUPS.reduce((n, g) => n + g.rows.length, 0));
		expect(flat.some((r) => r.keys === '?')).toBe(true);
	});

	it('has unique group ids', () => {
		expect(new Set(KEYBOARD_SHORTCUT_GROUPS.map((g) => g.id)).size).toBe(
			KEYBOARD_SHORTCUT_GROUPS.length
		);
	});

	it('flattens custom catalogs without the defaults', () => {
		expect(
			flatShortcutRows([{ id: 'x', title: 'X', rows: [{ keys: 'A', label: 'Alpha' }] }])
		).toEqual([{ keys: 'A', label: 'Alpha' }]);
	});
});
