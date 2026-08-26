import { describe, expect, it } from 'vitest';
import { isNavActive } from './note-ui';

describe('isNavActive', () => {
	it('({ type: null }, "all") is true', () => {
		expect(isNavActive({ type: null }, 'all')).toBe(true);
	});

	it('({ type: "pinned" }, "all") is false', () => {
		expect(isNavActive({ type: 'pinned' }, 'all')).toBe(false);
	});

	it('({ type: "pinned" }, "pinned") is true', () => {
		expect(isNavActive({ type: 'pinned' }, 'pinned')).toBe(true);
	});

	it('({ type: "folder", value: "Ideas" }, "folder", "Ideas") is true', () => {
		expect(isNavActive({ type: 'folder', value: 'Ideas' }, 'folder', 'Ideas')).toBe(true);
	});

	it('({ type: "folder", value: "Ideas" }, "folder", "Work") is false', () => {
		expect(isNavActive({ type: 'folder', value: 'Ideas' }, 'folder', 'Work')).toBe(false);
	});

	it('({ type: "folder", value: "" }, "folder") is true (value ?? "")', () => {
		expect(isNavActive({ type: 'folder', value: '' }, 'folder')).toBe(true);
	});

	it('({ type: "tag", value: "x" }, "tag", "x") is true', () => {
		expect(isNavActive({ type: 'tag', value: 'x' }, 'tag', 'x')).toBe(true);
	});

	it('({ type: "tag", value: "x" }, "tag", "y") is false', () => {
		expect(isNavActive({ type: 'tag', value: 'x' }, 'tag', 'y')).toBe(false);
	});

	it('({ type: "tag", value: "" }, "tag") is false (compares to raw omitted undefined)', () => {
		expect(isNavActive({ type: 'tag', value: '' }, 'tag')).toBe(false);
	});
});
