/**
 * Safe markdown rendering for sticky preview and print.
 * Wikilinks [[Title]] become clickable buttons; raw HTML is escaped by marked.
 * The marked library loads from a separate chunk the first time it is needed.
 */
import { escapeAttr, escapeHtml, isSafeImageSrc } from './markdown-sanitize';

export { isSafeHref, isSafeImageSrc } from './markdown-sanitize';

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

export async function renderMarkdown(body: string): Promise<string> {
	const { parseMarkdown } = await import('./marked-runtime');
	const { text, links } = protectWikilinks(body);
	const raw = parseMarkdown(text);
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
