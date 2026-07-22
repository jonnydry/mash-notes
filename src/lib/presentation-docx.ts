import {
	AlignmentType,
	BorderStyle,
	convertInchesToTwip,
	convertMillimetersToTwip,
	Document,
	ExternalHyperlink,
	Footer,
	Header,
	ImageRun,
	LevelFormat,
	Packer,
	PageBreak,
	PageNumber,
	Paragraph,
	ShadingType,
	Table,
	TableCell,
	TableRow,
	TextRun,
	WidthType,
	type ParagraphChild
} from 'docx';
import type {
	ExportDocument,
	ExportDocumentSection,
	PresentationExportOptions
} from './export-document';
import { exportDocumentWordCount, exportNodeText } from './export-document';
import { exportTemplate } from './export-templates';
import type { MarkdownNode } from './markdown-nodes';
import { decodeDataUrlImage } from './sequence-pdf';

type DocxTheme = {
	bodyFont: string;
	displayFont: string;
	ink: string;
	muted: string;
	accent: string;
	wash: string;
	border: string;
};

function docxTheme(options: PresentationExportOptions): DocxTheme {
	const template = exportTemplate(options.templateId);
	return {
		bodyFont: options.templateId === 'editorial' ? 'Georgia' : 'Aptos',
		displayFont: options.templateId === 'editorial' ? 'Georgia' : 'Aptos Display',
		ink: template.colors.ink.slice(1),
		muted: template.colors.muted.slice(1),
		accent: template.colors.accent.slice(1),
		wash: template.colors.wash.slice(1),
		border: template.colors.border.slice(1)
	};
}

function alignment(value: ExportDocumentSection['align']) {
	if (value === 'center') return AlignmentType.CENTER;
	if (value === 'right') return AlignmentType.RIGHT;
	return AlignmentType.LEFT;
}

type RunStyle = { bold?: boolean; italics?: boolean; strike?: boolean; code?: boolean };

function inlineChildren(
	nodes: MarkdownNode[],
	theme: DocxTheme,
	style: RunStyle = {}
): ParagraphChild[] {
	const children: ParagraphChild[] = [];
	for (const node of nodes) {
		switch (node.type) {
			case 'text':
				children.push(
					new TextRun({
						text: node.text,
						bold: style.bold,
						italics: style.italics,
						strike: style.strike,
						font: style.code ? 'Consolas' : theme.bodyFont,
						color: theme.ink
					})
				);
				break;
			case 'wikilink':
				children.push(new TextRun({ text: node.label, color: theme.accent, underline: {} }));
				break;
			case 'strong':
				children.push(...inlineChildren(node.children, theme, { ...style, bold: true }));
				break;
			case 'emphasis':
				children.push(...inlineChildren(node.children, theme, { ...style, italics: true }));
				break;
			case 'delete':
				children.push(...inlineChildren(node.children, theme, { ...style, strike: true }));
				break;
			case 'code':
				children.push(
					new TextRun({
						text: node.text,
						font: 'Consolas',
						color: theme.accent,
						shading: { fill: theme.wash }
					})
				);
				break;
			case 'link': {
				const linkRuns = inlineChildren(node.children, theme).filter(
					(child): child is TextRun => child instanceof TextRun
				);
				if (node.href !== '#' && linkRuns.length > 0) {
					children.push(new ExternalHyperlink({ link: node.href, children: linkRuns }));
				} else {
					children.push(...linkRuns);
				}
				break;
			}
			case 'break':
				children.push(new TextRun({ break: 1 }));
				break;
			default: {
				const text = exportNodeText([node]);
				if (text) children.push(new TextRun({ text, font: theme.bodyFont, color: theme.ink }));
			}
		}
	}
	return children;
}

async function imageRun(node: Extract<MarkdownNode, { type: 'image' }>): Promise<ImageRun | null> {
	let dataUrl = node.src;
	if (node.src.toLowerCase().startsWith('mash-blob:')) {
		const { resolveToDataUrl } = await import('./note-blobs');
		dataUrl = (await resolveToDataUrl(node.src)) ?? '';
	}
	const decoded = decodeDataUrlImage(dataUrl);
	if (!decoded) return null;
	let width = 460;
	let height = 280;
	try {
		const { readEncodedImageDimensions } = await import('./image-headers');
		const imageBytes = new Uint8Array(decoded.bytes);
		const dimensions = await readEncodedImageDimensions(
			new Blob([imageBytes], { type: decoded.format === 'png' ? 'image/png' : 'image/jpeg' })
		);
		if (dimensions) {
			const scale = Math.min(460 / dimensions.width, 360 / dimensions.height, 1);
			width = Math.max(1, Math.round(dimensions.width * scale));
			height = Math.max(1, Math.round(dimensions.height * scale));
		}
	} catch {
		/* Keep safe default dimensions. */
	}
	return new ImageRun({
		type: decoded.format === 'png' ? 'png' : 'jpg',
		data: decoded.bytes,
		transformation: { width, height },
		altText: { title: node.alt || 'Image', description: node.alt || 'Image', name: 'Mash image' }
	});
}

async function nodeBlocks(node: MarkdownNode, theme: DocxTheme): Promise<Array<Paragraph | Table>> {
	switch (node.type) {
		case 'heading':
			return [
				new Paragraph({
					style: node.depth <= 1 ? 'MashHeading1' : 'MashHeading2',
					children: inlineChildren(node.children, theme)
				})
			];
		case 'paragraph': {
			const images = node.children.filter(
				(child): child is Extract<MarkdownNode, { type: 'image' }> => child.type === 'image'
			);
			const paragraphs: Paragraph[] = [];
			for (const image of images) {
				const run = await imageRun(image);
				if (run)
					paragraphs.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [run] }));
			}
			const remaining = node.children.filter((child) => child.type !== 'image');
			if (remaining.length > 0) {
				paragraphs.push(
					new Paragraph({ style: 'MashBody', children: inlineChildren(remaining, theme) })
				);
			}
			return paragraphs;
		}
		case 'list':
			return node.items.map(
				(item) =>
					new Paragraph({
						style: 'MashBody',
						...(node.ordered
							? { numbering: { reference: 'mash-numbering', level: 0 } }
							: { bullet: { level: 0 } }),
						children: [
							...(item.task ? [new TextRun(item.checked ? '☒ ' : '☐ ')] : []),
							...inlineChildren(item.children, theme)
						]
					})
			);
		case 'blockquote':
			return [
				new Paragraph({
					style: 'MashQuote',
					children: inlineChildren(node.children, theme, { italics: true })
				})
			];
		case 'code-block':
		case 'code':
			return [
				new Paragraph({
					style: 'MashCode',
					children: [new TextRun({ text: node.text, font: 'Consolas' })]
				})
			];
		case 'rule':
			return [
				new Paragraph({
					border: { bottom: { style: BorderStyle.SINGLE, color: theme.border, size: 6 } },
					children: []
				})
			];
		case 'image': {
			const run = await imageRun(node);
			return run ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [run] })] : [];
		}
		case 'table': {
			const rows = [node.header, ...node.rows].map(
				(row, rowIndex) =>
					new TableRow({
						children: row.map(
							(cell) =>
								new TableCell({
									shading:
										rowIndex === 0 ? { fill: theme.wash, type: ShadingType.CLEAR } : undefined,
									children: [
										new Paragraph({
											children: inlineChildren(cell, theme, { bold: rowIndex === 0 })
										})
									]
								})
						)
					})
			);
			return [new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows })];
		}
		case 'break':
			return [new Paragraph({ children: [] })];
		default: {
			const children = inlineChildren([node], theme);
			return children.length > 0 ? [new Paragraph({ style: 'MashBody', children })] : [];
		}
	}
}

async function sectionBlocks(
	section: ExportDocumentSection,
	options: PresentationExportOptions,
	theme: DocxTheme,
	isFirst: boolean
): Promise<Array<Paragraph | Table>> {
	const blocks: Array<Paragraph | Table> = [];
	if (!isFirst && options.templateId === 'sticky-deck') {
		blocks.push(new Paragraph({ children: [new PageBreak()] }));
	}
	blocks.push(
		new Paragraph({
			style: 'MashNoteTitle',
			alignment: alignment(section.align),
			children: [new TextRun(section.title)]
		})
	);
	if (options.includeMetadata) {
		const meta = [
			section.folder,
			section.tags.map((tag) => `#${tag}`).join(' '),
			section.sourceLabel
		]
			.filter(Boolean)
			.join(' · ');
		if (meta) {
			blocks.push(
				new Paragraph({
					style: 'MashMeta',
					alignment: alignment(section.align),
					children: [new TextRun(meta)]
				})
			);
		}
	}
	for (const node of section.blocks) blocks.push(...(await nodeBlocks(node, theme)));
	return blocks;
}

function styles(options: PresentationExportOptions, theme: DocxTheme) {
	const sticky = options.templateId === 'sticky-deck';
	return {
		default: {
			document: {
				run: { font: theme.bodyFont, size: 22, color: theme.ink },
				paragraph: { spacing: { after: 150, line: 300 } }
			}
		},
		paragraphStyles: [
			{
				id: 'MashDocumentTitle',
				name: 'Mash Document Title',
				basedOn: 'Normal',
				next: 'MashBody',
				quickFormat: true,
				run: {
					font: theme.displayFont,
					size: options.templateId === 'editorial' ? 76 : 68,
					bold: true,
					color: theme.ink
				},
				paragraph: { spacing: { before: 240, after: 280 } }
			},
			{
				id: 'MashNoteTitle',
				name: 'Mash Note Title',
				basedOn: 'Heading1',
				next: 'MashBody',
				quickFormat: true,
				run: {
					font: theme.displayFont,
					size: options.templateId === 'editorial' ? 48 : 42,
					bold: true,
					color: theme.ink
				},
				paragraph: {
					spacing: { before: 280, after: 100 },
					shading: sticky ? { fill: theme.wash, type: ShadingType.CLEAR } : undefined,
					border: sticky
						? { bottom: { style: BorderStyle.SINGLE, color: theme.accent, size: 16 } }
						: undefined
				}
			},
			{
				id: 'MashHeading1',
				name: 'Mash Heading 1',
				basedOn: 'Heading2',
				next: 'MashBody',
				quickFormat: true,
				run: { font: theme.displayFont, size: 32, bold: true, color: theme.accent },
				paragraph: { spacing: { before: 220, after: 90 } }
			},
			{
				id: 'MashHeading2',
				name: 'Mash Heading 2',
				basedOn: 'Heading3',
				next: 'MashBody',
				quickFormat: true,
				run: { font: theme.displayFont, size: 26, bold: true, color: theme.accent },
				paragraph: { spacing: { before: 180, after: 70 } }
			},
			{
				id: 'MashBody',
				name: 'Mash Body',
				basedOn: 'Normal',
				next: 'MashBody',
				quickFormat: true,
				run: { font: theme.bodyFont, size: 22, color: theme.ink },
				paragraph: { spacing: { after: 150, line: 300 } }
			},
			{
				id: 'MashMeta',
				name: 'Mash Metadata',
				basedOn: 'Normal',
				next: 'MashBody',
				quickFormat: true,
				run: { font: theme.bodyFont, size: 17, color: theme.muted, italics: true },
				paragraph: { spacing: { after: 220 } }
			},
			{
				id: 'MashQuote',
				name: 'Mash Quote',
				basedOn: 'MashBody',
				next: 'MashBody',
				quickFormat: true,
				run: { font: theme.bodyFont, size: 22, italics: true, color: theme.muted },
				paragraph: {
					indent: { left: 360 },
					border: { left: { style: BorderStyle.SINGLE, color: theme.accent, size: 18, space: 12 } }
				}
			},
			{
				id: 'MashCode',
				name: 'Mash Code',
				basedOn: 'Normal',
				next: 'MashBody',
				quickFormat: true,
				run: { font: 'Consolas', size: 18, color: theme.ink },
				paragraph: {
					shading: { fill: theme.wash, type: ShadingType.CLEAR },
					spacing: { before: 100, after: 180 }
				}
			}
		]
	};
}

export async function buildPresentationDocx(
	document: ExportDocument,
	options: PresentationExportOptions
): Promise<Blob> {
	const theme = docxTheme(options);
	const children: Array<Paragraph | Table> = [];
	if (options.includeCover) {
		children.push(
			new Paragraph({ style: 'MashDocumentTitle', children: [new TextRun(options.documentTitle)] }),
			new Paragraph({
				style: 'MashMeta',
				children: [new TextRun(document.sourceLabel || 'Mash export')]
			}),
			new Paragraph({
				style: 'MashMeta',
				children: [
					new TextRun(
						`${document.sections.length} note${document.sections.length === 1 ? '' : 's'} · ${exportDocumentWordCount(document)} words`
					)
				]
			}),
			new Paragraph({ children: [new PageBreak()] })
		);
	}
	for (let index = 0; index < document.sections.length; index++) {
		children.push(...(await sectionBlocks(document.sections[index]!, options, theme, index === 0)));
	}

	const footer = options.includePageNumbers
		? new Footer({
				children: [
					new Paragraph({
						alignment: AlignmentType.RIGHT,
						children: [
							new TextRun({
								children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES],
								color: theme.muted,
								size: 16
							})
						]
					})
				]
			})
		: undefined;
	const header = new Header({
		children: [
			new Paragraph({
				children: [new TextRun({ text: options.documentTitle, color: theme.muted, size: 16 })]
			})
		]
	});
	const isA4 = options.pageSize === 'a4';
	const file = new Document({
		title: options.documentTitle,
		subject: document.sourceLabel,
		creator: 'Mash',
		description: 'Presentation export from Mash',
		styles: styles(options, theme),
		numbering: {
			config: [
				{
					reference: 'mash-numbering',
					levels: [
						{
							level: 0,
							format: LevelFormat.DECIMAL,
							text: '%1.',
							alignment: AlignmentType.START,
							style: { paragraph: { indent: { left: 720, hanging: 360 } } }
						}
					]
				}
			]
		},
		sections: [
			{
				properties: {
					page: {
						size: isA4
							? { width: convertMillimetersToTwip(210), height: convertMillimetersToTwip(297) }
							: { width: convertInchesToTwip(8.5), height: convertInchesToTwip(11) },
						margin: {
							top: convertInchesToTwip(0.7),
							right: convertInchesToTwip(0.75),
							bottom: convertInchesToTwip(0.7),
							left: convertInchesToTwip(0.75)
						}
					}
				},
				headers: { default: header },
				footers: footer ? { default: footer } : undefined,
				children
			}
		]
	});
	return Packer.toBlob(file);
}
