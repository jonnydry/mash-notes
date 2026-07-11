import { describe, expect, it } from 'vitest';
import { analyzePastedText, draftsFromPastedText } from './paste-cards';

describe('pasted text cards', () => {
	it('captures a single line as one titled card', () => {
		expect(draftsFromPastedText('A quick thought', 'single')).toEqual([
			{ title: 'A quick thought', body: '' }
		]);
	});

	it('splits and cleans bullet lines', () => {
		expect(draftsFromPastedText('- Alpha\n- Beta\n3. Gamma', 'lines')).toEqual([
			{ title: 'Alpha', body: '' },
			{ title: 'Beta', body: '' },
			{ title: 'Gamma', body: '' }
		]);
	});

	it('preserves multiline paragraphs as card bodies', () => {
		const drafts = draftsFromPastedText(
			'First idea\nwith context\n\nSecond idea\nmore detail',
			'paragraphs'
		);
		expect(drafts).toHaveLength(2);
		expect(drafts[0]).toEqual({ title: 'First idea', body: 'First idea\nwith context' });
	});

	it('suggests paragraph and list splits from structure', () => {
		expect(analyzePastedText('One\n\nTwo').suggestedMode).toBe('paragraphs');
		expect(analyzePastedText('- One\n- Two').suggestedMode).toBe('lines');
		expect(analyzePastedText('One').suggestedMode).toBe('single');
	});

	it('caps bulk paste at 200 cards', () => {
		const text = Array.from({ length: 300 }, (_, index) => `Item ${index}`).join('\n');
		expect(draftsFromPastedText(text, 'lines')).toHaveLength(200);
	});
});
