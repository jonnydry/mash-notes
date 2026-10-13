import { isSafeHref, isSafeImageSrc } from './markdown-sanitize';

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

let lexMarkdown: ((body: string) => LexerToken[]) | null = null;
let loadingMarked: Promise<void> | null = null;

export function isMarkedReady(): boolean {
	return lexMarkdown !== null;
}

/** Load the marked chunk. Repeated calls share one in-flight import. */
export function preloadMarked(): Promise<void> {
	loadingMarked ??= import('./marked-runtime')
		.then((mod) => {
			lexMarkdown = (body) => mod.lexMarkdown(body) as LexerToken[];
		})
		.catch((error: unknown) => {
			loadingMarked = null;
			throw error;
		});
	return loadingMarked;
}

/**
 * Run work on the frame after first paint.
 * One animation frame runs before paint; the second runs after it.
 */
export function runAfterFirstPaint(work: () => void): () => void {
	if (typeof requestAnimationFrame !== 'function') {
		work();
		return () => {};
	}
	let inner = 0;
	const outer = requestAnimationFrame(() => {
		inner = requestAnimationFrame(() => {
			work();
		});
	});
	return () => {
		cancelAnimationFrame(outer);
		if (inner) cancelAnimationFrame(inner);
	};
}

/** Start the marked download once the first paint has happened. */
export function preloadMarkedAfterPaint(): () => void {
	return runAfterFirstPaint(() => {
		void preloadMarked();
	});
}

/** Parse Markdown into inert render data so preview never needs an HTML injection sink. */
export function markdownNodes(body: string): MarkdownNode[] {
	if (!lexMarkdown) throw new Error('Markdown runtime is not loaded');
	return convertTokens(lexMarkdown(body));
}

function pushText(nodes: MarkdownNode[], text: string) {
	if (text) nodes.push({ type: 'text', text });
}

function wrappedMarker(
	source: string,
	index: number,
	marker: string
): { inner: string; length: number } | null {
	if (!source.startsWith(marker, index)) return null;
	const start = index + marker.length;
	const end = source.indexOf(marker, start);
	if (end <= start) return null;
	const inner = source.slice(start, end);
	if (inner.includes('\n')) return null;
	return { inner, length: end + marker.length - index };
}

function underscoreIsEmphasis(source: string, index: number, length: number): boolean {
	const before = source[index - 1];
	const after = source[index + length];
	if (before && /[\w]/.test(before)) return false;
	if (after && /[\w]/.test(after)) return false;
	return true;
}

/** Strip inline markers. The pieces use the same nodes as the real preview. */
function inlineNodes(source: string): MarkdownNode[] {
	const nodes: MarkdownNode[] = [];
	let text = '';
	let index = 0;

	while (index < source.length) {
		const rest = source.slice(index);
		const image = /^!\[([^\]]*)\]\(([^)]+)\)/.exec(rest);
		if (image) {
			pushText(nodes, text);
			text = '';
			pushText(nodes, image[1]);
			index += image[0].length;
			continue;
		}
		const link = /^\[([^\]]+)\]\(([^)]+)\)/.exec(rest);
		if (link) {
			pushText(nodes, text);
			text = '';
			const destination = link[2].trim().replace(/^<|>$/g, '').split(/\s+/)[0] ?? '';
			nodes.push({
				type: 'link',
				href: isSafeHref(destination) ? destination : '#',
				children: inlineNodes(link[1])
			});
			index += link[0].length;
			continue;
		}
		const wikilink = /^\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/.exec(rest);
		if (wikilink) {
			pushText(nodes, text);
			text = '';
			const target = wikilink[1].trim();
			const label = (wikilink[2] ?? wikilink[1]).trim() || target;
			if (target) nodes.push({ type: 'wikilink', target, label });
			index += wikilink[0].length;
			continue;
		}
		const code = /^`([^`\n]+)`/.exec(rest);
		if (code) {
			pushText(nodes, text);
			text = '';
			nodes.push({ type: 'code', text: code[1] });
			index += code[0].length;
			continue;
		}
		const strong = wrappedMarker(source, index, '**') ?? wrappedMarker(source, index, '__');
		if (strong) {
			pushText(nodes, text);
			text = '';
			nodes.push({ type: 'strong', children: inlineNodes(strong.inner) });
			index += strong.length;
			continue;
		}
		const emphasis = wrappedMarker(source, index, '*');
		if (emphasis) {
			pushText(nodes, text);
			text = '';
			nodes.push({ type: 'emphasis', children: inlineNodes(emphasis.inner) });
			index += emphasis.length;
			continue;
		}
		const underline = wrappedMarker(source, index, '_');
		if (underline && underscoreIsEmphasis(source, index, underline.length)) {
			pushText(nodes, text);
			text = '';
			nodes.push({ type: 'emphasis', children: inlineNodes(underline.inner) });
			index += underline.length;
			continue;
		}
		text += source[index];
		index += 1;
	}
	pushText(nodes, text);
	return nodes;
}

function headingLine(line: string): { depth: number; text: string } | null {
	const match = /^(#{1,6})[ \t]+(.+)$/.exec(line.trim());
	if (!match) return null;
	const text = match[2].replace(/[ \t]+#+$/, '').trim();
	if (!text) return null;
	return { depth: match[1].length, text };
}

/**
 * Cold-cache preview. Markers are removed, and the block structure matches the
 * real render so headings, lists, quotes, and rules keep the same font and spacing.
 */
export function plainMarkdownNodes(body: string): MarkdownNode[] {
	if (!body.trim()) return [];
	const nodes: MarkdownNode[] = [];
	let paragraph: MarkdownNode[] = [];
	let list: Extract<MarkdownNode, { type: 'list' }> | null = null;
	let quote: MarkdownNode[] | null = null;
	let fence: { language?: string; lines: string[] } | null = null;

	function flushParagraph() {
		if (!paragraph.length) return;
		nodes.push({ type: 'paragraph', children: paragraph });
		paragraph = [];
	}
	function flushList() {
		if (!list) return;
		nodes.push(list);
		list = null;
	}
	function flushQuote() {
		if (!quote?.length) {
			quote = null;
			return;
		}
		nodes.push({ type: 'blockquote', children: [{ type: 'paragraph', children: quote }] });
		quote = null;
	}
	function flushBlocks() {
		flushParagraph();
		flushList();
		flushQuote();
	}

	for (const rawLine of body.replace(/\r\n/g, '\n').split('\n')) {
		const line = rawLine.replace(/\r$/, '');
		if (fence) {
			if (/^\s*```/.test(line)) {
				nodes.push(
					fence.language
						? { type: 'code-block', text: fence.lines.join('\n'), language: fence.language }
						: { type: 'code-block', text: fence.lines.join('\n') }
				);
				fence = null;
			} else {
				fence.lines.push(line);
			}
			continue;
		}
		const fenceOpen = /^\s*```([\w-]*)\s*$/.exec(line);
		if (fenceOpen) {
			flushBlocks();
			fence = { language: fenceOpen[1] || undefined, lines: [] };
			continue;
		}
		if (!line.trim()) {
			flushBlocks();
			continue;
		}
		const heading = headingLine(line);
		if (heading) {
			flushBlocks();
			nodes.push({
				type: 'heading',
				depth: heading.depth,
				children: inlineNodes(heading.text)
			});
			continue;
		}
		if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
			flushBlocks();
			nodes.push({ type: 'rule' });
			continue;
		}
		const quoted = /^\s*>\s?(.*)$/.exec(line);
		if (quoted) {
			flushParagraph();
			flushList();
			const piece = inlineNodes(quoted[1]);
			if (!piece.length) {
				if (quote?.length) quote.push({ type: 'break' });
				continue;
			}
			if (!quote) quote = [];
			else quote.push({ type: 'break' });
			quote.push(...piece);
			continue;
		}
		const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
		if (item) {
			flushParagraph();
			flushQuote();
			const marker = item[2];
			const ordered = /\d/.test(marker);
			if (!list || list.ordered !== ordered) {
				flushList();
				list = {
					type: 'list',
					ordered,
					start: ordered ? Number.parseInt(marker, 10) : undefined,
					items: []
				};
			}
			const task = /^\[([ xX])\]\s*(.*)$/.exec(item[3]);
			list.items.push({
				children: inlineNodes(task ? task[2] : item[3]),
				task: Boolean(task),
				checked: Boolean(task && task[1].toLowerCase() === 'x')
			});
			continue;
		}
		flushList();
		flushQuote();
		if (paragraph.length) paragraph.push({ type: 'break' });
		paragraph.push(...inlineNodes(line));
	}

	if (fence) {
		nodes.push(
			fence.language
				? { type: 'code-block', text: fence.lines.join('\n'), language: fence.language }
				: { type: 'code-block', text: fence.lines.join('\n') }
		);
	}
	flushBlocks();
	if (nodes.length === 0) {
		return [{ type: 'paragraph', children: [{ type: 'text', text: body.trim() }] }];
	}
	return nodes;
}

/**
 * What preview should paint before marked finishes.
 * Ready nodes win. Otherwise keep the previous render, or fall back to plain text.
 */
export function selectPreviewNodes(
	source: string,
	previous: MarkdownNode[] | null,
	readyNodes: MarkdownNode[] | null
): MarkdownNode[] {
	if (readyNodes) return readyNodes;
	if (previous) return previous;
	return plainMarkdownNodes(source);
}
