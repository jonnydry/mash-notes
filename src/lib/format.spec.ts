import { describe, it, expect } from 'vitest';
import { formatNoteTimestamp, isBlankUntitledNote, notePreview } from './format';

/** Minutes before `now`, in ms. */
function minutesAgo(minutes: number, now: number): number {
	return now - minutes * 60_000;
}

describe('formatNoteTimestamp', () => {
	it('shows "now" within the last minute', () => {
		const now = Date.now();
		expect(formatNoteTimestamp(now - 50_000, now)).toBe('now');
		expect(formatNoteTimestamp(now - 55_000, now)).toBe('now');
	});

	it('shows relative minutes under an hour', () => {
		const now = Date.now();
		const s = formatNoteTimestamp(minutesAgo(5, now), now);
		expect(s).toContain('minute');
		expect(s).toContain('ago');
	});

	it('shows relative hours under a day', () => {
		const now = Date.now();
		const s = formatNoteTimestamp(minutesAgo(3 * 60, now), now);
		expect(s).toContain('hour');
		expect(s).toContain('ago');
	});

	it('shows relative days under a week', () => {
		const now = Date.now();
		const s = formatNoteTimestamp(minutesAgo(2 * 24 * 60, now), now);
		expect(s).toContain('day');
		expect(s).toContain('ago');
	});

	it('falls back to a date string beyond a week', () => {
		const now = Date.now();
		const s = formatNoteTimestamp(minutesAgo(10 * 24 * 60, now), now);
		expect(s).not.toContain('ago');
		expect(s).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/);
	});
});

describe('format', () => {
	it('previews note bodies', () => {
		expect(notePreview('')).toBe('No content yet…');
		expect(notePreview('hello world')).toBe('hello world');
		expect(
			notePreview('![PDF clipping from page 3](data:image/png;base64,abc)\n\n_From Scales.pdf_')
		).toBe('_From Scales.pdf_');
		expect(notePreview('![Chart](data:image/png;base64,abc)')).toBe('Chart');
	});

	it('detects blank Untitled scratch notes', () => {
		expect(isBlankUntitledNote({ title: 'Untitled', body: '' })).toBe(true);
		expect(isBlankUntitledNote({ title: '  ', body: '  ' })).toBe(true);
		expect(isBlankUntitledNote({ title: 'Untitled', body: 'hi' })).toBe(false);
		expect(isBlankUntitledNote({ title: 'Ideas', body: '' })).toBe(false);
		expect(isBlankUntitledNote({ title: 'Untitled', body: '', tags: ['x'] })).toBe(false);
		expect(isBlankUntitledNote({ title: 'Untitled', body: '', mashedFrom: ['a'] })).toBe(false);
		expect(isBlankUntitledNote({ title: 'Untitled', body: '', pinned: 1 })).toBe(false);
	});
});
