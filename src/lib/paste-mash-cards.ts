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

/** True when `section` is exactly one card as `combineNotes` writes it. */
function isEmittedMashSection(section: string): boolean {
	if (!section.startsWith('# ')) return false;
	const newline = section.indexOf('\n');
	const title = (newline === -1 ? section.slice(2) : section.slice(2, newline)).trim();
	if (!title) return false;
	const titleLine = newline === -1 ? section : section.slice(0, newline);
	if (titleLine !== `# ${title}`) return false;
	if (newline !== -1 && section[newline + 1] !== '\n') return false;
	const body = newline === -1 ? '' : section.slice(newline + 2).trimEnd();
	const emitted = body ? `# ${title}\n\n${body}` : `# ${title}`;
	return emitted === section;
}

function h1Sections(text: string): string[] {
	return text.split(/\n\n(?=# )/);
}

function mashCardBreaksGone(text: string): boolean {
	if (text.includes(MASH_CARD_BREAK)) return false;
	const sections = h1Sections(text);
	if (sections.length < 2) return false;
	return sections.every((section) => isEmittedMashSection(section));
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
	// Heading blocks that are not Mash's own cards. Do not offer them as one
	// copied card, and do not say the card breaks are gone.
	const sections = h1Sections(text);
	if (sections.length >= 2 && sections.every((section) => parseMashCardSection(section) !== null)) {
		return { cards: [], cardBreaksGone: false };
	}
	const one = parseMashCardSection(text);
	if (one) return { cards: [one], cardBreaksGone: false };
	return { cards: [], cardBreaksGone: false };
}
