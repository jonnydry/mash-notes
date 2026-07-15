/**
 * Build note drafts + clipping list rows for PDF / Word / HTML reader saves.
 * Persistence (createNote, library) stays with the caller.
 */
import {
	docxClippingTitle,
	docxImageClippingAlt,
	docxImageClippingTitle,
	normalizeDocxExcerpt,
	normalizeDocxImageIndex,
	type DocxClipPayload,
	type DocxClipping
} from './docx-clipping';
import {
	htmlClippingTitle,
	normalizeHtmlExcerpt,
	type HtmlClipPayload,
	type HtmlClipping
} from './html-clipping';
import {
	normalizePdfExcerpt,
	pdfClippingTitle,
	pdfRegionClippingBody,
	pdfRegionClippingTitle,
	type PdfClipPayload,
	type PdfClipping
} from './pdf-clipping';
import type { Note } from './types';

export type ClipNoteDraft = {
	title: string;
	body: string;
	tags: string[];
	source: NonNullable<Note['source']>;
	toast: string;
	/** Optional list row for the reader clippings rail. */
	clipping: PdfClipping | DocxClipping | HtmlClipping;
};

export async function buildPdfClippingDraft(
	file: File,
	excerpt: PdfClipPayload
): Promise<ClipNoteDraft | null> {
	if (excerpt.imageDataUrl) {
		const title = pdfRegionClippingTitle(file.name, excerpt.page);
		const { putNoteBlobFromDataUrl, composeMashBlobSrc } = await import('./note-blobs');
		const blob = await putNoteBlobFromDataUrl(excerpt.imageDataUrl);
		const body = pdfRegionClippingBody(composeMashBlobSrc(blob.id), file.name, excerpt.page);
		return {
			title,
			body,
			tags: ['pdf-clipping'],
			source: { kind: 'pdf', title: file.name, page: excerpt.page },
			toast: `Saved region from page ${excerpt.page}`,
			clipping: {
				id: crypto.randomUUID(),
				noteId: '', // filled after create
				text: title,
				page: excerpt.page,
				imageDataUrl: excerpt.imageDataUrl
			}
		};
	}

	const text = normalizePdfExcerpt(excerpt.text ?? '');
	if (!text) return null;
	return {
		title: pdfClippingTitle(text),
		body: text,
		tags: ['pdf-clipping'],
		source: { kind: 'pdf', title: file.name, page: excerpt.page },
		toast: `Saved excerpt from page ${excerpt.page}`,
		clipping: {
			id: crypto.randomUUID(),
			noteId: '',
			text,
			page: excerpt.page
		}
	};
}

export async function buildDocxClippingDraft(
	file: File,
	excerpt: DocxClipPayload
): Promise<ClipNoteDraft | null> {
	if (excerpt.imageDataUrl) {
		const imageIndex = normalizeDocxImageIndex(excerpt.imageIndex);
		const title = docxImageClippingTitle(file.name, imageIndex);
		const imageAlt = docxImageClippingAlt(file.name, imageIndex, excerpt.imageAlt);
		const { putNoteBlobFromDataUrl, imageNoteBodyFromBlob } = await import('./note-blobs');
		const blob = await putNoteBlobFromDataUrl(excerpt.imageDataUrl);
		const sourceName = normalizeDocxExcerpt(file.name, 200) || 'Word document';
		return {
			title,
			body: imageNoteBodyFromBlob(blob.id, imageAlt, `_From ${sourceName}._`),
			tags: ['docx-clipping'],
			source: { kind: 'docx', title: file.name },
			toast: 'Saved image from Word document',
			clipping: {
				id: crypto.randomUUID(),
				noteId: '',
				text: title,
				imageDataUrl: excerpt.imageDataUrl,
				imageAlt,
				imageIndex
			}
		};
	}

	const text = normalizeDocxExcerpt(excerpt.text ?? '');
	if (!text) return null;
	return {
		title: docxClippingTitle(text),
		body: text,
		tags: ['docx-clipping'],
		source: { kind: 'docx', title: file.name },
		toast: 'Saved excerpt from Word document',
		clipping: {
			id: crypto.randomUUID(),
			noteId: '',
			text
		}
	};
}

export function buildHtmlClippingDraft(file: File, excerpt: HtmlClipPayload): ClipNoteDraft | null {
	const text = normalizeHtmlExcerpt(excerpt.text ?? '');
	if (!text) return null;
	return {
		title: htmlClippingTitle(text),
		body: text,
		tags: ['html-clipping'],
		source: { kind: 'html', title: file.name },
		toast: 'Saved excerpt from HTML document',
		clipping: {
			id: crypto.randomUUID(),
			noteId: '',
			text
		}
	};
}

export function withNoteId<T extends { noteId: string }>(clipping: T, noteId: string): T {
	return { ...clipping, noteId };
}
