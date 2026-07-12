import { parseEmbeddedNoteImage } from './markdown';

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export function formatNoteTimestamp(ms: number, now = Date.now()): string {
	const diff = Math.round((now - ms) / 1000);
	const abs = Math.abs(diff);

	if (abs < 60) return 'now';
	const min = Math.round(diff / 60);
	if (Math.abs(min) < 60) return rtf.format(-min, 'minute');
	const hr = Math.round(min / 60);
	if (Math.abs(hr) < 24) return rtf.format(-hr, 'hour');
	const day = Math.round(hr / 24);
	if (Math.abs(day) < 7) return rtf.format(-day, 'day');

	return new Date(ms).toLocaleDateString(undefined, {
		month: 'short',
		day: 'numeric',
		year: ms < now - 365 * 864e5 ? 'numeric' : undefined
	});
}

export function notePreview(body: string, max = 92): string {
	// Avoid scanning multi‑MB data-URL bodies; mash-blob: bodies are already short.
	if (
		body.startsWith('![') &&
		(body.includes('data:image') || body.includes('mash-blob:'))
	) {
		const embedded = parseEmbeddedNoteImage(body);
		if (embedded?.caption.trim()) {
			const cap = embedded.caption
				.replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1')
				.replace(/^#+\s+/gm, '')
				.replace(/\s+/g, ' ')
				.trim();
			if (cap) return cap.length <= max ? cap : cap.slice(0, max).trimEnd() + '…';
		}
		if (embedded?.alt.trim()) return embedded.alt.trim().slice(0, max);
		return 'Image';
	}

	const embedded = parseEmbeddedNoteImage(body);
	const flat = body
		.replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
		.replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1')
		.replace(/^#+\s+/gm, '')
		.replace(/```[\s\S]*?```/g, '')
		.replace(/\s+/g, ' ')
		.trim();

	if (!flat) {
		if (embedded?.alt.trim()) return embedded.alt.trim();
		if (embedded) return 'Image';
		return 'No content yet…';
	}
	return flat.length <= max ? flat : flat.slice(0, max).trimEnd() + '…';
}

/** Scratch note with no real content — safe to discard when closed from the canvas. */
export function isBlankUntitledNote(note: {
	title: string;
	body: string;
	tags?: string[];
	mashedFrom?: string[];
	pinned?: number;
}): boolean {
	const title = note.title.trim();
	const blankTitle = title === '' || title === 'Untitled';
	if (!blankTitle) return false;
	if (note.body.trim() !== '') return false;
	if ((note.tags?.length ?? 0) > 0) return false;
	if ((note.mashedFrom?.length ?? 0) > 0) return false;
	if (note.pinned === 1) return false;
	return true;
}
