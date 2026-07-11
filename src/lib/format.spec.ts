import { describe, it, expect } from 'vitest';
import { isBlankUntitledNote, notePreview } from './format';

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
