/**
 * Sequence → PDF — each note starts on its own page; long notes continue.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { Note } from './types';
import { slugifyFilename } from './mash';

const PAGE_W = 612; // US Letter
const PAGE_H = 792;
const MARGIN = 54;
const TITLE_SIZE = 22;
const BODY_SIZE = 11;
const META_SIZE = 9;
const TITLE_LEADING = 28;
const BODY_LEADING = 16;
const META_LEADING = 12;

/** Strip markdown-ish syntax into readable plain lines for PDF layout. */
export function noteBodyForPdf(body: string): string {
	return sanitizePdfText(
		body
			.replace(/\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/g, (_m, target, label) =>
				String(label ?? target).trim()
			)
			.replace(/^#{1,6}\s+/gm, '')
			.replace(/(\*\*|__)(.*?)\1/g, '$2')
			.replace(/(\*|_)(.*?)\1/g, '$2')
			.replace(/`([^`]+)`/g, '$1')
			.replace(/^\s*[-*+]\s+/gm, '- ')
			.replace(/^\s*\d+\.\s+/gm, (m) => m.trimStart())
			.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
			.replace(/\r\n/g, '\n')
			.trimEnd()
	);
}

/**
 * Helvetica/WinAnsi can't encode emoji, CJK, etc. Replace unsupported
 * codepoints so measure/draw never throw.
 */
export function sanitizePdfText(text: string): string {
	let out = '';
	for (const ch of text) {
		const code = ch.codePointAt(0) ?? 0;
		if (code === 0x09 || code === 0x0a || code === 0x0d) {
			out += ch;
			continue;
		}
		// ASCII printable
		if (code >= 0x20 && code <= 0x7e) {
			out += ch;
			continue;
		}
		// Latin-1 supplement (WinAnsi covers most of these)
		if (code >= 0xa0 && code <= 0xff) {
			out += ch;
			continue;
		}
		out += '?';
	}
	return out;
}

function wrapLine(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
	if (!text) return [''];
	const words = text.split(/\s+/).filter(Boolean);
	if (words.length === 0) return [''];
	const lines: string[] = [];
	let current = words[0];
	for (let i = 1; i < words.length; i++) {
		const word = words[i];
		const candidate = `${current} ${word}`;
		if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
			current = candidate;
		} else {
			lines.push(current);
			current = word;
			// Hard-break oversized tokens
			while (font.widthOfTextAtSize(current, size) > maxWidth && current.length > 1) {
				let cut = current.length - 1;
				while (cut > 1 && font.widthOfTextAtSize(current.slice(0, cut), size) > maxWidth) {
					cut -= 1;
				}
				lines.push(current.slice(0, cut));
				current = current.slice(cut);
			}
		}
	}
	lines.push(current);
	return lines;
}

function wrapParagraph(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
	const paragraphs = text.split('\n');
	const out: string[] = [];
	for (const para of paragraphs) {
		if (para.trim() === '') {
			out.push('');
			continue;
		}
		out.push(...wrapLine(para, font, size, maxWidth));
	}
	return out;
}

function alignedX(
	text: string,
	font: PDFFont,
	size: number,
	align: 'left' | 'center' | 'right',
	maxWidth: number
): number {
	if (align === 'left') return MARGIN;
	const width = font.widthOfTextAtSize(text, size);
	if (align === 'center') return MARGIN + Math.max(0, (maxWidth - width) / 2);
	return MARGIN + Math.max(0, maxWidth - width);
}

function drawTextLines(
	page: PDFPage,
	lines: string[],
	opts: {
		font: PDFFont;
		size: number;
		leading: number;
		startY: number;
		minY: number;
		color: ReturnType<typeof rgb>;
		align?: 'left' | 'center' | 'right';
		maxWidth?: number;
	}
): number {
	let y = opts.startY;
	const align = opts.align ?? 'left';
	const maxWidth = opts.maxWidth ?? PAGE_W - MARGIN * 2;
	for (const line of lines) {
		if (y < opts.minY) break;
		if (line !== '') {
			page.drawText(line, {
				x: alignedX(line, opts.font, opts.size, align, maxWidth),
				y,
				size: opts.size,
				font: opts.font,
				color: opts.color
			});
		}
		y -= opts.leading;
	}
	return y;
}

type DrawCtx = {
	pdf: PDFDocument;
	font: PDFFont;
	fontBold: PDFFont;
	maxWidth: number;
	ink: ReturnType<typeof rgb>;
	muted: ReturnType<typeof rgb>;
};

function newContentPage(ctx: DrawCtx): { page: PDFPage; y: number } {
	const page = ctx.pdf.addPage([PAGE_W, PAGE_H]);
	const y = PAGE_H - MARGIN;
	return { page, y };
}

function drawNoteMeta(
	page: PDFPage,
	ctx: DrawCtx,
	label: string,
	y: number
): number {
	page.drawText(label, {
		x: MARGIN,
		y: y - META_SIZE,
		size: META_SIZE,
		font: ctx.font,
		color: ctx.muted
	});
	return y - META_LEADING - 8;
}

/**
 * Build a PDF document from a page sequence.
 * Each note starts on a fresh page. Notes that fit stay on one page;
 * longer notes continue onto following pages until the body is done.
 */
export async function buildSequencePdf(
	notes: Note[],
	docTitle = 'Page sequence'
): Promise<Uint8Array> {
	const pdf = await PDFDocument.create();
	pdf.setTitle(docTitle);
	pdf.setProducer('Mash');
	pdf.setCreator('Mash');

	const font = await pdf.embedFont(StandardFonts.Helvetica);
	const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
	const ctx: DrawCtx = {
		pdf,
		font,
		fontBold,
		maxWidth: PAGE_W - MARGIN * 2,
		ink: rgb(0.1, 0.1, 0.1),
		muted: rgb(0.4, 0.4, 0.4)
	};

	if (notes.length === 0) {
		const { page } = newContentPage(ctx);
		page.drawText('Empty sequence', {
			x: MARGIN,
			y: PAGE_H - MARGIN - TITLE_SIZE,
			size: TITLE_SIZE,
			font: fontBold,
			color: ctx.ink
		});
	} else {
		for (let i = 0; i < notes.length; i++) {
			const note = notes[i];
			const title = sanitizePdfText(note.title.trim() || 'Untitled');
			const noteLabel = `Note ${i + 1} of ${notes.length}`;
			const align =
				note.textAlign === 'center' || note.textAlign === 'right' ? note.textAlign : 'left';
			let { page, y } = newContentPage(ctx);

			y = drawNoteMeta(page, ctx, noteLabel, y);

			const titleLines = wrapParagraph(title, fontBold, TITLE_SIZE, ctx.maxWidth);
			y = drawTextLines(page, titleLines, {
				font: fontBold,
				size: TITLE_SIZE,
				leading: TITLE_LEADING,
				startY: y - TITLE_SIZE,
				minY: MARGIN,
				color: ctx.ink,
				align,
				maxWidth: ctx.maxWidth
			});
			y -= 12;

			const body = noteBodyForPdf(note.body);
			if (!body.trim()) continue;

			const bodyLines = wrapParagraph(body, font, BODY_SIZE, ctx.maxWidth);
			const minY = MARGIN + BODY_LEADING;
			let lineIdx = 0;

			while (lineIdx < bodyLines.length) {
				if (y < minY) {
					({ page, y } = newContentPage(ctx));
					y = drawNoteMeta(page, ctx, `${noteLabel} · continued`, y);
					const contTitle = wrapParagraph(
						`${title} (cont.)`,
						fontBold,
						BODY_SIZE + 2,
						ctx.maxWidth
					);
					y = drawTextLines(page, contTitle, {
						font: fontBold,
						size: BODY_SIZE + 2,
						leading: BODY_LEADING + 2,
						startY: y - (BODY_SIZE + 2),
						minY: MARGIN,
						color: ctx.ink,
						align,
						maxWidth: ctx.maxWidth
					});
					y -= 10;
				}

				const line = bodyLines[lineIdx];
				if (line !== '') {
					page.drawText(line, {
						x: alignedX(line, font, BODY_SIZE, align, ctx.maxWidth),
						y,
						size: BODY_SIZE,
						font,
						color: ctx.ink
					});
				}
				y -= BODY_LEADING;
				lineIdx += 1;
			}
		}
	}

	return pdf.save();
}

/** Download bytes as a file in the browser. No-op outside the browser. */
export function downloadBytes(data: Uint8Array, filename: string, mimeType: string): void {
	if (typeof document === 'undefined') return;
	// Copy into a fresh ArrayBuffer-backed view — pdf-lib's Uint8Array
	// typing can be ArrayBufferLike, which BlobPart rejects under strict DOM libs.
	const copy = new Uint8Array(data.byteLength);
	copy.set(data);
	const blob = new Blob([copy], { type: mimeType });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Build and download a sequence PDF (each note starts on a fresh page).
 * Returns false if there is nothing to export.
 */
export async function exportSequencePdf(
	notes: Note[],
	docTitle?: string,
	filename?: string
): Promise<boolean> {
	if (notes.length === 0) return false;
	const title =
		docTitle ??
		(notes.length === 1
			? notes[0].title.trim() || 'Untitled'
			: `Sequence · ${notes.length} pages`);
	const bytes = await buildSequencePdf(notes, title);
	const name = filename ?? `${slugifyFilename(title, 'sequence')}.pdf`;
	downloadBytes(bytes, name, 'application/pdf');
	return true;
}
