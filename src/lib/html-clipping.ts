export type HtmlClipping = {
	id: string;
	noteId: string;
	text: string;
};

export type HtmlClipPayload = {
	text: string;
};

export function normalizeHtmlExcerpt(text: string, maxLength = 12_000): string {
	return text.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

export function htmlClippingTitle(text: string): string {
	const clean = normalizeHtmlExcerpt(text, 200);
	if (!clean) return 'HTML excerpt';
	const sentence = clean.match(/^(.{1,72}?)(?:[.!?](?:\s|$)|$)/)?.[1] ?? clean.slice(0, 72);
	return sentence.trim().replace(/[,:;\s]+$/, '') || 'HTML excerpt';
}
