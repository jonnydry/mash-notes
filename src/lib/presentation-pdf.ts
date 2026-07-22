import fontkit from '@pdf-lib/fontkit';
import liberationSansRegularUrl from 'pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf?url';
import liberationSansBoldUrl from 'pdfjs-dist/standard_fonts/LiberationSans-Bold.ttf?url';
import {
	PDFDocument,
	StandardFonts,
	rgb,
	type PDFFont,
	type PDFImage,
	type PDFPage,
	type RGB
} from 'pdf-lib';
import type {
	ExportDocument,
	ExportDocumentSection,
	PresentationExportOptions
} from './export-document';
import { exportDocumentWordCount, exportNodeText } from './export-document';
import { EXPORT_PAGE_SIZES, exportTemplate, type ExportTemplate } from './export-templates';
import type { MarkdownNode } from './markdown-nodes';
import { decodeDataUrlImage } from './sequence-pdf';

export type PresentationPdfFontBytes = {
	regular: ArrayBuffer;
	bold: ArrayBuffer;
};

type PdfFonts = {
	regular: PDFFont;
	bold: PDFFont;
};

type PdfLayout = {
	pdf: PDFDocument;
	page: PDFPage;
	fonts: PdfFonts;
	template: ExportTemplate;
	options: PresentationExportOptions;
	pageWidth: number;
	pageHeight: number;
	left: number;
	right: number;
	top: number;
	bottom: number;
	y: number;
	section: ExportDocumentSection | null;
	ink: RGB;
	muted: RGB;
	accent: RGB;
	wash: RGB;
	border: RGB;
};

function color(hex: string): RGB {
	const value = hex.replace('#', '');
	const parsed = Number.parseInt(
		value.length === 3 ? value.replace(/./g, (x) => x + x) : value,
		16
	);
	return rgb(((parsed >> 16) & 255) / 255, ((parsed >> 8) & 255) / 255, (parsed & 255) / 255);
}

function supportedText(text: string, font: PDFFont): string {
	const supported = new Set(font.getCharacterSet());
	return [...text]
		.map((character) => {
			const code = character.codePointAt(0) ?? 0;
			if (character === '\n' || character === '\t' || supported.has(code)) return character;
			return supported.has(0x25a1) ? '□' : '?';
		})
		.join('');
}

function wrapLine(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
	const safe = supportedText(text, font);
	if (!safe.trim()) return [''];
	const words = safe.split(/\s+/).filter(Boolean);
	const lines: string[] = [];
	let current = words.shift() ?? '';
	for (const word of words) {
		const candidate = `${current} ${word}`;
		if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
			current = candidate;
			continue;
		}
		lines.push(current);
		current = word;
		while (current.length > 1 && font.widthOfTextAtSize(current, size) > maxWidth) {
			let cut = current.length - 1;
			while (cut > 1 && font.widthOfTextAtSize(current.slice(0, cut), size) > maxWidth) cut--;
			lines.push(current.slice(0, cut));
			current = current.slice(cut);
		}
	}
	lines.push(current);
	return lines;
}

function alignedX(layout: PdfLayout, text: string, font: PDFFont, size: number, align: string) {
	const width = layout.right - layout.left;
	const textWidth = font.widthOfTextAtSize(text, size);
	if (align === 'center') return layout.left + Math.max(0, (width - textWidth) / 2);
	if (align === 'right') return layout.right - textWidth;
	return layout.left;
}

function decoratePage(layout: PdfLayout) {
	const { page, template, pageWidth, pageHeight } = layout;
	page.drawRectangle({
		x: 0,
		y: 0,
		width: pageWidth,
		height: pageHeight,
		color: color(template.colors.paper)
	});
	if (template.id === 'editorial') {
		page.drawRectangle({
			x: 0,
			y: pageHeight - 9,
			width: pageWidth,
			height: 9,
			color: layout.accent
		});
	}
	if (template.id === 'sticky-deck') {
		page.drawRectangle({
			x: 28,
			y: 32,
			width: pageWidth - 56,
			height: pageHeight - 64,
			color: layout.wash,
			borderColor: layout.border,
			borderWidth: 2
		});
	}
}

function contentBounds(template: ExportTemplate, pageWidth: number, pageHeight: number) {
	if (template.id === 'sticky-deck') {
		return { left: 64, right: pageWidth - 64, top: pageHeight - 68, bottom: 70 };
	}
	const margin = template.id === 'editorial' ? 64 : 56;
	return { left: margin, right: pageWidth - margin, top: pageHeight - margin, bottom: margin };
}

function addPage(layout: PdfLayout, continuation = false): void {
	const page = layout.pdf.addPage([layout.pageWidth, layout.pageHeight]);
	const bounds = contentBounds(layout.template, layout.pageWidth, layout.pageHeight);
	layout.page = page;
	layout.left = bounds.left;
	layout.right = bounds.right;
	layout.top = bounds.top;
	layout.bottom = bounds.bottom;
	layout.y = bounds.top;
	decoratePage(layout);
	if (continuation && layout.section) {
		const label = `${layout.section.title} · continued`;
		page.drawText(supportedText(label, layout.fonts.bold), {
			x: layout.left,
			y: layout.y - 10,
			size: 9,
			font: layout.fonts.bold,
			color: layout.muted
		});
		layout.y -= 30;
	}
}

function ensureSpace(layout: PdfLayout, height: number): void {
	if (layout.y - height >= layout.bottom) return;
	addPage(layout, true);
}

function drawWrappedText(
	layout: PdfLayout,
	text: string,
	opts: {
		font?: PDFFont;
		size?: number;
		leading?: number;
		color?: RGB;
		align?: 'left' | 'center' | 'right';
		indent?: number;
		paragraphGap?: number;
	}
) {
	const font = opts.font ?? layout.fonts.regular;
	const size = opts.size ?? 11;
	const leading = opts.leading ?? size * 1.45;
	const indent = opts.indent ?? 0;
	const align = opts.align ?? 'left';
	const oldLeft = layout.left;
	layout.left += indent;
	const width = layout.right - layout.left;
	const paragraphs = text.split('\n');
	for (const paragraph of paragraphs) {
		const lines = wrapLine(paragraph, font, size, width);
		for (const line of lines) {
			ensureSpace(layout, leading);
			if (line) {
				layout.page.drawText(line, {
					x: alignedX(layout, line, font, size, align),
					y: layout.y - size,
					size,
					font,
					color: opts.color ?? layout.ink
				});
			}
			layout.y -= leading;
		}
	}
	layout.left = oldLeft;
	layout.y -= opts.paragraphGap ?? 4;
}

function nodeImages(nodes: MarkdownNode[]): Array<Extract<MarkdownNode, { type: 'image' }>> {
	return nodes.flatMap((node) => {
		if (node.type === 'image') return [node];
		if (
			node.type === 'paragraph' ||
			node.type === 'strong' ||
			node.type === 'emphasis' ||
			node.type === 'delete' ||
			node.type === 'link' ||
			node.type === 'blockquote'
		) {
			return nodeImages(node.children);
		}
		return [];
	});
}

async function embeddedImage(pdf: PDFDocument, src: string): Promise<PDFImage | null> {
	let dataUrl = src;
	if (src.toLowerCase().startsWith('mash-blob:')) {
		const { resolveToDataUrl } = await import('./note-blobs');
		dataUrl = (await resolveToDataUrl(src)) ?? '';
	}
	const decoded = decodeDataUrlImage(dataUrl);
	if (!decoded) return null;
	try {
		return decoded.format === 'png'
			? await pdf.embedPng(decoded.bytes)
			: await pdf.embedJpg(decoded.bytes);
	} catch {
		return null;
	}
}

async function drawImage(layout: PdfLayout, node: Extract<MarkdownNode, { type: 'image' }>) {
	const image = await embeddedImage(layout.pdf, node.src);
	if (!image) {
		if (node.alt) drawWrappedText(layout, `[Image: ${node.alt}]`, { color: layout.muted });
		return;
	}
	const width = layout.right - layout.left;
	const maxHeight = Math.min(360, layout.pageHeight * 0.42);
	const scale = Math.min(width / image.width, maxHeight / image.height, 1);
	const imageWidth = image.width * scale;
	const imageHeight = image.height * scale;
	ensureSpace(layout, imageHeight + 18);
	layout.page.drawImage(image, {
		x: layout.left + (width - imageWidth) / 2,
		y: layout.y - imageHeight,
		width: imageWidth,
		height: imageHeight
	});
	layout.y -= imageHeight + 14;
}

async function drawBlocks(layout: PdfLayout, nodes: MarkdownNode[]) {
	for (const node of nodes) {
		switch (node.type) {
			case 'heading': {
				const size = node.depth <= 1 ? 17 : node.depth === 2 ? 14 : 12;
				ensureSpace(layout, size * 2.2);
				drawWrappedText(layout, exportNodeText(node.children), {
					font: layout.fonts.bold,
					size,
					leading: size * 1.3,
					color: layout.accent,
					paragraphGap: 7
				});
				break;
			}
			case 'paragraph': {
				for (const image of nodeImages(node.children)) await drawImage(layout, image);
				const text = exportNodeText(node.children.filter((child) => child.type !== 'image'));
				if (text) drawWrappedText(layout, text, { align: layout.section?.align ?? 'left' });
				break;
			}
			case 'list':
				for (let index = 0; index < node.items.length; index++) {
					const item = node.items[index]!;
					const marker = item.task
						? item.checked
							? '[x]'
							: '[ ]'
						: node.ordered
							? `${(node.start ?? 1) + index}.`
							: '•';
					drawWrappedText(layout, `${marker} ${exportNodeText(item.children)}`, {
						indent: 12,
						paragraphGap: 1
					});
				}
				layout.y -= 4;
				break;
			case 'blockquote': {
				const startY = layout.y;
				drawWrappedText(layout, exportNodeText(node.children), {
					indent: 16,
					color: layout.muted,
					paragraphGap: 8
				});
				layout.page.drawRectangle({
					x: layout.left + 3,
					y: layout.y + 7,
					width: 3,
					height: Math.max(12, startY - layout.y - 2),
					color: layout.accent
				});
				break;
			}
			case 'code-block':
			case 'code': {
				const text = node.text;
				const lineCount = Math.max(1, text.split('\n').length);
				ensureSpace(layout, Math.min(130, lineCount * 13 + 18));
				const boxTop = layout.y;
				drawWrappedText(layout, text, {
					size: 9,
					leading: 12,
					indent: 10,
					paragraphGap: 12
				});
				layout.page.drawRectangle({
					x: layout.left,
					y: layout.y + 7,
					width: layout.right - layout.left,
					height: Math.max(18, boxTop - layout.y),
					borderColor: layout.border,
					borderWidth: 0.75
				});
				break;
			}
			case 'rule':
				ensureSpace(layout, 16);
				layout.page.drawLine({
					start: { x: layout.left, y: layout.y - 6 },
					end: { x: layout.right, y: layout.y - 6 },
					thickness: 0.8,
					color: layout.border
				});
				layout.y -= 18;
				break;
			case 'image':
				await drawImage(layout, node);
				break;
			case 'table': {
				const rows = [node.header, ...node.rows].map((row) =>
					row.map((cell) => exportNodeText(cell)).join('  |  ')
				);
				for (const row of rows) {
					drawWrappedText(layout, row, { size: 9.5, leading: 13, paragraphGap: 1 });
				}
				layout.y -= 6;
				break;
			}
			case 'break':
				layout.y -= 10;
				break;
			case 'text':
			case 'wikilink':
			case 'strong':
			case 'emphasis':
			case 'delete':
			case 'link':
				drawWrappedText(layout, exportNodeText([node]), {});
				break;
		}
	}
}

function sectionMeta(section: ExportDocumentSection): string {
	return [section.folder, section.tags.map((tag) => `#${tag}`).join(' '), section.sourceLabel]
		.filter(Boolean)
		.join(' · ');
}

async function drawSection(layout: PdfLayout, section: ExportDocumentSection, isFirst: boolean) {
	layout.section = section;
	if (isFirst && layout.options.includeCover) {
		addPage(layout);
	} else if (
		!isFirst &&
		(layout.template.flow === 'page-per-note' || layout.y < layout.bottom + 180)
	) {
		addPage(layout);
	} else if (!isFirst) {
		ensureSpace(layout, 70);
		layout.page.drawLine({
			start: { x: layout.left, y: layout.y - 4 },
			end: { x: layout.left + 42, y: layout.y - 4 },
			thickness: 2.5,
			color: layout.accent
		});
		layout.y -= 28;
	}

	layout.page.drawText(String(section.position).padStart(2, '0'), {
		x: layout.left,
		y: layout.y - 7,
		size: 8,
		font: layout.fonts.bold,
		color: layout.accent
	});
	layout.y -= 26;
	const titleSize =
		layout.template.id === 'editorial' ? 29 : layout.template.id === 'sticky-deck' ? 27 : 24;
	drawWrappedText(layout, section.title, {
		font: layout.fonts.bold,
		size: titleSize,
		leading: titleSize * 1.12,
		align: section.align,
		paragraphGap: 10
	});
	if (layout.options.includeMetadata) {
		const meta = sectionMeta(section);
		if (meta) {
			drawWrappedText(layout, meta, {
				size: 8.5,
				leading: 12,
				color: layout.muted,
				align: section.align,
				paragraphGap: 13
			});
		}
	}
	await drawBlocks(layout, section.blocks);
}

function drawCover(layout: PdfLayout, document: ExportDocument) {
	addPage(layout);
	const { page } = layout;
	const accentWidth = layout.template.id === 'editorial' ? 104 : 78;
	page.drawRectangle({
		x: layout.left,
		y: layout.pageHeight - 186,
		width: accentWidth,
		height: 8,
		color: layout.accent
	});
	layout.y = layout.pageHeight - 230;
	drawWrappedText(layout, layout.options.documentTitle, {
		font: layout.fonts.bold,
		size: layout.template.id === 'editorial' ? 42 : 38,
		leading: 46,
		paragraphGap: 22
	});
	if (document.sourceLabel) {
		drawWrappedText(layout, document.sourceLabel, {
			size: 11,
			leading: 15,
			color: layout.muted,
			paragraphGap: 12
		});
	}
	drawWrappedText(
		layout,
		`${document.sections.length} note${document.sections.length === 1 ? '' : 's'} · ${exportDocumentWordCount(document)} words`,
		{ size: 9, color: layout.accent }
	);
	page.drawText('M', {
		x: layout.pageWidth - layout.right,
		y: 58,
		size: 44,
		font: layout.fonts.bold,
		color: layout.accent,
		opacity: 0.18
	});
}

async function embedFonts(
	pdf: PDFDocument,
	templateId: PresentationExportOptions['templateId'],
	bytes?: PresentationPdfFontBytes
): Promise<PdfFonts> {
	if (bytes) {
		try {
			pdf.registerFontkit(fontkit);
			return {
				regular: await pdf.embedFont(bytes.regular, { subset: true }),
				bold: await pdf.embedFont(bytes.bold, { subset: true })
			};
		} catch (error) {
			console.warn('Custom PDF font unavailable; using standard fonts', error);
		}
	}
	if (templateId === 'editorial') {
		return {
			regular: await pdf.embedFont(StandardFonts.TimesRoman),
			bold: await pdf.embedFont(StandardFonts.TimesRomanBold)
		};
	}
	return {
		regular: await pdf.embedFont(StandardFonts.Helvetica),
		bold: await pdf.embedFont(StandardFonts.HelveticaBold)
	};
}

export async function loadPresentationPdfFonts(
	templateId: PresentationExportOptions['templateId']
): Promise<PresentationPdfFontBytes | undefined> {
	if (templateId === 'editorial') return undefined;
	const urls = [liberationSansRegularUrl, liberationSansBoldUrl];
	const [regular, bold] = await Promise.all(
		urls.map((url) => fetch(url).then((response) => response.arrayBuffer()))
	);
	return { regular, bold };
}

export async function buildPresentationPdf(
	document: ExportDocument,
	options: PresentationExportOptions,
	fontBytes?: PresentationPdfFontBytes
): Promise<Uint8Array> {
	const pdf = await PDFDocument.create();
	pdf.setTitle(options.documentTitle);
	pdf.setSubject(document.sourceLabel);
	pdf.setCreator('Mash');
	pdf.setProducer('Mash presentation export');
	const template = exportTemplate(options.templateId);
	const size = EXPORT_PAGE_SIZES[options.pageSize];
	const fonts = await embedFonts(pdf, options.templateId, fontBytes);
	const placeholder = pdf.addPage([size.width, size.height]);
	const bounds = contentBounds(template, size.width, size.height);
	const layout: PdfLayout = {
		pdf,
		page: placeholder,
		fonts,
		template,
		options,
		pageWidth: size.width,
		pageHeight: size.height,
		...bounds,
		y: bounds.top,
		section: null,
		ink: color(template.colors.ink),
		muted: color(template.colors.muted),
		accent: color(template.colors.accent),
		wash: color(template.colors.wash),
		border: color(template.colors.border)
	};
	pdf.removePage(0);

	if (options.includeCover) drawCover(layout, document);
	for (let index = 0; index < document.sections.length; index++) {
		if (index === 0 && !options.includeCover) addPage(layout);
		await drawSection(layout, document.sections[index]!, index === 0);
	}
	if (document.sections.length === 0 && !options.includeCover) drawCover(layout, document);

	if (options.includePageNumbers) {
		const pages = pdf.getPages();
		pages.forEach((page, index) => {
			const label = `${index + 1} / ${pages.length}`;
			const labelWidth = fonts.regular.widthOfTextAtSize(label, 8);
			page.drawText(label, {
				x: bounds.right - labelWidth,
				y: 24,
				size: 8,
				font: fonts.regular,
				color: layout.muted
			});
		});
	}

	return pdf.save();
}
