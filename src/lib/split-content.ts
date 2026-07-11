import type { Note } from './types';

export type ContentSplitMode = 'headings' | 'paragraphs' | 'lines';

export type SplitFragment = {
	title: string;
	body: string;
};

function cleanTitle(value: string, fallback: string): string {
	return (
		value
			.replace(/^#{1,6}\s+/, '')
			.replace(/^[-*+]\s+/, '')
			.replace(/^\d+[.)]\s+/, '')
			.trim()
			.slice(0, 200) || fallback
	);
}

function fragmentFromBody(body: string, fallback: string): SplitFragment {
	const first = body.split('\n').find((line) => line.trim()) ?? fallback;
	return { title: cleanTitle(first, fallback), body: body.trim() };
}

function splitByHeadings(note: Note): SplitFragment[] {
	const lines = note.body.replace(/\r\n?/g, '\n').split('\n');
	const fragments: SplitFragment[] = [];
	let title = '';
	let body: string[] = [];
	const prelude: string[] = [];

	const flush = () => {
		if (!title) return;
		fragments.push({ title: cleanTitle(title, note.title), body: body.join('\n').trim() });
		body = [];
	};

	for (const line of lines) {
		const heading = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
		if (!heading) {
			if (title) body.push(line);
			else prelude.push(line);
			continue;
		}
		flush();
		title = heading[1] ?? '';
		if (fragments.length === 0 && prelude.some((line) => line.trim())) {
			body = [prelude.join('\n').trim(), ''];
		}
	}
	flush();
	return fragments;
}

export function splitNoteFragments(note: Note, mode: ContentSplitMode): SplitFragment[] {
	const normalized = note.body.replace(/\r\n?/g, '\n').trim();
	if (!normalized) return [];
	if (mode === 'headings') return splitByHeadings(note);

	const parts =
		mode === 'paragraphs'
			? normalized.split(/\n\s*\n+/).filter((part) => part.trim())
			: normalized.split('\n').filter((line) => line.trim());
	return parts.map((part, index) => fragmentFromBody(part, `${note.title} ${index + 1}`));
}
