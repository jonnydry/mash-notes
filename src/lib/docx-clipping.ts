export type DocxClipping = {
	id: string;
	noteId: string;
	text: string;
};

export type DocxClipPayload = {
	text: string;
};

export function normalizeDocxExcerpt(text: string, maxLength = 12_000): string {
	return text.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

export function docxClippingTitle(text: string): string {
	const clean = normalizeDocxExcerpt(text, 200);
	if (!clean) return 'Word excerpt';
	const sentence = clean.match(/^(.{1,72}?)(?:[.!?](?:\s|$)|$)/)?.[1] ?? clean.slice(0, 72);
	return sentence.trim().replace(/[,:;\s]+$/, '') || 'Word excerpt';
}
