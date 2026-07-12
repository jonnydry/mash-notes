/**
 * Local-first URL source cards — paste http(s) links as mashable provenance stickies.
 * No network fetch for titles in v1.
 */
import type { NoteSource } from './types';

export const URL_SOURCE_MAX_PER_PASTE = 50;

export type UrlCardDraft = {
	title: string;
	body: string;
	source: NoteSource & { kind: 'url' };
};

/** Normalize a single line into an http(s) URL, or null. */
export function parseHttpUrl(line: string): string | null {
	const trimmed = line.trim();
	if (!trimmed || /\s/.test(trimmed)) return null;
	let candidate = trimmed;
	// Bare www. → https
	if (/^www\./i.test(candidate)) {
		candidate = `https://${candidate}`;
	}
	if (!/^https?:\/\//i.test(candidate)) return null;
	try {
		const url = new URL(candidate);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
		if (!url.hostname) return null;
		return url.href;
	} catch {
		return null;
	}
}

export function urlCardTitle(href: string): string {
	try {
		const host = new URL(href).hostname.replace(/^www\./i, '');
		return (host || 'Link').slice(0, 200);
	} catch {
		return 'Link';
	}
}

export function urlNoteSource(href: string, title?: string): NoteSource & { kind: 'url' } {
	const resolvedTitle = (title?.trim() || urlCardTitle(href)).slice(0, 300) || 'Link';
	return {
		kind: 'url',
		title: resolvedTitle,
		url: href
	};
}

export function urlNoteBody(href: string, title?: string): string {
	const label = (title?.trim() || urlCardTitle(href)).slice(0, 200) || 'Link';
	return `[${label}](${href})\n\n${href}`;
}

export function urlCardDraft(href: string): UrlCardDraft {
	const title = urlCardTitle(href);
	return {
		title,
		body: urlNoteBody(href, title),
		source: urlNoteSource(href, title)
	};
}

/**
 * If every non-empty line is an http(s) URL, return drafts (capped).
 * Otherwise null — caller should use normal text paste.
 */
export function draftsFromUrlOnlyText(raw: string): UrlCardDraft[] | null {
	const text = raw.replace(/\r\n?/g, '\n').trim();
	if (!text) return null;
	const lines = text
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
	if (lines.length === 0) return null;

	const hrefs: string[] = [];
	for (const line of lines) {
		const href = parseHttpUrl(line);
		if (!href) return null;
		hrefs.push(href);
	}

	const capped = hrefs.slice(0, URL_SOURCE_MAX_PER_PASTE);
	return capped.map((href) => urlCardDraft(href));
}
