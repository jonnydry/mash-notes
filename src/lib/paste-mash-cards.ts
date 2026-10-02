import type { PasteCardDraft } from './paste-cards';

const MAX_MASH_PASTE_CARDS = 200;
/** Separator `combineNotes` writes between copied cards. */
const MASH_CARD_BREAK = '\n\n---\n\n';

/** One section of Mash's copied markdown: `# Title` or `# Title` plus a body. */
function parseMashCardSection(section: string): PasteCardDraft | null {
	if (!section.startsWith('# ')) return null;
	const newline = section.indexOf('\n');
	const title = (newline === -1 ? section.slice(2) : section.slice(2, newline)).trim();
	if (!title) return null;
	if (newline === -1) return { title: title.slice(0, 200), body: '' };
	if (section[newline + 1] !== '\n') return null;
	return { title: title.slice(0, 200), body: section.slice(newline + 2) };
}

function mashCardBreaksGone(text: string): boolean {
	if (text.includes(MASH_CARD_BREAK)) return false;
	const sections = text.split(/\n\n(?=# )/);
	if (sections.length < 2) return false;
	return sections.every((section) => parseMashCardSection(section) !== null);
}

export function readMashPaste(text: string): { cards: PasteCardDraft[]; cardBreaksGone: boolean } {
	if (text.includes(MASH_CARD_BREAK)) {
		const sections = text.split(MASH_CARD_BREAK);
		const cards = sections.map(parseMashCardSection);
		if (cards.every((card): card is PasteCardDraft => card !== null) && cards.length >= 2) {
			return { cards: cards.slice(0, MAX_MASH_PASTE_CARDS), cardBreaksGone: false };
		}
	}
	if (mashCardBreaksGone(text)) return { cards: [], cardBreaksGone: true };
	const one = parseMashCardSection(text);
	if (one) return { cards: [one], cardBreaksGone: false };
	return { cards: [], cardBreaksGone: false };
}
