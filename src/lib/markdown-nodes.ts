import { marked } from 'marked';
import { isSafeHref, isSafeImageSrc } from './markdown';

export type MarkdownNode =
	| { type: 'text'; text: string }
	| { type: 'wikilink'; target: string; label: string }
	| { type: 'paragraph'; children: MarkdownNode[] }
	| { type: 'heading'; depth: number; children: MarkdownNode[] }
	| { type: 'strong' | 'emphasis' | 'delete'; children: MarkdownNode[] }
	| { type: 'link'; href: string; title?: string; children: MarkdownNode[] }
	| { type: 'image'; src: string; alt: string; title?: string }
	| { type: 'code'; text: string }
	| { type: 'code-block'; text: string; language?: string }
	| { type: 'break' | 'rule' }
	| { type: 'blockquote'; children: MarkdownNode[] }
	| { type: 'list'; ordered: boolean; start?: number; items: MarkdownListItem[] }
	| { type: 'table'; header: MarkdownNode[][]; rows: MarkdownNode[][][] };

export type MarkdownListItem = {
	children: MarkdownNode[];
	task: boolean;
	checked: boolean;
};

type LexerToken = {
	type: string;
	raw?: string;
	text?: string;
	depth?: number;
	tokens?: LexerToken[];
	href?: string;
	title?: string | null;
	lang?: string;
	ordered?: boolean;
	start?: number | string;
	items?: LexerToken[];
	task?: boolean;
	checked?: boolean;
	header?: LexerTableCell[];
	rows?: LexerTableCell[][];
};

type LexerTableCell = {
	text?: string;
	tokens?: LexerToken[];
};

const WIKILINK_RE = /\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/g;

function splitWikilinks(text: string): MarkdownNode[] {
	const nodes: MarkdownNode[] = [];
	let cursor = 0;
	for (const match of text.matchAll(WIKILINK_RE)) {
		const index = match.index;
		if (index > cursor) nodes.push({ type: 'text', text: text.slice(cursor, index) });
		const target = (match[1] ?? '').trim();
		const label = (match[2] ?? match[1] ?? '').trim();
		if (target) nodes.push({ type: 'wikilink', target, label: label || target });
		else nodes.push({ type: 'text', text: match[0] });
		cursor = index + match[0].length;
	}
	if (cursor < text.length) nodes.push({ type: 'text', text: text.slice(cursor) });
	return nodes;
}

function childNodes(token: LexerToken): MarkdownNode[] {
	if (token.tokens?.length) return convertTokens(token.tokens);
	return splitWikilinks(token.text ?? '');
}

function tableCellNodes(cell: LexerTableCell): MarkdownNode[] {
	if (cell.tokens?.length) return convertTokens(cell.tokens);
	return splitWikilinks(cell.text ?? '');
}

function numericStart(start: number | string | undefined): number | undefined {
	const value = typeof start === 'number' ? start : Number.parseInt(start ?? '', 10);
	return Number.isFinite(value) ? value : undefined;
}

function convertToken(token: LexerToken): MarkdownNode[] {
	switch (token.type) {
		case 'space':
		case 'def':
			return [];
		case 'text':
		case 'escape':
			return childNodes(token);
		case 'html':
			return [{ type: 'text', text: token.raw ?? token.text ?? '' }];
		case 'paragraph':
			return [{ type: 'paragraph', children: childNodes(token) }];
		case 'heading':
			return [{ type: 'heading', depth: token.depth ?? 1, children: childNodes(token) }];
		case 'strong':
			return [{ type: 'strong', children: childNodes(token) }];
		case 'em':
			return [{ type: 'emphasis', children: childNodes(token) }];
		case 'del':
			return [{ type: 'delete', children: childNodes(token) }];
		case 'codespan':
			return [{ type: 'code', text: token.text ?? '' }];
		case 'code':
			return [{ type: 'code-block', text: token.text ?? '', language: token.lang || undefined }];
		case 'br':
			return [{ type: 'break' }];
		case 'hr':
			return [{ type: 'rule' }];
		case 'blockquote':
			return [{ type: 'blockquote', children: convertTokens(token.tokens ?? []) }];
		case 'link': {
			const href = isSafeHref(token.href) ? token.href! : '#';
			return [
				{
					type: 'link',
					href,
					title: token.title || undefined,
					children: childNodes(token)
				}
			];
		}
		case 'image':
			return isSafeImageSrc(token.href)
				? [
						{
							type: 'image',
							src: token.href!,
							alt: token.text || 'Image',
							title: token.title || undefined
						}
					]
				: [];
		case 'list':
			return [
				{
					type: 'list',
					ordered: token.ordered === true,
					start: numericStart(token.start),
					items: (token.items ?? []).map((item) => ({
						children: convertTokens(item.tokens ?? []),
						task: item.task === true,
						checked: item.checked === true
					}))
				}
			];
		case 'table':
			return [
				{
					type: 'table',
					header: (token.header ?? []).map(tableCellNodes),
					rows: (token.rows ?? []).map((row) => row.map(tableCellNodes))
				}
			];
		default:
			if (token.tokens?.length) return convertTokens(token.tokens);
			return token.text ? splitWikilinks(token.text) : [];
	}
}

function convertTokens(tokens: LexerToken[]): MarkdownNode[] {
	return tokens.flatMap(convertToken);
}

/** Parse Markdown into inert render data so preview never needs an HTML injection sink. */
export function markdownNodes(body: string): MarkdownNode[] {
	return convertTokens(marked.lexer(body) as unknown as LexerToken[]);
}
