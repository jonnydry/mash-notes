/**
 * Local HTML → sanitized article HTML for the document reader.
 * No network loads; scripts and active content stripped.
 */

export const HTML_IMPORT_MAX_BYTES = 5 * 1024 * 1024;

export type HtmlImportResult =
	{ ok: true; html: string; title: string } | { ok: false; error: string };

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

/** Elements whose contents must never survive sanitization. */
const BLOCKED_TAGS = new Set([
	'script',
	'style',
	'template',
	'noscript',
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
	'applet',
	'svg',
	'math',
	'canvas',
	'video',
	'audio',
	'source',
	'track',
	'picture'
]);

/** Deliberately small reading-format allowlist. Unknown markup is unwrapped as text. */
const ALLOWED_TAGS = new Set([
	'a',
	'abbr',
	'article',
	'b',
	'blockquote',
	'br',
	'caption',
	'code',
	'col',
	'colgroup',
	'dd',
	'del',
	'details',
	'div',
	'dl',
	'dt',
	'em',
	'figcaption',
	'figure',
	'footer',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'header',
	'hr',
	'i',
	'img',
	'ins',
	'kbd',
	'li',
	'main',
	'mark',
	'ol',
	'p',
	'pre',
	'q',
	's',
	'samp',
	'section',
	'small',
	'span',
	'strong',
	'sub',
	'summary',
	'sup',
	'table',
	'tbody',
	'td',
	'tfoot',
	'th',
	'thead',
	'tr',
	'u',
	'ul',
	'var'
]);

const GLOBAL_ATTRIBUTES = new Set(['title']);
const TAG_ATTRIBUTES: Readonly<Record<string, ReadonlySet<string>>> = {
	a: new Set(['href']),
	col: new Set(['span']),
	colgroup: new Set(['span']),
	details: new Set(['open']),
	img: new Set(['src', 'alt', 'width', 'height']),
	li: new Set(['value']),
	ol: new Set(['start', 'reversed']),
	td: new Set(['colspan', 'rowspan']),
	th: new Set(['colspan', 'rowspan', 'scope'])
};

export type HtmlSanitizeOptions = {
	/** DOCX conversion emits trusted local raster bytes as data URIs. */
	allowDataImages?: boolean;
};

const SAFE_DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|bmp);base64,[a-z0-9+/=\s]+$/i;

function escapeHtml(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function safeLinkHref(value: string): boolean {
	const href = value.trim();
	if (!href) return false;
	if (href.startsWith('#')) return true;
	return /^(?:https?:|mailto:)/i.test(href);
}

function allowedDataImage(tag: string, name: string, value: string, options: HtmlSanitizeOptions) {
	return (
		options.allowDataImages === true &&
		tag === 'img' &&
		name === 'src' &&
		SAFE_DATA_IMAGE.test(value.trim())
	);
}

function extractFallbackTextAndImages(
	raw: string,
	options: HtmlSanitizeOptions,
	preservedImages: string[]
): string {
	let result = '';
	let cursor = 0;
	while (cursor < raw.length) {
		const tagStart = raw.indexOf('<', cursor);
		if (tagStart === -1) {
			result += raw.slice(cursor);
			break;
		}
		result += raw.slice(cursor, tagStart);
		const tagEnd = raw.indexOf('>', tagStart + 1);
		if (tagEnd === -1) {
			result += raw.slice(tagStart);
			break;
		}

		const tag = raw.slice(tagStart, tagEnd + 1);
		const tagName = tag
			.slice(1)
			.trimStart()
			.split(/[\s/>]/, 1)[0]
			?.toLowerCase();
		if (options.allowDataImages === true && tagName === 'img') {
			const match = tag.match(/\bsrc\s*=\s*(["'])([^"']+)\1/i);
			const src = match?.[2]?.trim() ?? '';
			if (SAFE_DATA_IMAGE.test(src)) {
				const index = preservedImages.push(src) - 1;
				result += `__MASH_DATA_IMAGE_${index}__`;
			}
		}
		cursor = tagEnd + 1;
	}
	return result;
}

/** Strip active content; keep readable structure for local user files. */
export function sanitizeHtmlFragment(raw: string, options: HtmlSanitizeOptions = {}): string {
	if (typeof DOMParser === 'undefined') {
		// Conservative non-browser fallback: discard tags, escape the extracted text,
		// and reintroduce only approved local raster images that we construct ourselves.
		const preservedImages: string[] = [];
		const withImageTokens = extractFallbackTextAndImages(raw, options, preservedImages);
		const text = escapeHtml(withImageTokens);
		return text.replace(/__MASH_DATA_IMAGE_(\d+)__/g, (_match, index: string) => {
			const src = preservedImages[Number(index)];
			return src ? `<img src="${src}" alt="" loading="lazy" decoding="async">` : '';
		});
	}
	const parser = new DOMParser();
	const doc = parser.parseFromString(raw, 'text/html');
	const walk = (root: Element) => {
		const nodes = [...root.querySelectorAll('*')];
		for (const el of nodes) {
			const tag = el.tagName.toLowerCase();
			if (BLOCKED_TAGS.has(tag) || el.namespaceURI !== 'http://www.w3.org/1999/xhtml') {
				el.remove();
				continue;
			}
			if (!ALLOWED_TAGS.has(tag)) {
				el.replaceWith(...el.childNodes);
				continue;
			}
			for (const attr of [...el.attributes]) {
				const name = attr.name.toLowerCase();
				const tagAttributes = TAG_ATTRIBUTES[tag];
				if (!GLOBAL_ATTRIBUTES.has(name) && !tagAttributes?.has(name)) {
					el.removeAttribute(attr.name);
					continue;
				}
				if (tag === 'a' && name === 'href' && !safeLinkHref(attr.value)) {
					el.removeAttribute(attr.name);
				}
				if (tag === 'img' && name === 'src' && !allowedDataImage(tag, name, attr.value, options)) {
					el.removeAttribute(attr.name);
				}
			}
			if (tag === 'a' && el.hasAttribute('href')) {
				el.setAttribute('target', '_blank');
				el.setAttribute('rel', 'noopener noreferrer');
			}
			if (tag === 'img') {
				if (!el.hasAttribute('src')) {
					el.replaceWith(doc.createTextNode(el.getAttribute('alt') ?? ''));
					continue;
				}
				el.setAttribute('loading', 'lazy');
				el.setAttribute('decoding', 'async');
			}
		}
	};
	// Sanitize only the parsed fragment. Walking the whole document would also visit
	// the browser-created <html>/<head>/<body> wrappers and could detach the body.
	walk(doc.body);
	const body = doc.body?.innerHTML?.trim();
	if (body) return body;
	return '';
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
