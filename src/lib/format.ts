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
	const flat = body
		.replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1')
		.replace(/^#+\s+/gm, '')
		.replace(/```[\s\S]*?```/g, '')
		.replace(/\s+/g, ' ')
		.trim();

	if (!flat) return 'No content yet…';
	return flat.length <= max ? flat : flat.slice(0, max).trimEnd() + '…';
}
