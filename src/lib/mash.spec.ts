import { describe, expect, it, vi } from 'vitest';
import {
	combineNotes,
	mashTitle,
	notesToJson,
	slugifyFilename,
	notesFromSelection,
	sequencePrintHtml
} from './mash';
import type { Note } from './types';

function note(partial: Partial<Note> & Pick<Note, 'id' | 'title'>): Note {
	return {
		body: '',
		folder: '',
		tags: [],
		created: 1,
		modified: 1,
		pinned: 0,
		...partial
	};
}

describe('combineNotes', () => {
	it('returns empty string for empty selection', () => {
		expect(combineNotes([])).toBe('');
	});

	it('combines a single note with title and body', () => {
		const md = combineNotes([note({ id: '1', title: 'Hello', body: 'World' })]);
		expect(md).toBe('# Hello\n\nWorld');
	});

	it('joins multiple notes with separators', () => {
		const md = combineNotes([
			note({ id: '1', title: 'A', body: 'one' }),
			note({ id: '2', title: 'B', body: 'two' })
		]);
		expect(md).toBe('# A\n\none\n\n---\n\n# B\n\ntwo');
	});

	it('uses Untitled for blank titles and omits empty body blank line', () => {
		const md = combineNotes([note({ id: '1', title: '  ', body: '' })]);
		expect(md).toBe('# Untitled');
	});

	it('preserves caller order', () => {
		const md = combineNotes([
			note({ id: '2', title: 'Second', body: 'b' }),
			note({ id: '1', title: 'First', body: 'a' })
		]);
		expect(md.startsWith('# Second')).toBe(true);
		expect(md.includes('# First')).toBe(true);
	});
});

describe('mashTitle', () => {
	it('uses the "Mash of N notes" form for one note', () => {
		expect(mashTitle([note({ id: '1', title: 'Solo' })])).toBe('Mash of 1 notes');
	});

	it('joins two short notes as "A + B"', () => {
		expect(mashTitle([note({ id: '1', title: 'Ideas' }), note({ id: '2', title: 'Goals' })])).toBe(
			'Ideas + Goals'
		);
	});

	it('cuts "A + B" to 200 chars when too long', () => {
		const big = 'x'.repeat(300);
		const joined = `${big} + ${big}`;
		expect(mashTitle([note({ id: '1', title: big }), note({ id: '2', title: big })])).toBe(
			joined.slice(0, 200)
		);
	});

	it("uses 'Mash of N notes' for other counts", () => {
		const fives = Array.from({ length: 5 }, (_, i) => note({ id: 'n' + i, title: 'Note' }));
		expect(mashTitle(fives)).toBe('Mash of 5 notes');
	});
});

describe('notesToJson', () => {
	it('pretty-prints notes as JSON', () => {
		const n = note({ id: 'x', title: 'T', body: 'b', tags: ['a'] });
		const parsed = JSON.parse(notesToJson([n]));
		expect(parsed).toHaveLength(1);
		expect(parsed[0].id).toBe('x');
		expect(parsed[0].tags).toEqual(['a']);
	});
});

describe('slugifyFilename', () => {
	it('slugifies titles', () => {
		expect(slugifyFilename('Hello World!')).toBe('hello-world');
	});

	it('falls back when empty', () => {
		expect(slugifyFilename('   ')).toBe('mash-export');
	});
});

describe('notesFromSelection', () => {
	it('resolves ids in selection order and skips missing', () => {
		const notes = [
			note({ id: 'a', title: 'A' }),
			note({ id: 'b', title: 'B' }),
			note({ id: 'c', title: 'C' })
		];
		const selected = notesFromSelection(notes, ['c', 'missing', 'a']);
		expect(selected.map((n) => n.id)).toEqual(['c', 'a']);
	});
});

describe('sequencePrintHtml', () => {
	it('emits one section per note with page breaks', async () => {
		const html = await sequencePrintHtml([
			note({ id: '1', title: 'Project ideas', body: '- Build' }),
			note({ id: '2', title: 'Goals', body: '1. Fast' })
		]);
		expect(html).toContain('Page 1 of 2');
		expect(html).toContain('Page 2 of 2');
		expect(html).toContain('Project ideas');
		expect(html).toContain('Goals');
		expect(html).toContain('page-break-after: always');
	});

	it('applies note textAlign to each page', async () => {
		const html = await sequencePrintHtml([
			note({ id: '1', title: 'Centered', body: 'Hi', textAlign: 'center' })
		]);
		expect(html).toContain('text-align: center');
	});

	it('falls back to a pre block when the marked chunk fails to load', async () => {
		vi.resetModules();
		vi.doMock('./marked-runtime', () => {
			throw new Error('marked chunk failed');
		});
		try {
			const { sequencePrintHtml: printHtml } = await import('./mash');
			const html = await printHtml([
				note({ id: '1', title: 'Hello', body: 'Use **Mash** & <b>bold</b>' })
			]);
			expect(html).toContain('<pre>Use **Mash** &amp; &lt;b&gt;bold&lt;/b&gt;</pre>');
			expect(html).not.toContain('<strong>');
		} finally {
			vi.doUnmock('./marked-runtime');
			vi.resetModules();
		}
	});
});

describe('printSequenceAsPdf', () => {
	it('opens the print window before markdown finishes loading', async () => {
		vi.resetModules();
		let release: (html: string) => void = () => {};
		const pending = new Promise<string>((resolve) => {
			release = resolve;
		});
		vi.doMock('./markdown', () => ({
			renderMarkdown: () => pending
		}));
		const opened: Array<string | URL | undefined> = [];
		const win = {
			closed: false,
			opener: {} as object | null,
			location: { href: '' },
			close() {
				this.closed = true;
			}
		};
		vi.stubGlobal('window', {
			open: (url?: string | URL) => {
				opened.push(url);
				return win;
			}
		});
		const realURL = globalThis.URL;
		const createDescriptor = Object.getOwnPropertyDescriptor(realURL, 'createObjectURL');
		const revokeDescriptor = Object.getOwnPropertyDescriptor(realURL, 'revokeObjectURL');
		try {
			const { printSequenceAsPdf } = await import('./mash');
			Object.defineProperty(realURL, 'createObjectURL', {
				configurable: true,
				writable: true,
				value: () => 'blob:print'
			});
			Object.defineProperty(realURL, 'revokeObjectURL', {
				configurable: true,
				writable: true,
				value: () => {}
			});
			vi.useFakeTimers();
			const job = printSequenceAsPdf([note({ id: '1', title: 'Hello', body: 'Body' })]);
			expect(opened).toEqual(['']);
			expect(win.location.href).toBe('');
			release('<p>Body</p>');
			await expect(job).resolves.toBe(true);
			expect(win.location.href).toBe('blob:print');
			expect(win.opener).toBeNull();
			vi.runOnlyPendingTimers();
		} finally {
			if (createDescriptor) Object.defineProperty(realURL, 'createObjectURL', createDescriptor);
			else Reflect.deleteProperty(realURL, 'createObjectURL');
			if (revokeDescriptor) Object.defineProperty(realURL, 'revokeObjectURL', revokeDescriptor);
			else Reflect.deleteProperty(realURL, 'revokeObjectURL');
			vi.useRealTimers();
			vi.unstubAllGlobals();
			vi.doUnmock('./markdown');
			vi.resetModules();
		}
	});
});
