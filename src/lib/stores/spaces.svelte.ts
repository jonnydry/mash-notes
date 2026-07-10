/**
 * Open Spaces — session set of folder/pinned canvases the user is working across.
 * Desk ('' ) is always present and never closable. Persisted in localStorage only.
 */
import {
	PINNED_CANVAS_KEY,
	isPinnedCanvasKey,
	canvasTitleFromFilter
} from '$lib/stores/note-library.svelte';
import type { NavFilter } from '$lib/note-ui';

export const OPEN_SPACES_STORAGE_KEY = 'mash.openSpaces';

/** Root Desk canvas key — always open. */
export const DESK_SPACE_KEY = '';

export function spaceTitleForKey(key: string): string {
	if (key === DESK_SPACE_KEY) return 'Desk';
	if (isPinnedCanvasKey(key)) return 'Pinned';
	return key;
}

/** Screenplay folder (or nested path) — reserved helper for folder-named boards. */
export function isScreenplaySpaceKey(key: string): boolean {
	return /^(Screenplay)(\/|$)/i.test(key);
}

/** Map a space key to the nav filter that loads that canvas. */
export function filterFromSpaceKey(key: string): NavFilter {
	if (key === DESK_SPACE_KEY) return { type: null };
	if (isPinnedCanvasKey(key)) return { type: 'pinned' };
	return { type: 'folder', value: key };
}

/** Whether this canvas key should appear in / be added to open Spaces. */
export function isSpaceKey(key: string): boolean {
	return key === DESK_SPACE_KEY || isPinnedCanvasKey(key) || key.length > 0;
}

/** Tag filters share Desk — they are not Spaces. */
export function spaceKeyFromFilter(filter: NavFilter): string | null {
	if (filter.type === 'tag') return null;
	if (filter.type === 'pinned') return PINNED_CANVAS_KEY;
	if (filter.type === 'folder' && filter.value !== undefined) return filter.value;
	return DESK_SPACE_KEY;
}

export function normalizeOpenKeys(keys: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [DESK_SPACE_KEY];
	seen.add(DESK_SPACE_KEY);
	for (const key of keys) {
		if (typeof key !== 'string') continue;
		if (key === DESK_SPACE_KEY) continue;
		if (!isSpaceKey(key)) continue;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(key);
	}
	return out;
}

export function readOpenSpaces(): string[] {
	if (typeof localStorage === 'undefined') return [DESK_SPACE_KEY];
	try {
		const raw = localStorage.getItem(OPEN_SPACES_STORAGE_KEY);
		if (!raw) return [DESK_SPACE_KEY];
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [DESK_SPACE_KEY];
		return normalizeOpenKeys(parsed.filter((k): k is string => typeof k === 'string'));
	} catch {
		return [DESK_SPACE_KEY];
	}
}

export function writeOpenSpaces(keys: string[]): void {
	if (typeof localStorage === 'undefined') return;
	try {
		const normalized = normalizeOpenKeys(keys);
		localStorage.setItem(OPEN_SPACES_STORAGE_KEY, JSON.stringify(normalized));
	} catch {
		/* ignore quota / private mode */
	}
}

/** Add key to open set (idempotent). Desk is always included. */
export function openSpaceInList(keys: string[], key: string): string[] {
	if (!isSpaceKey(key)) return normalizeOpenKeys(keys);
	if (key === DESK_SPACE_KEY) return normalizeOpenKeys(keys);
	if (keys.includes(key)) return normalizeOpenKeys(keys);
	return normalizeOpenKeys([...keys, key]);
}

/**
 * Remove a space. Desk cannot be closed.
 * Returns next keys + which key to switch to if the closed one was active.
 */
export function closeSpaceInList(
	keys: string[],
	key: string,
	activeKey: string
): { keys: string[]; nextActive: string | null } {
	if (key === DESK_SPACE_KEY) {
		return { keys: normalizeOpenKeys(keys), nextActive: null };
	}
	const next = normalizeOpenKeys(keys.filter((k) => k !== key));
	if (activeKey !== key) {
		return { keys: next, nextActive: null };
	}
	// Prefer previous open space in the list, else Desk.
	const idx = keys.indexOf(key);
	const before = idx > 0 ? keys[idx - 1]! : DESK_SPACE_KEY;
	const fallback = next.includes(before) ? before : DESK_SPACE_KEY;
	return { keys: next, nextActive: fallback };
}

export type CreateOpenSpacesOpts = {
	/** Apply a space key as the active canvas filter (no toggle). */
	applySpaceKey: (key: string) => void;
	getActiveKey: () => string;
};

export function createOpenSpaces(opts: CreateOpenSpacesOpts) {
	let openKeys = $state<string[]>(readOpenSpaces());

	function persist() {
		writeOpenSpaces(openKeys);
	}

	function openSpace(key: string) {
		const next = openSpaceInList(openKeys, key);
		if (next.length === openKeys.length && next.every((k, i) => k === openKeys[i])) return;
		openKeys = next;
		persist();
	}

	/** Ensure the current canvas key is in the open set (folder / pinned / desk). */
	function ensureFromActiveKey(key: string) {
		if (key === DESK_SPACE_KEY) return;
		if (!isSpaceKey(key)) return;
		openSpace(key);
	}

	function closeSpace(key: string) {
		const active = opts.getActiveKey();
		const { keys, nextActive } = closeSpaceInList(openKeys, key, active);
		openKeys = keys;
		persist();
		if (nextActive !== null) {
			opts.applySpaceKey(nextActive);
		}
	}

	function switchTo(key: string) {
		openSpace(key);
		opts.applySpaceKey(key);
	}

	function removeSpace(key: string) {
		if (key === DESK_SPACE_KEY) return;
		openKeys = normalizeOpenKeys(openKeys.filter((k) => k !== key));
		persist();
	}

	return {
		get openKeys() {
			return openKeys;
		},
		openSpace,
		ensureFromActiveKey,
		closeSpace,
		switchTo,
		removeSpace,
		titleFor: spaceTitleForKey
	};
}

/** Re-export title helper used by UI that already has filter titles. */
export function titleForSpaceKey(key: string): string {
	return canvasTitleFromFilter(filterFromSpaceKey(key));
}
