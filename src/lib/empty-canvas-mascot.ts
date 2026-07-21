export interface EmptyCanvasMascot {
	src: string;
	srcset?: string;
	width?: number;
	height?: number;
	title: string;
	copy: string;
	/** Index in the later-visit rotation pool; absent for fixed-purpose mascots. */
	rotationIndex?: number;
}

interface VisitStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

const ROTATING_ICON_ROOT = '/icons/Rotating%20Icons/';
const EMPTY_TITLE = 'Paste, drop, or type';
const EMPTY_COPY = 'Press ⌘/Ctrl+V for text, drop files, or use New note.';

const CHARACTER_FILES = [
	['Bacon character sweating@2x.png', 512, 512],
	['Blue flame@2x.png', 512, 512],
	['Bowl of rice (1).png', 256, 256],
	['Broccoli character@2x.png', 512, 512],
	['Cheese character@2x.png', 512, 512],
	['Chive sword@2x.png', 512, 512],
	['Eye repair@2x.png', 512, 512],
	['Fluffy white bread@2x.png', 512, 512],
	['French carrot@2x.png', 512, 512],
	['Fried egg@2x.png', 512, 512],
	['Head of lettuce@2x.png', 512, 512],
	['Kawaii stove flame@2x.png', 512, 512],
	['Little green sprouts@2x.png', 512, 512],
	['Mashed potato character@2x.png', 512, 512],
	['Salt and pepper shakers@2x.png', 512, 512],
	['Same character holding@2x.png', 512, 512],
	['Same character@2x.png', 512, 512],
	['Tomato heart@2x.png', 512, 512],
	['holding-trash-bag@2x.png', 512, 512],
	['mash-screenplay-mascot.png', 256, 256],
	['mash-settings-mascot.png', 256, 256]
] as const;

export const EMPTY_CANVAS_MASCOTS: readonly EmptyCanvasMascot[] = CHARACTER_FILES.map(
	([fileName, width, height], rotationIndex) => ({
		// Preserve URL-safe filename characters such as "@"; SvelteKit's static preview
		// decodes escaped spaces but treats an escaped @ as a different filename.
		src: `${ROTATING_ICON_ROOT}${encodeURI(fileName)}`,
		width,
		height,
		title: EMPTY_TITLE,
		copy: EMPTY_COPY,
		rotationIndex
	})
);

export const EMPTY_CANVAS_MASCOT_INDEX_KEY = 'mash.emptyCanvasMascotIndex';
export const EMPTY_CANVAS_MASCOT_SEEN_KEY = 'mash.emptyCanvasMascotSeen';

export const DEFAULT_EMPTY_CANVAS_MASCOT: EmptyCanvasMascot = {
	src: '/icons/mash-empty-mascot@2x.png',
	width: 116,
	height: 200,
	title: EMPTY_TITLE,
	copy: EMPTY_COPY
};

function browserLocalStorage(): VisitStorage | null {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage;
	} catch {
		return null;
	}
}

/**
 * Pick once at page initialization. The first successfully displayed empty-desk
 * mascot is always the core potato; later visits rotate without an immediate repeat.
 */
export function chooseEmptyCanvasMascotForVisit({
	random = Math.random,
	storage = browserLocalStorage()
}: {
	random?: () => number;
	storage?: VisitStorage | null;
} = {}): EmptyCanvasMascot {
	let visitState: { hasSeenDefault: boolean; previousIndex: number };
	try {
		const storedIndex = storage?.getItem(EMPTY_CANVAS_MASCOT_INDEX_KEY);
		visitState = {
			hasSeenDefault: storage?.getItem(EMPTY_CANVAS_MASCOT_SEEN_KEY) === '1',
			previousIndex: storedIndex == null ? Number.NaN : Number(storedIndex)
		};
	} catch {
		// If durable state is unavailable, keep the safest deterministic first impression.
		return DEFAULT_EMPTY_CANVAS_MASCOT;
	}

	if (!visitState.hasSeenDefault) return DEFAULT_EMPTY_CANVAS_MASCOT;

	const randomValue = random();
	const boundedRandom = Number.isFinite(randomValue)
		? Math.min(0.999999999, Math.max(0, randomValue))
		: 0;
	let index = Math.floor(boundedRandom * EMPTY_CANVAS_MASCOTS.length);

	if (
		Number.isInteger(visitState.previousIndex) &&
		visitState.previousIndex >= 0 &&
		visitState.previousIndex < EMPTY_CANVAS_MASCOTS.length &&
		visitState.previousIndex === index
	) {
		index = (index + 1) % EMPTY_CANVAS_MASCOTS.length;
	}

	return EMPTY_CANVAS_MASCOTS[index] ?? DEFAULT_EMPTY_CANVAS_MASCOT;
}

/** Advance first-show/rotation state only after the selected image actually displayed. */
export function acknowledgeEmptyCanvasMascotDisplay(
	mascot: EmptyCanvasMascot,
	storage: VisitStorage | null = browserLocalStorage()
): void {
	try {
		if (mascot.src === DEFAULT_EMPTY_CANVAS_MASCOT.src) {
			storage?.setItem(EMPTY_CANVAS_MASCOT_SEEN_KEY, '1');
			return;
		}
		const rotationIndex = mascot.rotationIndex;
		if (
			typeof rotationIndex === 'number' &&
			Number.isInteger(rotationIndex) &&
			rotationIndex >= 0 &&
			rotationIndex < EMPTY_CANVAS_MASCOTS.length
		) {
			storage?.setItem(EMPTY_CANVAS_MASCOT_INDEX_KEY, String(rotationIndex));
		}
	} catch {
		// Storage is optional; a displayed mascot should never destabilize the desk.
	}
}
