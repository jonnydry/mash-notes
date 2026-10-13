/** Shared URL and HTML guards for markdown preview and print. */

export function escapeAttr(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

export function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/** Allow http(s), mailto, relative paths; block javascript/data/vbscript and protocol-relative URLs. */
export function isSafeHref(href: string | undefined | null): boolean {
	if (!href) return false;
	const trimmed = href.trim();
	if (!trimmed || trimmed.startsWith('#')) return true;
	const lower = trimmed.toLowerCase();
	// Protocol-relative URLs (//evil.example) inherit the page scheme and can phish.
	if (trimmed.startsWith('//')) return false;
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
		// Relative paths without a scheme (no "word:")
		!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)
	);
}

/** Safe image sources for sticky preview — local raster data and mash-blob refs only. */
export function isSafeImageSrc(href: string | undefined | null): boolean {
	if (!href) return false;
	const trimmed = href.trim();
	const lower = trimmed.toLowerCase();
	if (/^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(trimmed)) {
		return true;
	}
	// Out-of-line IndexedDB blobs: mash-blob:<id> (strict id charset).
	if (lower.startsWith('mash-blob:')) {
		const id = trimmed.slice('mash-blob:'.length);
		return /^[A-Za-z0-9_-]{8,128}$/.test(id);
	}
	// Remote images would make opening an imported note leak the reader's IP and referrer.
	return false;
}
