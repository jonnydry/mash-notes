import { describe, expect, it, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import {
	createGlobalPasteHandler,
	isEditablePasteTarget,
	type GlobalPasteDeps
} from './global-paste';
import type { Note } from './types';

/**
 * Minimal HTMLElement / Event stubs for the node test project.
 * isEditablePasteTarget uses instanceof HTMLElement + closest().
 */
class StubHTMLElement {
	#editable: boolean;
	constructor(editable = false) {
		this.#editable = editable;
	}
	closest(_selector: string): StubHTMLElement | null {
		return this.#editable ? this : null;
	}
}

const originalHTMLElement = globalThis.HTMLElement;
const originalEvent = globalThis.Event;

beforeAll(() => {
	// @ts-expect-error node has no DOM HTMLElement
	globalThis.HTMLElement = StubHTMLElement;
	if (typeof globalThis.Event === 'undefined') {
		// @ts-expect-error minimal Event for paste construction
		globalThis.Event = class {
			type: string;
			defaultPrevented = false;
			constructor(type: string) {
				this.type = type;
			}
			preventDefault() {
				this.defaultPrevented = true;
			}
		};
	}
});

afterAll(() => {
	if (originalHTMLElement === undefined) {
		// @ts-expect-error restore
		delete globalThis.HTMLElement;
	} else {
		globalThis.HTMLElement = originalHTMLElement;
	}
	if (originalEvent === undefined) {
		// @ts-expect-error restore
		delete globalThis.Event;
	} else {
		globalThis.Event = originalEvent;
	}
});

function makeNote(id: string): Note {
	return {
		id,
		title: id,
		body: '',
		folder: '',
		tags: [],
		created: 1,
		modified: 1,
		pinned: 0
	};
}

function pasteEvent(opts: {
	text?: string;
	target?: EventTarget | null;
	imageFile?: File | null;
}): ClipboardEvent {
	const text = opts.text ?? '';
	const imageFile = opts.imageFile ?? null;
	const files = imageFile
		? ({
				length: 1,
				0: imageFile,
				item: (i: number) => (i === 0 ? imageFile : null),
				[Symbol.iterator]: function* () {
					yield imageFile;
				}
			} as unknown as FileList)
		: ({
				length: 0,
				item: () => null,
				[Symbol.iterator]: function* () {}
			} as unknown as FileList);

	const clipboardData = {
		getData: (type: string) => (type === 'text/plain' ? text : ''),
		files,
		items: imageFile
			? [
					{
						kind: 'file',
						type: imageFile.type,
						getAsFile: () => imageFile
					}
				]
			: []
	} as unknown as DataTransfer;

	const preventDefault = vi.fn();
	return {
		clipboardData,
		target: opts.target ?? new StubHTMLElement(false),
		preventDefault,
		defaultPrevented: false
	} as unknown as ClipboardEvent;
}

function makeDeps(overrides: Partial<GlobalPasteDeps> = {}): GlobalPasteDeps & {
	placeNoteDraftsOnDesk: ReturnType<typeof vi.fn>;
	openPasteDialog: ReturnType<typeof vi.fn>;
	closePasteDialog: ReturnType<typeof vi.fn>;
	flashToast: ReturnType<typeof vi.fn>;
	isPasteBlocked: ReturnType<typeof vi.fn>;
	queueGifExplodeChoice: ReturnType<typeof vi.fn>;
} {
	return {
		flashToast: vi.fn(),
		isPasteBlocked: vi.fn(() => false),
		placeNoteDraftsOnDesk: vi.fn(async (drafts) => drafts.map((_, i) => makeNote(`n${i}`))),
		queueGifExplodeChoice: vi.fn(),
		openPasteDialog: vi.fn(),
		closePasteDialog: vi.fn(),
		...overrides
	};
}

describe('isEditablePasteTarget', () => {
	it('returns false for null, non-elements, and non-editable elements', () => {
		expect(isEditablePasteTarget(null)).toBe(false);
		expect(isEditablePasteTarget({} as EventTarget)).toBe(false);
		expect(isEditablePasteTarget(new StubHTMLElement(false) as unknown as EventTarget)).toBe(
			false
		);
	});

	it('returns true when closest finds an editable ancestor match', () => {
		expect(isEditablePasteTarget(new StubHTMLElement(true) as unknown as EventTarget)).toBe(true);
	});
});

describe('createGlobalPasteHandler routing', () => {
	let deps: ReturnType<typeof makeDeps>;

	beforeEach(() => {
		deps = makeDeps();
	});

	it('ignores paste into editable fields', () => {
		const { handleGlobalPaste } = createGlobalPasteHandler(deps);
		const e = pasteEvent({
			text: 'hello',
			target: new StubHTMLElement(true) as unknown as EventTarget
		});
		handleGlobalPaste(e);
		expect(e.preventDefault).not.toHaveBeenCalled();
		expect(deps.placeNoteDraftsOnDesk).not.toHaveBeenCalled();
		expect(deps.openPasteDialog).not.toHaveBeenCalled();
	});

	it('ignores paste when blocked by modals/readers', () => {
		deps.isPasteBlocked = vi.fn(() => true);
		const { handleGlobalPaste } = createGlobalPasteHandler(deps);
		const e = pasteEvent({ text: 'hello' });
		handleGlobalPaste(e);
		expect(deps.placeNoteDraftsOnDesk).not.toHaveBeenCalled();
		expect(deps.openPasteDialog).not.toHaveBeenCalled();
	});

	it('routes URL-only paste straight to desk cards', async () => {
		const { handleGlobalPaste } = createGlobalPasteHandler(deps);
		const e = pasteEvent({ text: 'https://example.com\nhttps://foo.org/path' });
		handleGlobalPaste(e);
		expect(e.preventDefault).toHaveBeenCalled();
		await vi.waitFor(() => expect(deps.placeNoteDraftsOnDesk).toHaveBeenCalled());
		const drafts = deps.placeNoteDraftsOnDesk.mock.calls[0]![0] as Array<{
			title: string;
			source?: { kind: string };
		}>;
		expect(drafts).toHaveLength(2);
		expect(drafts.every((d) => d.source?.kind === 'url')).toBe(true);
		expect(deps.openPasteDialog).not.toHaveBeenCalled();
		expect(deps.flashToast).toHaveBeenCalledWith(expect.stringContaining('link card'));
	});

	it('creates a single card immediately for one-line text', async () => {
		const { handleGlobalPaste } = createGlobalPasteHandler(deps);
		const e = pasteEvent({ text: 'Just one thought' });
		handleGlobalPaste(e);
		expect(e.preventDefault).toHaveBeenCalled();
		await vi.waitFor(() => expect(deps.placeNoteDraftsOnDesk).toHaveBeenCalled());
		const drafts = deps.placeNoteDraftsOnDesk.mock.calls[0]![0] as Array<{ title: string }>;
		expect(drafts).toEqual([{ title: 'Just one thought', body: '' }]);
		expect(deps.openPasteDialog).not.toHaveBeenCalled();
		expect(deps.closePasteDialog).toHaveBeenCalled();
		expect(deps.flashToast).toHaveBeenCalledWith('Pasted 1 card');
	});

	it('opens the paste dialog for multi-line text', () => {
		const { handleGlobalPaste } = createGlobalPasteHandler(deps);
		const e = pasteEvent({ text: 'Alpha\nBeta\nGamma' });
		handleGlobalPaste(e);
		expect(e.preventDefault).toHaveBeenCalled();
		expect(deps.openPasteDialog).toHaveBeenCalledOnce();
		const analysis = deps.openPasteDialog.mock.calls[0]![0] as {
			lines: string[];
			suggestedMode: string;
		};
		expect(analysis.lines).toEqual(['Alpha', 'Beta', 'Gamma']);
		expect(analysis.suggestedMode).toBe('lines');
		expect(deps.placeNoteDraftsOnDesk).not.toHaveBeenCalled();
	});

	it('opens the paste dialog for multi-paragraph text', () => {
		const { handleGlobalPaste } = createGlobalPasteHandler(deps);
		handleGlobalPaste(pasteEvent({ text: 'First block\n\nSecond block' }));
		expect(deps.openPasteDialog).toHaveBeenCalledOnce();
		const analysis = deps.openPasteDialog.mock.calls[0]![0] as { suggestedMode: string };
		expect(analysis.suggestedMode).toBe('paragraphs');
	});

	it('ignores empty / whitespace-only text paste', () => {
		const { handleGlobalPaste } = createGlobalPasteHandler(deps);
		const e = pasteEvent({ text: '   \n  ' });
		handleGlobalPaste(e);
		expect(e.preventDefault).not.toHaveBeenCalled();
		expect(deps.openPasteDialog).not.toHaveBeenCalled();
		expect(deps.placeNoteDraftsOnDesk).not.toHaveBeenCalled();
	});

	it('createCardsFromPaste respects split mode and toasts', async () => {
		const { createCardsFromPaste } = createGlobalPasteHandler(deps);
		const analysis = {
			text: 'A\nB\nC',
			lines: ['A', 'B', 'C'],
			paragraphs: ['A\nB\nC'],
			suggestedMode: 'lines' as const
		};
		await createCardsFromPaste(analysis, 'lines');
		expect(deps.placeNoteDraftsOnDesk).toHaveBeenCalledOnce();
		const drafts = deps.placeNoteDraftsOnDesk.mock.calls[0]![0] as unknown[];
		expect(drafts).toHaveLength(3);
		expect(deps.flashToast).toHaveBeenCalledWith('Pasted 3 cards');
		expect(deps.closePasteDialog).toHaveBeenCalled();
	});

	it('prefers image clipboard over text when both present', async () => {
		const pngish = new File([new Uint8Array([0x89, 0x50])], 'clip.png', { type: 'image/png' });
		const { handleGlobalPaste } = createGlobalPasteHandler(deps);
		const e = pasteEvent({ text: 'Alpha\nBeta\nGamma', imageFile: pngish });
		handleGlobalPaste(e);
		expect(e.preventDefault).toHaveBeenCalled();
		// Image branch owns the event — never open multi-line text dialog
		await Promise.resolve();
		await Promise.resolve();
		expect(deps.openPasteDialog).not.toHaveBeenCalled();
	});
});
