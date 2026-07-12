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
	/** PNG data URL when this clipping is a region crop instead of selected text. */
	imageDataUrl?: string;
};

export type PdfClipPayload = {
	page: number;
	text?: string;
	imageDataUrl?: string;
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

export function pdfRegionClippingTitle(fileName: string, page: number): string {
	const base = fileName.replace(/\.pdf$/i, '').trim() || 'PDF';
	return `${base} · p. ${page}`;
}

export function pdfRegionClippingBody(imageSrc: string, fileName: string, page: number): string {
	const safeName = fileName.trim() || 'PDF';
	return `![PDF clipping from page ${page}](${imageSrc})\n\n_From ${safeName}, page ${page}._`;
}

export type CssRect = { x: number; y: number; w: number; h: number };

/** Normalize a drag from (x0,y0)→(x1,y1) into a positive rect clipped to the page. */
export function normalizeRegionRect(
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	pageWidth: number,
	pageHeight: number
): CssRect {
	const left = Math.max(0, Math.min(x0, x1));
	const top = Math.max(0, Math.min(y0, y1));
	const right = Math.min(pageWidth, Math.max(x0, x1));
	const bottom = Math.min(pageHeight, Math.max(y0, y1));
	return {
		x: left,
		y: top,
		w: Math.max(0, right - left),
		h: Math.max(0, bottom - top)
	};
}

/**
 * Crop a CSS-space region from the rendered PDF canvas into a PNG data URL.
 * Accounts for device-pixel backing store vs CSS display size.
 */
export function cropPdfCanvasRegion(
	canvas: HTMLCanvasElement,
	region: CssRect,
	pageCssWidth: number,
	pageCssHeight: number
): string | null {
	if (region.w < 4 || region.h < 4) return null;
	if (pageCssWidth <= 0 || pageCssHeight <= 0) return null;
	const scaleX = canvas.width / pageCssWidth;
	const scaleY = canvas.height / pageCssHeight;
	const sx = Math.max(0, Math.floor(region.x * scaleX));
	const sy = Math.max(0, Math.floor(region.y * scaleY));
	const sw = Math.max(1, Math.min(canvas.width - sx, Math.ceil(region.w * scaleX)));
	const sh = Math.max(1, Math.min(canvas.height - sy, Math.ceil(region.h * scaleY)));
	if (sw < 1 || sh < 1) return null;

	const out = document.createElement('canvas');
	out.width = sw;
	out.height = sh;
	const ctx = out.getContext('2d');
	if (!ctx) return null;
	ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
	try {
		return out.toDataURL('image/png');
	} catch {
		return null;
	}
}
