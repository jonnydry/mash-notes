// @ts-check

/** @typedef {{ name?: string, file: string, imports?: string[], css?: string[], assets?: string[] }} ViteManifestEntry */
/** @typedef {Record<string, ViteManifestEntry>} ViteManifest */
/** @typedef {{ url: string, revision: string | null, size: number }} PrecacheEntry */

export const INITIAL_ENTRY_NAMES = new Set(['entry/start', 'entry/app', 'nodes/0', 'nodes/2']);

const OPTIONAL_BRAND_ASSETS = new Set([
	'icons/mash-monochrome-white.svg',
	'icons/mash-monochrome.svg',
	'icons/mash-wordmark-horizontal.svg'
]);

/** Normalize Workbox URLs and Vite files to one decoded, build-relative path. */
export function normalizePrecacheUrl(/** @type {string} */ url) {
	let normalized = url
		.split(/[?#]/, 1)[0]
		.replace(/^\/+/, '')
		.replace(/^client\//, '');
	try {
		normalized = decodeURIComponent(normalized);
	} catch {
		// A malformed escape is not expected, but leaving it encoded is safer than throwing
		// during a release build and still lets the budget gate report the unexpected path.
	}
	return normalized;
}

/** Assets that are useful on demand but should not inflate every PWA install/update. */
export function isExcludedFromPrecache(/** @type {string} */ url) {
	const normalized = normalizePrecacheUrl(url);
	return (
		normalized.startsWith('icons/Rotating Icons/') ||
		normalized.startsWith('pdfjs/') ||
		OPTIONAL_BRAND_ASSETS.has(normalized)
	);
}

/** Follow only static imports. Dynamic imports remain network/runtime-cache features. */
export function collectInitialManifestKeys(
	/** @type {ViteManifest} */ manifest,
	entryNames = INITIAL_ENTRY_NAMES
) {
	const byName = new Map(
		Object.entries(manifest)
			.filter(([, entry]) => entry.name)
			.map(([key, entry]) => [entry.name, key])
	);
	const keys = new Set();

	function visit(/** @type {string} */ key) {
		if (keys.has(key)) return;
		const entry = manifest[key];
		if (!entry) throw new Error(`Build manifest is missing imported entry ${key}`);
		keys.add(key);
		for (const importedKey of entry.imports ?? []) visit(importedKey);
	}

	for (const name of entryNames) {
		const key = byName.get(name);
		if (!key) throw new Error(`Build manifest is missing initial entry ${name}`);
		visit(key);
	}
	return keys;
}

export function collectInitialManifestFiles(/** @type {ViteManifest} */ manifest) {
	const files = new Set();
	for (const key of collectInitialManifestKeys(manifest)) {
		const entry = manifest[key];
		for (const file of [entry.file, ...(entry.css ?? []), ...(entry.assets ?? [])]) {
			files.add(normalizePrecacheUrl(file));
		}
	}
	return files;
}

/** Lazy chunks that must work offline after one successful visit. */
const PRECACHED_LAZY_ENTRY_NAMES = new Set(['sync-file']);

/**
 * Files the desk-bundle import chunk needs that are not already in the initial graph.
 * Precache them so a later offline import does not fetch the chunk again.
 * They stay out of the first-load JavaScript budget.
 */
export function collectPrecachedLazyFiles(
	/** @type {ViteManifest} */ manifest,
	entryNames = PRECACHED_LAZY_ENTRY_NAMES
) {
	const initialFiles = collectInitialManifestFiles(manifest);
	const byName = new Map(
		Object.entries(manifest)
			.filter(([, entry]) => entry.name)
			.map(([key, entry]) => [entry.name, key])
	);
	/** @type {Set<string>} */
	const files = new Set();
	const seen = new Set();

	function visit(/** @type {string | undefined} */ key) {
		if (!key || seen.has(key)) return;
		seen.add(key);
		const entry = manifest[key];
		if (!entry) return;
		for (const file of [entry.file, ...(entry.css ?? []), ...(entry.assets ?? [])]) {
			const normalized = normalizePrecacheUrl(file);
			if (!initialFiles.has(normalized)) files.add(normalized);
		}
		for (const imported of entry.imports ?? []) visit(imported);
	}

	for (const name of entryNames) visit(byName.get(name));
	return files;
}

/**
 * Deferred chunks that still have to be on disk after one visit.
 * Markdown preview must work offline even if the desk never opened Preview online.
 */
export const PRECACHED_DEFERRED_ENTRY_NAMES = new Set(['marked-runtime']);

/** Files for precached deferred entries, including their static imports outside the initial graph. */
export function collectPrecachedDeferredFiles(/** @type {ViteManifest} */ manifest) {
	const initialKeys = collectInitialManifestKeys(manifest);
	const byName = new Map(
		Object.entries(manifest)
			.filter(([, entry]) => entry.name)
			.map(([key, entry]) => [entry.name, key])
	);
	const keys = new Set();

	function visit(/** @type {string} */ key) {
		if (keys.has(key) || initialKeys.has(key)) return;
		const entry = manifest[key];
		if (!entry) throw new Error(`Build manifest is missing imported entry ${key}`);
		keys.add(key);
		for (const importedKey of entry.imports ?? []) visit(importedKey);
	}

	for (const name of PRECACHED_DEFERRED_ENTRY_NAMES) {
		const key = byName.get(name);
		if (!key) continue;
		visit(key);
	}

	const files = new Set();
	for (const key of keys) {
		const entry = manifest[key];
		for (const file of [entry.file, ...(entry.css ?? []), ...(entry.assets ?? [])]) {
			files.add(normalizePrecacheUrl(file));
		}
	}
	return files;
}

/** Keep the shell, initial graph, offline markdown, precached import chunk, and core assets. */
export function prunePrecacheEntries(
	/** @type {PrecacheEntry[]} */ entries,
	/** @type {ViteManifest} */ manifest
) {
	const initialFiles = collectInitialManifestFiles(manifest);
	const keptLazyFiles = new Set([
		...collectPrecachedLazyFiles(manifest),
		...collectPrecachedDeferredFiles(manifest)
	]);
	return entries.filter((entry) => {
		const file = normalizePrecacheUrl(entry.url);
		// The PWA plugin appends its generated manifest after transforms. Remove the
		// globbed copy here so the final service worker has one canonical revision.
		if (file === 'manifest.webmanifest') return false;
		if (isExcludedFromPrecache(file)) return false;
		if (file.startsWith('_app/immutable/') && !initialFiles.has(file) && !keptLazyFiles.has(file)) {
			return false;
		}
		return true;
	});
}
