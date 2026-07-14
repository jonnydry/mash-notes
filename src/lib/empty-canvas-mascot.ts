export interface EmptyCanvasMascot {
	src: string;
	srcset?: string;
	width?: number;
	height?: number;
	title: string;
	copy: string;
}

interface VisitStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

const ROTATING_ICON_ROOT = '/icons/Rotating%20Icons/';
const EMPTY_TITLE = 'Paste, drop, or type';
const EMPTY_COPY = 'Press ⌘/Ctrl+V for text, drop files, or use New note.';

const CHARACTER_FILES = [
	['Bacon character sweating@2x.png', 512],
	['Blue flame@2x.png', 512],
	['Bowl of rice (1).png', 256],
	['Broccoli character@2x.png', 512],
	['Cheese character@2x.png', 512],
	['Chive sword@2x.png', 512],
	['Eye repair@2x.png', 512],
	['Fluffy white bread@2x.png', 512],
	['French carrot@2x.png', 512],
	['Fried egg@2x.png', 512],
	['Head of lettuce@2x.png', 512],
	['Kawaii stove flame@2x.png', 512],
	['Little green sprouts@2x.png', 512],
	['Mashed potato character@2x.png', 512],
	['Salt and pepper shakers@2x.png', 512],
	['Same character holding@2x.png', 512],
	['Same character@2x.png', 512],
	['Tomato heart@2x.png', 512],
	['holding-trash-bag@2x.png', 512],
	['mash-screenplay-mascot.png', 256],
	['mash-settings-mascot.png', 256]
] as const;

export const EMPTY_CANVAS_MASCOTS: readonly EmptyCanvasMascot[] = CHARACTER_FILES.map(
	([fileName, size]) => ({
		// Preserve URL-safe filename characters such as "@"; SvelteKit's static preview
		// decodes escaped spaces but treats an escaped @ as a different filename.
		src: `${ROTATING_ICON_ROOT}${encodeURI(fileName)}`,
		width: size,
		height: size,
		title: EMPTY_TITLE,
		copy: EMPTY_COPY
	})
);

export const EMPTY_CANVAS_MASCOT_INDEX_KEY = 'mash.emptyCanvasMascotIndex';

export const DEFAULT_EMPTY_CANVAS_MASCOT: EmptyCanvasMascot = {
	src: '/icons/mash-empty-mascot.png',
	srcset: '/icons/mash-empty-mascot.png 1x, /icons/mash-empty-mascot@2x.png 2x',
	width: 116,
	height: 200,
	title: EMPTY_TITLE,
	copy: EMPTY_COPY
};

function browserSessionStorage(): VisitStorage | null {
	try {
		return typeof sessionStorage === 'undefined' ? null : sessionStorage;
	} catch {
		return null;
	}
}

/** Pick once at page initialization. Session storage prevents an immediate repeat after refresh. */
export function chooseEmptyCanvasMascotForVisit({
	random = Math.random,
	storage = browserSessionStorage()
}: {
	random?: () => number;
	storage?: VisitStorage | null;
} = {}): EmptyCanvasMascot {
	const randomValue = random();
	const boundedRandom = Number.isFinite(randomValue)
		? Math.min(0.999999999, Math.max(0, randomValue))
		: 0;
	let index = Math.floor(boundedRandom * EMPTY_CANVAS_MASCOTS.length);

	try {
		const storedIndex = storage?.getItem(EMPTY_CANVAS_MASCOT_INDEX_KEY);
		const previousIndex = storedIndex == null ? Number.NaN : Number(storedIndex);
		if (
			Number.isInteger(previousIndex) &&
			previousIndex >= 0 &&
			previousIndex < EMPTY_CANVAS_MASCOTS.length &&
			previousIndex === index
		) {
			index = (index + 1) % EMPTY_CANVAS_MASCOTS.length;
		}
		storage?.setItem(EMPTY_CANVAS_MASCOT_INDEX_KEY, String(index));
	} catch {
		// Storage can be disabled; random selection should still work.
	}

	return EMPTY_CANVAS_MASCOTS[index] ?? DEFAULT_EMPTY_CANVAS_MASCOT;
}
