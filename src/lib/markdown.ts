/**
 * Safe markdown rendering for sticky preview.
 * Wikilinks [[Title]] become clickable buttons; raw HTML is escaped by marked.
 */
import { marked, type Tokens } from 'marked';

const WIKILINK_RE = /\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/g;

export function extractWikilinks(body: string): string[] {
	const links: string[] = [];
	const seen = new Set<string>();
	for (const match of body.matchAll(WIKILINK_RE)) {
		const target = match[1].trim();
		if (!target || seen.has(target)) continue;
		seen.add(target);
		links.push(target);
	}
	return links;
}

function escapeAttr(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/** Allow http(s), mailto, relative paths; block javascript/data/vbscript. */
export function isSafeHref(href: string | undefined | null): boolean {
	if (!href) return false;
	const trimmed = href.trim();
	if (!trimmed || trimmed.startsWith('#')) return true;
	const lower = trimmed.toLowerCase();
	if (
		lower.startsWith('javascript:') ||
		lower.startsWith('data:') ||
		lower.startsWith('vbscript:')
	) {
		return false;
	}
	return (
		lower.startsWith('http://') ||
		lower.startsWith('https://') ||
		lower.startsWith('mailto:') ||
		lower.startsWith('/') ||
		lower.startsWith('./') ||
		lower.startsWith('../') ||
		!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)
	);
}

/** Safe image sources for sticky preview — allows local data-URL clipping PNGs. */
export function isSafeImageSrc(href: string | undefined | null): boolean {
	if (!href) return false;
	const lower = href.trim().toLowerCase();
	if (
		lower.startsWith('data:image/png;base64,') ||
		lower.startsWith('data:image/jpeg;base64,') ||
		lower.startsWith('data:image/webp;base64,') ||
		lower.startsWith('data:image/gif;base64,')
	) {
		return true;
	}
	return isSafeHref(href);
}

/** Replace wikilinks with placeholders before markdown, restore as buttons after. */
function protectWikilinks(src: string): {
	text: string;
	links: Array<{ target: string; label: string }>;
} {
	const links: Array<{ target: string; label: string }> = [];
	const text = src.replace(WIKILINK_RE, (_m, target: string, label?: string) => {
		const t = target.trim();
		const l = (label ?? target).trim();
		const i = links.length;
		links.push({ target: t, label: l });
		return `§§MASHLINK${i}§§`;
	});
	return { text, links };
}

function restoreWikilinks(html: string, links: Array<{ target: string; label: string }>): string {
	return html.replace(/§§MASHLINK(\d+)§§/g, (_m, idx) => {
		const link = links[Number(idx)];
		if (!link) return '';
		return `<button type="button" class="mash-wikilink" data-wikilink="${escapeAttr(link.target)}">${escapeHtml(link.label)}</button>`;
	});
}

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

export function renderMarkdown(body: string): string {
	const { text, links } = protectWikilinks(body);
	const raw = marked.parse(text, { async: false }) as string;
	return restoreWikilinks(raw, links);
}

/** Leading markdown image — used for PDF region clippings and similar visual notes. */
export type EmbeddedNoteImage = {
	alt: string;
	src: string;
	caption: string;
};

const LEADING_IMAGE_RE = /^!\[([^\]]*)\]\(([^)\s]+)\)/;

export function parseEmbeddedNoteImage(body: string): EmbeddedNoteImage | null {
	const trimmed = body.trimStart();
	const match = trimmed.match(LEADING_IMAGE_RE);
	if (!match) return null;
	const alt = match[1] ?? '';
	const src = (match[2] ?? '').trim();
	if (!isSafeImageSrc(src)) return null;
	const caption = trimmed.slice(match[0].length).replace(/^\s+/, '');
	return { alt, src, caption };
}

export function composeEmbeddedNoteImage(alt: string, src: string, caption: string): string {
	const img = `![${alt}](${src})`;
	const cap = caption.trim();
	return cap ? `${img}\n\n${cap}` : img;
}
