/**
 * Typography suites — paired UI + display faces for kitchen chrome and stickies.
 * Default "kitchen" matches the original Mash look (Plex + Fraunces).
 */

import { SvelteSet } from 'svelte/reactivity';

export type TypographySuiteId =
	| 'kitchen'
	| 'editor'
	| 'workshop'
	| 'atelier'
	| 'napkin'
	| 'terminal';

export type TextSizeId = 'compact' | 'comfortable' | 'large';

export type TypographySuite = {
	id: TypographySuiteId;
	label: string;
	hint: string;
	/** CSS font-family stack for UI chrome and sticky body */
	ui: string;
	/** CSS font-family stack for display titles */
	display: string;
	/** Short sample for Settings preview (rendered in display face) */
	sample: string;
};

export const TYPOGRAPHY_STORAGE_KEY = 'mash-typography';
export const TEXT_SIZE_STORAGE_KEY = 'mash-text-size';

export const TEXT_SIZE_OPTIONS: readonly { id: TextSizeId; label: string; hint: string }[] = [
	{ id: 'compact', label: 'Compact', hint: 'More room on screen' },
	{ id: 'comfortable', label: 'Comfortable', hint: 'Balanced and readable' },
	{ id: 'large', label: 'Large', hint: 'Easiest to read' }
] as const;

export const TYPOGRAPHY_SUITES: readonly TypographySuite[] = [
	{
		id: 'kitchen',
		label: 'Kitchen',
		hint: 'Default warm kitchen — Plex + Fraunces',
		ui: "'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif",
		display: "'Fraunces', ui-serif, Georgia, serif",
		sample: 'Scribble a sticky · Mash'
	},
	{
		id: 'editor',
		label: 'Editor',
		hint: 'Calm long-form — Source Sans + Source Serif',
		ui: "'Source Sans 3', ui-sans-serif, system-ui, sans-serif",
		display: "'Source Serif 4', ui-serif, Georgia, serif",
		sample: 'Write for a while · Mash'
	},
	{
		id: 'workshop',
		label: 'Workshop',
		hint: 'Neutral product — Inter + Newsreader',
		ui: "'Inter', ui-sans-serif, system-ui, sans-serif",
		display: "'Newsreader', ui-serif, Georgia, serif",
		sample: 'Build on the desk · Mash'
	},
	{
		id: 'atelier',
		label: 'Atelier',
		hint: 'Soft craft — Nunito Sans + Literata',
		ui: "'Nunito Sans', ui-sans-serif, system-ui, sans-serif",
		display: "'Literata', ui-serif, Georgia, serif",
		sample: 'Notes like a book · Mash'
	},
	{
		id: 'napkin',
		label: 'Napkin',
		hint: 'Handwritten sketch — Excalifont (OFL)',
		ui: "'Excalifont', 'Segoe Print', 'Comic Sans MS', cursive",
		display: "'Excalifont', 'Segoe Print', 'Comic Sans MS', cursive",
		sample: 'Sketch on a napkin · Mash'
	},
	{
		id: 'terminal',
		label: 'Terminal',
		hint: 'All monospace — Plex Mono (typewriter / code desk)',
		ui: "'IBM Plex Mono', ui-monospace, 'Cascadia Code', 'SF Mono', Menlo, Consolas, monospace",
		display:
			"'IBM Plex Mono', ui-monospace, 'Cascadia Code', 'SF Mono', Menlo, Consolas, monospace",
		sample: 'type notes on the wire · Mash'
	}
] as const;

const SUITE_IDS = new Set<string>(TYPOGRAPHY_SUITES.map((s) => s.id));

export function isTypographySuiteId(value: string | null | undefined): value is TypographySuiteId {
	return typeof value === 'string' && SUITE_IDS.has(value);
}

export function suiteById(id: TypographySuiteId): TypographySuite {
	return TYPOGRAPHY_SUITES.find((s) => s.id === id) ?? TYPOGRAPHY_SUITES[0]!;
}

export function readStoredTypography(): TypographySuiteId {
	if (typeof localStorage === 'undefined') return 'kitchen';
	try {
		const raw = localStorage.getItem(TYPOGRAPHY_STORAGE_KEY);
		if (isTypographySuiteId(raw)) return raw;
	} catch {
		/* private mode / blocked storage */
	}
	return 'kitchen';
}

export function isTextSizeId(value: string | null | undefined): value is TextSizeId {
	return value === 'compact' || value === 'comfortable' || value === 'large';
}

export function readStoredTextSize(): TextSizeId {
	if (typeof localStorage === 'undefined') return 'comfortable';
	try {
		const raw = localStorage.getItem(TEXT_SIZE_STORAGE_KEY);
		if (isTextSizeId(raw)) return raw;
	} catch {
		/* private mode / blocked storage */
	}
	return 'comfortable';
}

const loadedFontSuites = new SvelteSet<TypographySuiteId>(['kitchen']);

/** Lazy-load non-default suite font faces so initial CSS stays small. */
export async function ensureTypographyFonts(id: TypographySuiteId): Promise<void> {
	if (loadedFontSuites.has(id)) return;
	switch (id) {
		case 'editor':
			await import('../../routes/fonts-editor.css');
			break;
		case 'workshop':
			await import('../../routes/fonts-workshop.css');
			break;
		case 'atelier':
			await import('../../routes/fonts-atelier.css');
			break;
		case 'napkin':
			await import('../../routes/fonts-napkin.css');
			break;
		case 'terminal':
			await import('../../routes/fonts-terminal.css');
			break;
		default:
			break;
	}
	loadedFontSuites.add(id);
}

export function applyTypography(id: TypographySuiteId): void {
	if (typeof document === 'undefined') return;
	const suite = suiteById(id);
	const root = document.documentElement;
	root.dataset.typography = id;
	root.style.setProperty('--mash-font-ui', suite.ui);
	root.style.setProperty('--mash-font-display', suite.display);
}

export function applyTextSize(id: TextSizeId): void {
	if (typeof document === 'undefined') return;
	document.documentElement.dataset.textSize = id;
}

function createTypographySession(
	initial: TypographySuiteId = readStoredTypography(),
	initialTextSize: TextSizeId = readStoredTextSize()
) {
	let suiteId = $state<TypographySuiteId>(initial);
	let textSize = $state<TextSizeId>(initialTextSize);

	function setSuite(next: TypographySuiteId) {
		suiteId = next;
		try {
			localStorage.setItem(TYPOGRAPHY_STORAGE_KEY, next);
		} catch {
			/* ignore */
		}
		void ensureTypographyFonts(next).then(() => applyTypography(next));
	}

	function setTextSize(next: TextSizeId) {
		textSize = next;
		try {
			localStorage.setItem(TEXT_SIZE_STORAGE_KEY, next);
		} catch {
			/* ignore */
		}
		applyTextSize(next);
	}

	if (typeof document !== 'undefined') {
		applyTextSize(initialTextSize);
		if (initial !== 'kitchen') {
			void ensureTypographyFonts(initial).then(() => applyTypography(initial));
		} else {
			applyTypography(initial);
		}
	}

	return {
		get suiteId() {
			return suiteId;
		},
		get suite() {
			return suiteById(suiteId);
		},
		get suites() {
			return TYPOGRAPHY_SUITES;
		},
		get textSize() {
			return textSize;
		},
		get textSizes() {
			return TEXT_SIZE_OPTIONS;
		},
		setSuite,
		setTextSize
	};
}

/** App-wide singleton — import from layout + Settings. */
export const typography = createTypographySession();
