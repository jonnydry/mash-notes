/**
 * On-demand markdown engine. Imported only through a dynamic import so `marked`
 * stays out of the first-load graph. Preview and print share this module instance.
 */
import { marked, type Tokens } from 'marked';
import { escapeAttr, escapeHtml, isSafeHref, isSafeImageSrc } from './markdown-sanitize';

marked.use({
	gfm: true,
	breaks: true,
	renderer: {
		html({ text }: Tokens.HTML | Tokens.Tag) {
			return escapeHtml(text);
		},
		link({ href, title, text }: Tokens.Link) {
			const safeHref = isSafeHref(href) ? href! : '#';
			const t = title ? ` title="${escapeAttr(title)}"` : '';
			return `<a href="${escapeAttr(safeHref)}"${t} rel="noopener noreferrer" target="_blank">${text}</a>`;
		},
		image({ href, title, text }: Tokens.Image) {
			if (!isSafeImageSrc(href)) return '';
			const t = title ? ` title="${escapeAttr(title)}"` : '';
			const alt = escapeAttr(text || 'Image');
			return `<img src="${escapeAttr(href!)}" alt="${alt}"${t} loading="lazy" />`;
		}
	}
});

export function parseMarkdown(text: string): string {
	return marked.parse(text, { async: false }) as string;
}

export function lexMarkdown(body: string): unknown[] {
	if (typeof body !== 'string') {
		throw new Error('mash-marked-runtime-v1 expected a string');
	}
	return marked.lexer(body);
}
