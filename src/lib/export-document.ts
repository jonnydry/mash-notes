import { markdownNodes, type MarkdownNode } from './markdown-nodes';
import type { Note, NoteSource, TextAlign } from './types';

export type PresentationFormat = 'pdf' | 'docx';
export type ExportTemplateId = 'clean' | 'editorial' | 'sticky-deck';
export type ExportPageSize = 'letter' | 'a4';

export type PresentationExportOptions = {
	format: PresentationFormat;
	templateId: ExportTemplateId;
	pageSize: ExportPageSize;
	includeCover: boolean;
	includeMetadata: boolean;
	includePageNumbers: boolean;
	documentTitle: string;
};

export type PresentationExportRequest = {
	notes: Note[];
	title: string;
	sourceLabel: string;
	format: PresentationFormat;
};

export type ExportDocumentSection = {
	position: number;
	title: string;
	align: TextAlign;
	folder: string;
	tags: string[];
	sourceLabel: string;
	blocks: MarkdownNode[];
};

export type ExportDocument = {
	title: string;
	sourceLabel: string;
	createdAt: number;
	sections: ExportDocumentSection[];
};

export type ExportDocumentInput = {
	title: string;
	sourceLabel: string;
	createdAt?: number;
};

export function noteSourceLabel(source: NoteSource | undefined): string {
	if (!source) return '';
	switch (source.kind) {
		case 'pdf':
			return `${source.title} · page ${source.page}`;
		case 'url':
			return source.title || source.url;
		case 'table':
			return source.row ? `${source.title} · row ${source.row}` : source.title;
		default:
			return source.title;
	}
}

export function buildExportDocument(notes: Note[], input: ExportDocumentInput): ExportDocument {
	return {
		title: input.title.trim() || 'Mash export',
		sourceLabel: input.sourceLabel.trim(),
		createdAt: input.createdAt ?? Date.now(),
		sections: notes.map((note, index) => ({
			position: index + 1,
			title: note.title.trim() || 'Untitled',
			align: note.textAlign === 'center' || note.textAlign === 'right' ? note.textAlign : 'left',
			folder: note.folder.trim(),
			tags: note.tags.map((tag) => tag.trim()).filter(Boolean),
			sourceLabel: noteSourceLabel(note.source),
			blocks: markdownNodes(note.body)
		}))
	};
}

export function exportNodeText(nodes: MarkdownNode[]): string {
	const parts: string[] = [];
	for (const node of nodes) {
		switch (node.type) {
			case 'text':
			case 'code':
			case 'code-block':
				parts.push(node.text);
				break;
			case 'wikilink':
				parts.push(node.label);
				break;
			case 'image':
				if (node.alt) parts.push(node.alt);
				break;
			case 'break':
				parts.push('\n');
				break;
			case 'rule':
				parts.push('\n');
				break;
			case 'paragraph':
			case 'heading':
			case 'strong':
			case 'emphasis':
			case 'delete':
			case 'link':
			case 'blockquote':
				parts.push(exportNodeText(node.children));
				break;
			case 'list':
				parts.push(node.items.map((item) => exportNodeText(item.children)).join('\n'));
				break;
			case 'table':
				parts.push(
					[...node.header, ...node.rows.flat()].map((cell) => exportNodeText(cell)).join(' | ')
				);
				break;
		}
	}
	return parts
		.join('')
		.replace(/[ \t]+\n/g, '\n')
		.trim();
}

export function exportDocumentWordCount(document: ExportDocument): number {
	return document.sections.reduce((total, section) => {
		const text = exportNodeText(section.blocks).trim();
		return total + (text ? text.split(/\s+/).length : 0);
	}, 0);
}
