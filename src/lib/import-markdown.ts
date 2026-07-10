/**
 * Import notes from markdown vaults (Obsidian folders, Bear .md exports).
 * Pure transforms — no DB/UI imports.
 */
import { extractWikilinks } from './markdown';
import type { Note } from './types';

const MAX_NOTES = 5000;
const MAX_BODY = 500_000;
const MAX_TITLE = 200;
const MAX_TAGS = 50;
const MAX_TAG_LEN = 64;
const MAX_FOLDER = 200;
/** Skip hidden / app metadata trees inside vaults. */
const SKIP_PATH_RE = /(^|\/)(\.obsidian|\.trash|\.git|node_modules)(\/|$)/i;

export type MarkdownImportFile = {
	/** Relative path using `/` (e.g. vault/folder/note.md or note.md). */
	path: string;
	text: string;
	/** Epoch ms; used when frontmatter has no dates. */
	lastModified?: number;
};

export type MarkdownImportResult =
	| { ok: true; notes: Note[]; skipped: number }
	| { ok: false; error: string };

export type ParsedFrontmatter = {
	title?: string;
	tags: string[];
	created?: number;
	modified?: number;
	pinned?: 0 | 1;
	/** Body with frontmatter fence removed. */
	body: string;
};

/** True for markdown note files we should import. */
export function isMarkdownNotePath(path: string): boolean {
	const normalized = path.replace(/\\/g, '/');
	if (SKIP_PATH_RE.test(normalized)) return false;
	if (!/\.md$/i.test(normalized)) return false;
	// Obsidian canvas / base files sometimes sit beside notes — only .md.
	return true;
}

/**
 * Split path into Mash folder + default title.
 * Drops the first segment when the path looks like a picked vault root
 * (`MyVault/Ideas/a.md` → folder `Ideas`, title `a`).
 */
export function pathToFolderAndTitle(path: string): { folder: string; title: string } {
	const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
	if (parts.length > 1) {
		// webkitdirectory paths always include the selected folder name as root.
		parts.shift();
	}
	const fileName = parts.pop() ?? 'Untitled.md';
	const title = fileName.replace(/\.md$/i, '') || 'Untitled';
	const folder = parts.join('/').slice(0, MAX_FOLDER);
	return { folder, title };
}

function parseScalarDate(raw: string): number | undefined {
	const trimmed = raw.trim().replace(/^["']|["']$/g, '');
	if (!trimmed) return undefined;
	if (/^\d{9,13}$/.test(trimmed)) {
		const n = Number(trimmed);
		return Number.isFinite(n) ? (trimmed.length <= 10 ? n * 1000 : n) : undefined;
	}
	const ms = Date.parse(trimmed);
	return Number.isFinite(ms) ? ms : undefined;
}

function normalizeTag(raw: string): string | null {
	const t = raw
		.trim()
		.replace(/^#/, '')
		.replace(/^["']|["']$/g, '')
		.slice(0, MAX_TAG_LEN);
	return t || null;
}

function parseTagsValue(raw: string): string[] {
	const trimmed = raw.trim();
	if (!trimmed) return [];
	// [a, b] or ["a", "b"]
	if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
		return trimmed
			.slice(1, -1)
			.split(',')
			.map((s) => normalizeTag(s))
			.filter((t): t is string => Boolean(t));
	}
	return [normalizeTag(trimmed)].filter((t): t is string => Boolean(t));
}

/**
 * Minimal YAML frontmatter reader for common Obsidian / export keys.
 * Supports scalars, inline arrays, and simple `- item` lists for tags.
 */
export function parseFrontmatter(text: string): ParsedFrontmatter {
	const empty: ParsedFrontmatter = { tags: [], body: text };
	if (!text.startsWith('---')) return empty;
	const end = text.indexOf('\n---', 3);
	if (end === -1) return empty;
	const fence = text.slice(3, end).replace(/^\r?\n/, '');
	let body = text.slice(end + 4).replace(/^\r?\n/, '');

	const tags: string[] = [];
	let title: string | undefined;
	let created: number | undefined;
	let modified: number | undefined;
	let pinned: 0 | 1 | undefined;
	let listKey: 'tags' | null = null;

	for (const line of fence.split(/\r?\n/)) {
		const listItem = line.match(/^\s*-\s+(.+)$/);
		if (listKey && listItem) {
			const t = normalizeTag(listItem[1]);
			if (t) tags.push(t);
			continue;
		}
		listKey = null;

		const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
		if (!kv) continue;
		const key = kv[1].toLowerCase();
		const value = kv[2] ?? '';

		if (key === 'title' || key === 'name') {
			const t = value.trim().replace(/^["']|["']$/g, '');
			if (t) title = t.slice(0, MAX_TITLE);
		} else if (key === 'tags' || key === 'tag') {
			if (!value.trim()) {
				listKey = 'tags';
			} else {
				tags.push(...parseTagsValue(value));
			}
		} else if (key === 'created' || key === 'createdat' || key === 'date') {
			created = parseScalarDate(value) ?? created;
		} else if (key === 'modified' || key === 'updated' || key === 'updatedat') {
			modified = parseScalarDate(value) ?? modified;
		} else if (key === 'pinned' || key === 'favorite') {
			const v = value.trim().toLowerCase();
			pinned = v === 'true' || v === 'yes' || v === '1' ? 1 : 0;
		}
	}

	return { title, tags, created, modified, pinned, body };
}

/** First ATX H1 in the body, if any. */
export function firstHeadingTitle(body: string): string | undefined {
	for (const line of body.split(/\r?\n/)) {
		const m = line.match(/^#\s+(.+?)\s*$/);
		if (m) return m[1].trim().slice(0, MAX_TITLE) || undefined;
	}
	return undefined;
}

/**
 * Bear / Obsidian inline tags: #tag, #nested/tag (not headings, not mid-word).
 */
export function extractInlineTags(body: string): string[] {
	const tags: string[] = [];
	const seen = new Set<string>();
	const re = /(^|[\s([{])#([A-Za-z0-9_][A-Za-z0-9_/-]*)/g;
	for (const match of body.matchAll(re)) {
		const raw = match[2];
		// Skip pure numeric tags like #1
		if (/^\d+$/.test(raw)) continue;
		const t = normalizeTag(raw);
		if (!t || seen.has(t)) continue;
		seen.add(t);
		tags.push(t);
	}
	return tags;
}

function mergeTags(...groups: string[][]): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const group of groups) {
		for (const t of group) {
			const n = normalizeTag(t);
			if (!n || seen.has(n)) continue;
			seen.add(n);
			out.push(n);
			if (out.length >= MAX_TAGS) return out;
		}
	}
	return out;
}

/** Convert one markdown file into a Mash note. */
export function markdownFileToNote(file: MarkdownImportFile, now = Date.now()): Note {
	const { folder, title: pathTitle } = pathToFolderAndTitle(file.path);
	const fm = parseFrontmatter(file.text);
	const body = fm.body.slice(0, MAX_BODY);
	// Prefer frontmatter, then first heading (Bear), then filename (Obsidian).
	const title =
		(fm.title?.trim() || firstHeadingTitle(body) || pathTitle || 'Untitled').slice(0, MAX_TITLE) ||
		'Untitled';
	const tags = mergeTags(fm.tags, extractInlineTags(body));
	const fileTime =
		file.lastModified && Number.isFinite(file.lastModified) ? file.lastModified : now;
	const created = fm.created ?? fileTime;
	const modified = fm.modified ?? fileTime;
	return {
		id: crypto.randomUUID(),
		title,
		body,
		folder,
		tags,
		created,
		modified,
		pinned: fm.pinned ?? 0,
		links: extractWikilinks(body)
	};
}

/**
 * Parse a vault / export folder of markdown files into Mash notes.
 */
export function parseMarkdownVault(files: MarkdownImportFile[]): MarkdownImportResult {
	const mdFiles = files.filter((f) => isMarkdownNotePath(f.path));
	const skipped = files.length - mdFiles.length;
	if (mdFiles.length === 0) {
		return { ok: false, error: 'No markdown notes found' };
	}
	if (mdFiles.length > MAX_NOTES) {
		return { ok: false, error: `Too many notes (max ${MAX_NOTES})` };
	}

	const notes: Note[] = [];
	const now = Date.now();
	for (const file of mdFiles) {
		if (file.text.length > MAX_BODY * 2) {
			return {
				ok: false,
				error: `Note “${pathToFolderAndTitle(file.path).title}” is too large`
			};
		}
		notes.push(markdownFileToNote(file, now));
	}
	return { ok: true, notes, skipped };
}

/**
 * Build import payloads from a browser FileList (folder or multi-file pick).
 */
export async function filesFromFileList(
	list: FileList | File[],
	opts?: { allowPlainText?: boolean }
): Promise<MarkdownImportFile[]> {
	const files = Array.from(list);
	const out: MarkdownImportFile[] = [];
	for (const file of files) {
		let path = ('webkitRelativePath' in file && file.webkitRelativePath) || file.name;
		if (opts?.allowPlainText && /\.(markdown|txt)$/i.test(path)) {
			// Reuse the Markdown note parser while preserving the original basename.
			path = path.replace(/\.(markdown|txt)$/i, '.md');
		}
		if (!isMarkdownNotePath(path)) continue;
		out.push({
			path,
			text: await file.text(),
			lastModified: file.lastModified
		});
	}
	return out;
}
