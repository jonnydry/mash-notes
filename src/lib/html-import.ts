/**
 * Local HTML → sanitized article HTML for the document reader.
 * No network loads; scripts and active content stripped.
 */

export const HTML_IMPORT_MAX_BYTES = 5 * 1024 * 1024;

export type HtmlImportResult =
	| { ok: true; html: string; title: string }
	| { ok: false; error: string };

const HTML_EXT = /\.html?$/i;
const HTML_MIME = /^(text\/html|application\/xhtml\+xml)$/i;

export function isHtmlFile(file: Pick<File, 'name' | 'type'>): boolean {
	const name = file.name.trim();
	const type = file.type.toLowerCase();
	return HTML_EXT.test(name) || HTML_MIME.test(type);
}

export function htmlTitleFromFileName(name: string): string {
	const base = name.trim().replace(/^.*[/\\]/, '');
	const withoutExt = base.replace(/\.html?$/i, '').trim();
	return (withoutExt || 'HTML document').slice(0, 200);
}

const DANGEROUS_TAGS = new Set([
	'script',
	'iframe',
	'object',
	'embed',
	'link',
	'meta',
	'base',
	'form',
	'input',
	'button',
	'textarea',
	'select',
	'option',
	'frame',
	'frameset',
	'applet'
]);

/** Strip active content; keep readable structure for local user files. */
export function sanitizeHtmlFragment(raw: string): string {
	if (typeof DOMParser === 'undefined') {
		// Node/unit fallback: strip script blocks, event handlers, and unsafe URLs.
		return raw
			.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
			.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
			.replace(
				/\s(href|src|xlink:href)\s*=\s*("|\')\s*(javascript:|data:|vbscript:|\/\/)[^"']*\2/gi,
				''
			)
			.replace(/\s(href|src|xlink:href)\s*=\s*(javascript:|data:|vbscript:|\/\/)[^\s>]*/gi, '')
			.replace(/javascript:/gi, '');
	}
	const parser = new DOMParser();
	const doc = parser.parseFromString(raw, 'text/html');
	const walk = (root: Element | Document) => {
		const nodes = [...root.querySelectorAll('*')];
		for (const el of nodes) {
			const tag = el.tagName.toLowerCase();
			if (DANGEROUS_TAGS.has(tag)) {
				el.remove();
				continue;
			}
			for (const attr of [...el.attributes]) {
				const name = attr.name.toLowerCase();
				const value = attr.value;
				if (name.startsWith('on')) {
					el.removeAttribute(attr.name);
					continue;
				}
				if (name === 'href' || name === 'src' || name === 'xlink:href') {
					const v = value.trim().toLowerCase();
					if (
						v.startsWith('javascript:') ||
						v.startsWith('data:') ||
						v.startsWith('vbscript:') ||
						v.startsWith('//')
					) {
						el.removeAttribute(attr.name);
					}
				}
			}
		}
	};
	walk(doc);
	// Prefer body content; fall back to full document HTML
	const body = doc.body?.innerHTML?.trim();
	if (body) return body;
	return doc.documentElement?.innerHTML?.trim() || '';
}

export function extractHtmlDocumentTitle(raw: string, fileName: string): string {
	const match = raw.match(/<title[^>]*>([^<]*)<\/title>/i);
	const fromTag = match?.[1]?.replace(/\s+/g, ' ').trim();
	if (fromTag) return fromTag.slice(0, 200);
	return htmlTitleFromFileName(fileName);
}

export async function convertHtmlFile(
	input: Blob,
	fileName = input instanceof File ? input.name : 'document.html'
): Promise<HtmlImportResult> {
	if (typeof input.size === 'number' && input.size > HTML_IMPORT_MAX_BYTES) {
		return { ok: false, error: 'This HTML file is too large to open (max 5 MB).' };
	}
	if (fileName && !isHtmlFile({ name: fileName, type: input.type || '' }) && input.type) {
		if (!HTML_MIME.test(input.type)) {
			return { ok: false, error: 'Not an HTML file.' };
		}
	}
	try {
		const raw = await input.text();
		if (!raw.trim()) return { ok: false, error: 'This HTML file is empty.' };
		const title = extractHtmlDocumentTitle(raw, fileName);
		const html = sanitizeHtmlFragment(raw);
		if (!html.trim()) {
			return { ok: false, error: 'No readable content after sanitizing this HTML file.' };
		}
		return { ok: true, html, title };
	} catch {
		return { ok: false, error: 'Couldn’t read this HTML file.' };
	}
}
