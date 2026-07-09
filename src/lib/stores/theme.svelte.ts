/**
 * Kitchen theme — day (light) / night (dark) modes.
 * Stickies stay parchment; chrome + canvas invert around them.
 */
export type MashTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'mash-theme';

export const THEME_META_COLOR: Record<MashTheme, string> = {
	light: '#efe6d8',
	dark: '#0e0c0a'
};

export function isMashTheme(value: string | null | undefined): value is MashTheme {
	return value === 'light' || value === 'dark';
}

export function readStoredTheme(): MashTheme {
	if (typeof localStorage === 'undefined') return 'dark';
	try {
		const raw = localStorage.getItem(THEME_STORAGE_KEY);
		if (isMashTheme(raw)) return raw;
	} catch {
		/* private mode / blocked storage */
	}
	return 'dark';
}

export function applyTheme(theme: MashTheme): void {
	if (typeof document === 'undefined') return;
	document.documentElement.dataset.theme = theme;
	document.documentElement.style.colorScheme = theme;
	const meta = document.querySelector('meta[name="theme-color"]');
	if (meta) meta.setAttribute('content', THEME_META_COLOR[theme]);
}

function createThemeSession(initial: MashTheme = readStoredTheme()) {
	let mode = $state<MashTheme>(initial);

	function setMode(next: MashTheme) {
		mode = next;
		try {
			localStorage.setItem(THEME_STORAGE_KEY, next);
		} catch {
			/* ignore */
		}
		applyTheme(next);
	}

	function toggle() {
		setMode(mode === 'dark' ? 'light' : 'dark');
	}

	if (typeof document !== 'undefined') {
		applyTheme(initial);
	}

	return {
		get mode() {
			return mode;
		},
		get metaColor() {
			return THEME_META_COLOR[mode];
		},
		setMode,
		toggle
	};
}

/** App-wide singleton — import from layout + page. */
export const theme = createThemeSession();
