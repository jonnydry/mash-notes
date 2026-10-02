import { describe, expect, it } from 'vitest';
import { combineNotes } from './mash';
import { pasteChoiceCopy } from './paste-choice-copy';
import { analyzePastedText, draftsFromPastedText, recognizePastedMashCards } from './paste-cards';
import type { Note } from './types';

function mashNote(id: string, title: string, body: string): Note {
	return {
		id,
		title,
		body,
		folder: '',
		tags: [],
		created: 1,
		modified: 1,
		pinned: 0
	};
}

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

	it('offers the cards that our own markdown copied', async () => {
		const markdown = combineNotes([mashNote('1', 'Alpha', 'one'), mashNote('2', 'Beta', 'two')]);
		const analysis = await recognizePastedMashCards(analyzePastedText(markdown));
		expect(analysis.cardBreaksGone).toBe(false);
		expect(analysis.suggestedMode).toBe('cards');
		expect(analysis.cards).toEqual([
			{ title: 'Alpha', body: 'one' },
			{ title: 'Beta', body: 'two' }
		]);
		const copy = pasteChoiceCopy(analysis);
		expect(copy.cardsLabel).toBe('2 cards: Alpha, Beta');
		expect(copy.cardBreaksNotice).toBeNull();
		expect(copy.linesLabel).toBe(`${analysis.lines.length} line cards`);
		expect(copy.paragraphsLabel).toBe(`${analysis.paragraphs.length} paragraph cards`);
	});

	it('offers one copied card when the markdown is a single Mash card', async () => {
		const markdown = combineNotes([mashNote('1', 'Hello', 'World')]);
		const analysis = await recognizePastedMashCards(analyzePastedText(markdown));
		expect(analysis.cards).toEqual([{ title: 'Hello', body: 'World' }]);
		expect(analysis.suggestedMode).toBe('cards');
		expect(pasteChoiceCopy(analysis).cardsLabel).toBe('1 card: Hello');
		expect(pasteChoiceCopy(analysis).cardBreaksNotice).toBeNull();
	});

	it('says the card breaks are gone and counts lines and paragraphs, not cards', async () => {
		const markdown = combineNotes([mashNote('1', 'Alpha', 'one'), mashNote('2', 'Beta', 'two')]);
		const stripped = markdown.replaceAll('\n\n---\n\n', '\n\n');
		const analysis = await recognizePastedMashCards(analyzePastedText(stripped));
		expect(analysis.cards).toEqual([]);
		expect(analysis.cardBreaksGone).toBe(true);
		expect(analysis.suggestedMode).not.toBe('cards');
		const copy = pasteChoiceCopy(analysis);
		expect(copy.cardsLabel).toBeNull();
		expect(copy.cardBreaksNotice).toBe('The card breaks are gone.');
		expect(copy.linesLabel).toBe(`${analysis.lines.length} lines`);
		expect(copy.paragraphsLabel).toBe(`${analysis.paragraphs.length} paragraphs`);
		expect(copy.linesLabel.toLowerCase()).not.toContain('card');
		expect(copy.paragraphsLabel.toLowerCase()).not.toContain('card');
		expect(copy.linesLabel).not.toBe(`${analysis.lines.length} line cards`);
		expect(copy.paragraphsLabel).not.toBe(`${analysis.paragraphs.length} paragraph cards`);
	});

	it('keeps line and paragraph card wording for ordinary paste', () => {
		const analysis = analyzePastedText('- Alpha\n- Beta\n- Gamma');
		expect(analysis.cardBreaksGone).toBe(false);
		expect(analysis.cards).toEqual([]);
		const copy = pasteChoiceCopy(analysis);
		expect(copy.cardsLabel).toBeNull();
		expect(copy.cardBreaksNotice).toBeNull();
		expect(copy.linesLabel).toBe('3 line cards');
		expect(copy.paragraphsLabel).toBe('1 paragraph cards');
	});

	it('does not say the card breaks are gone for two ordinary headings that were never Mash cards', async () => {
		const ordinaryHeadings = [
			'# First heading\nA paragraph.\n\n# Second heading\nAnother paragraph.',
			'# First heading\n\nA paragraph.\n\n\n# Second heading\n\nAnother paragraph.',
			'#  First heading\n\nA paragraph.\n\n#  Second heading\n\nAnother paragraph.',
			'# First heading \n\nA paragraph.\n\n# Second heading \n\nAnother paragraph.',
			'# First heading\n\nA paragraph.\n\n## Second heading\n\nAnother paragraph.'
		];
		for (const markdown of ordinaryHeadings) {
			const analysis = await recognizePastedMashCards(analyzePastedText(markdown));
			const copy = pasteChoiceCopy(analysis);
			expect(copy.cardBreaksNotice).not.toBe('The card breaks are gone.');
			expect(copy.cardBreaksNotice).toBeNull();
			expect(analysis.cardBreaksGone).toBe(false);
			expect(copy.linesLabel).toBe(`${analysis.lines.length} line cards`);
			expect(copy.paragraphsLabel).toBe(`${analysis.paragraphs.length} paragraph cards`);
		}
	});
});
