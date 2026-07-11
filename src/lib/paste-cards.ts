export type PasteSplitMode = 'single' | 'lines' | 'paragraphs';

export type PasteCardDraft = {
	title: string;
	body: string;
};

export type PasteAnalysis = {
	text: string;
	lines: string[];
	paragraphs: string[];
	suggestedMode: PasteSplitMode;
};

const MAX_PASTE_TEXT = 500_000;
const MAX_PASTE_CARDS = 200;

function cleanTitle(value: string): string {
	return (
		value
			.trim()
			.replace(/^#{1,6}\s+/, '')
			.replace(/^(?:[-*•]|\d+[.)])\s+/, '')
			.trim()
			.slice(0, 200) || 'Pasted note'
	);
}

export function analyzePastedText(raw: string): PasteAnalysis {
	const text = raw.replace(/\r\n?/g, '\n').trim().slice(0, MAX_PASTE_TEXT);
	const lines = text
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean)
		.slice(0, MAX_PASTE_CARDS);
	const paragraphs = text
		.split(/\n\s*\n+/)
		.map((paragraph) => paragraph.trim())
		.filter(Boolean)
		.slice(0, MAX_PASTE_CARDS);
	const hasParagraphBreaks = /\n\s*\n/.test(text);
	const listLike = lines.length > 1 && lines.every((line) => /^(?:[-*•]|\d+[.)])\s+/.test(line));
	const suggestedMode: PasteSplitMode = hasParagraphBreaks
		? 'paragraphs'
		: listLike || lines.length > 1
			? 'lines'
			: 'single';
	return { text, lines, paragraphs, suggestedMode };
}

export function draftsFromPastedText(raw: string, mode: PasteSplitMode): PasteCardDraft[] {
	const analysis = analyzePastedText(raw);
	if (!analysis.text) return [];

	if (mode === 'single') {
		return [
			{
				title: cleanTitle(analysis.lines[0] ?? analysis.text),
				body: analysis.lines.length > 1 ? analysis.text : ''
			}
		];
	}

	const chunks = mode === 'lines' ? analysis.lines : analysis.paragraphs;
	return chunks.map((chunk) => {
		const chunkLines = chunk
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean);
		return {
			title: cleanTitle(chunkLines[0] ?? chunk),
			body: chunkLines.length > 1 ? chunk : ''
		};
	});
}
