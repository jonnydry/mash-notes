export type DocxClipping = {
	id: string;
	noteId: string;
	text: string;
	/** Local data URL retained while the reader is open so the clippings rail can show a thumbnail. */
	imageDataUrl?: string;
	imageAlt?: string;
	imageIndex?: number;
};

export type DocxClipPayload = {
	text?: string;
	imageDataUrl?: string;
	imageAlt?: string;
	imageIndex?: number;
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

function docxBaseName(fileName: string): string {
	return (
		fileName
			.trim()
			.replace(/^.*[/\\]/, '')
			.replace(/\.docx$/i, '')
			.trim() || 'Word document'
	);
}

export function normalizeDocxImageIndex(imageIndex: number | undefined): number {
	if (imageIndex == null || !Number.isFinite(imageIndex)) return 1;
	return Math.max(1, Math.floor(imageIndex));
}

export function docxImageClippingTitle(fileName: string, imageIndex = 1): string {
	const index = normalizeDocxImageIndex(imageIndex);
	return `${docxBaseName(fileName)} · image ${index}`;
}

export function docxImageClippingAlt(fileName: string, imageIndex = 1, providedAlt = ''): string {
	// Keep the alt safe inside Markdown's ![alt](src) syntax.
	const clean = normalizeDocxExcerpt(providedAlt, 160).replace(/[[\]]/g, '').trim();
	if (clean) return clean;
	const index = normalizeDocxImageIndex(imageIndex);
	return `Image ${index} from ${docxBaseName(fileName)}`;
}
