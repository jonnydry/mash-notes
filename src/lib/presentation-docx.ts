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
	const serif = options.templateId === 'journal' || options.templateId === 'monograph';
	return {
		bodyFont: serif ? 'Georgia' : 'Aptos',
		displayFont: options.templateId === 'plain' ? 'Aptos' : serif ? 'Georgia' : 'Aptos Display',
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
	if (!isFirst && exportTemplate(options.templateId).flow === 'page-per-note') {
		blocks.push(new Paragraph({ children: [new PageBreak()] }));
	}
	if (options.templateId !== 'plain') {
		blocks.push(
			new Paragraph({
				style: 'MashNoteNumber',
				children: [new TextRun(String(section.position).padStart(2, '0'))]
			})
		);
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
	const cards = options.templateId === 'cards';
	const swiss = options.templateId === 'swiss';
	const studio = options.templateId === 'studio';
	const monograph = options.templateId === 'monograph';
	const journal = options.templateId === 'journal';
	const plain = options.templateId === 'plain';
	const titleBorder = swiss
		? {
				top: { style: BorderStyle.SINGLE, color: theme.ink, size: 14, space: 10 },
				bottom: { style: BorderStyle.SINGLE, color: theme.ink, size: 14, space: 10 }
			}
		: cards
			? { bottom: { style: BorderStyle.SINGLE, color: theme.accent, size: 16 } }
			: studio
				? { left: { style: BorderStyle.SINGLE, color: theme.accent, size: 42, space: 14 } }
				: monograph
					? { bottom: { style: BorderStyle.SINGLE, color: theme.ink, size: 10, space: 8 } }
					: undefined;
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
					size: plain ? 60 : journal ? 76 : swiss || monograph ? 84 : 68,
					bold: true,
					color: theme.ink
				},
				paragraph: { spacing: { before: 240, after: 280 } }
			},
			{
				id: 'MashEdition',
				name: 'Mash Edition',
				basedOn: 'Normal',
				next: 'MashDocumentTitle',
				quickFormat: true,
				run: {
					font: theme.bodyFont,
					size: 17,
					bold: true,
					color: theme.accent,
					allCaps: true,
					characterSpacing: 24
				},
				paragraph: {
					spacing: { before: 120, after: 160 },
					border: swiss
						? { bottom: { style: BorderStyle.SINGLE, color: theme.ink, size: 14, space: 8 } }
						: undefined
				}
			},
			{
				id: 'MashNoteNumber',
				name: 'Mash Note Number',
				basedOn: 'Normal',
				next: 'MashNoteTitle',
				quickFormat: true,
				run: {
					font: theme.displayFont,
					size: swiss ? 64 : monograph ? 50 : studio ? 26 : 18,
					bold: true,
					color: swiss || studio ? theme.accent : monograph ? theme.muted : theme.accent
				},
				paragraph: { spacing: { before: 220, after: swiss ? 80 : 30 } }
			},
			{
				id: 'MashNoteTitle',
				name: 'Mash Note Title',
				basedOn: 'Heading1',
				next: 'MashBody',
				quickFormat: true,
				run: {
					font: theme.displayFont,
					size: plain ? 36 : journal ? 48 : swiss || monograph ? 54 : studio ? 50 : 42,
					bold: true,
					color: theme.ink
				},
				paragraph: {
					spacing: { before: plain ? 180 : 280, after: plain ? 80 : 100 },
					shading: cards ? { fill: theme.wash, type: ShadingType.CLEAR } : undefined,
					border: titleBorder
				}
			},
			{
				id: 'MashHeading1',
				name: 'Mash Heading 1',
				basedOn: 'Heading2',
				next: 'MashBody',
				quickFormat: true,
				run: {
					font: theme.displayFont,
					size: plain ? 28 : 32,
					bold: true,
					color: theme.accent
				},
				paragraph: { spacing: { before: 220, after: 90 } }
			},
			{
				id: 'MashHeading2',
				name: 'Mash Heading 2',
				basedOn: 'Heading3',
				next: 'MashBody',
				quickFormat: true,
				run: {
					font: theme.displayFont,
					size: plain ? 24 : 26,
					bold: true,
					color: theme.accent
				},
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
				run: {
					font: theme.bodyFont,
					size: 17,
					color: theme.muted,
					italics: plain ? false : true
				},
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
		if (options.templateId !== 'plain') {
			children.push(
				new Paragraph({
					style: 'MashEdition',
					children: [new TextRun(`${exportTemplate(options.templateId).name} edition`)]
				})
			);
		}
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
			})
		);
		if (options.templateId !== 'swiss') {
			children.push(new Paragraph({ children: [new PageBreak()] }));
		}
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
		children:
			options.templateId === 'plain'
				? []
				: [
						new Paragraph({
							border:
								options.templateId === 'swiss'
									? {
											bottom: {
												style: BorderStyle.SINGLE,
												color: theme.ink,
												size: 12,
												space: 6
											}
										}
									: undefined,
							children: [
								new TextRun({
									text: `${options.documentTitle}  ·  MASH`,
									color: options.templateId === 'swiss' ? theme.accent : theme.muted,
									size: 16,
									bold: options.templateId === 'swiss'
								})
							]
						})
					]
	});
	const isA4 = options.pageSize === 'a4';
	const margins =
		options.templateId === 'plain'
			? { top: 1, right: 1, bottom: 1, left: 1 }
			: options.templateId === 'monograph'
				? { top: 0.85, right: 0.85, bottom: 0.8, left: 0.85 }
				: options.templateId === 'studio'
					? { top: 0.7, right: 0.7, bottom: 0.7, left: 0.95 }
					: options.templateId === 'swiss'
						? { top: 0.65, right: 0.7, bottom: 0.65, left: 0.7 }
						: { top: 0.7, right: 0.75, bottom: 0.7, left: 0.75 };
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
							top: convertInchesToTwip(margins.top),
							right: convertInchesToTwip(margins.right),
							bottom: convertInchesToTwip(margins.bottom),
							left: convertInchesToTwip(margins.left)
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
