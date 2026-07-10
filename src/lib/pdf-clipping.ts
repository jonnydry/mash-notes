export type PdfNoteSource = {
	kind: 'pdf';
	title: string;
	page: number;
};

export type PdfClipping = {
	id: string;
	noteId: string;
	text: string;
	page: number;
};

export function isPdfFile(file: Pick<File, 'name' | 'type'>): boolean {
	return file.type.toLowerCase() === 'application/pdf' || /\.pdf$/i.test(file.name.trim());
}

export function normalizePdfExcerpt(text: string, maxLength = 12_000): string {
	return text.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

export function pdfClippingTitle(text: string): string {
	const clean = normalizePdfExcerpt(text, 200);
	if (!clean) return 'PDF excerpt';
	const sentence = clean.match(/^(.{1,72}?)(?:[.!?](?:\s|$)|$)/)?.[1] ?? clean.slice(0, 72);
	return sentence.trim().replace(/[,:;\s]+$/, '') || 'PDF excerpt';
}
