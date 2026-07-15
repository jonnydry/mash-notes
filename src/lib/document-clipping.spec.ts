import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { extractBlobIdsFromBody } from './note-blobs';
import {
	buildDocxClippingDraft,
	buildHtmlClippingDraft,
	buildPdfClippingDraft,
	withNoteId
} from './document-clipping';

function file(name: string, type = 'application/octet-stream'): File {
	return new File(['x'], name, { type });
}

const TINY_PNG =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('document clipping drafts', () => {
	beforeEach(async () => {
		await db.delete();
		await db.open();
	});

	it('buildDocxClippingDraft normalizes text and tags source', async () => {
		const draft = await buildDocxClippingDraft(file('brief.docx'), {
			text: '  Hello   world from Word.  More context.  '
		});
		expect(draft).not.toBeNull();
		expect(draft!.title).toBe('Hello world from Word');
		expect(draft!.body).toBe('Hello world from Word. More context.');
		expect(draft!.tags).toEqual(['docx-clipping']);
		expect(draft!.source).toEqual({ kind: 'docx', title: 'brief.docx' });
		expect(draft!.toast).toMatch(/Word/i);
		expect(draft!.clipping.noteId).toBe('');
		expect(draft!.clipping.text).toBe(draft!.body);
		expect(draft!.clipping.id).toBeTruthy();
	});

	it('buildDocxClippingDraft stores an embedded image as a blob-backed visual note', async () => {
		const draft = await buildDocxClippingDraft(file('visual brief.docx'), {
			imageDataUrl: TINY_PNG,
			imageAlt: 'Quarterly [chart]',
			imageIndex: 2
		});

		expect(draft).not.toBeNull();
		expect(draft!.title).toBe('visual brief · image 2');
		expect(draft!.body).toContain('![Quarterly chart](mash-blob:');
		expect(draft!.body).toContain('_From visual brief.docx._');
		expect(draft!.body).not.toContain('base64');
		expect(draft!.source).toEqual({ kind: 'docx', title: 'visual brief.docx' });
		expect(draft!.toast).toBe('Saved image from Word document');
		expect(draft!.clipping).toMatchObject({
			noteId: '',
			text: 'visual brief · image 2',
			imageDataUrl: TINY_PNG,
			imageAlt: 'Quarterly chart',
			imageIndex: 2
		});

		const blobIds = extractBlobIdsFromBody(draft!.body);
		expect(blobIds).toHaveLength(1);
		expect(await db.noteBlobs.get(blobIds[0]!)).toMatchObject({ mime: 'image/png' });
	});

	it('buildDocxClippingDraft returns null for empty excerpt', async () => {
		expect(await buildDocxClippingDraft(file('a.docx'), { text: '   \n' })).toBeNull();
	});

	it('buildHtmlClippingDraft tags html source', () => {
		const draft = buildHtmlClippingDraft(file('page.html'), {
			text: 'Article lead sentence. Rest of the paragraph follows.'
		});
		expect(draft).not.toBeNull();
		expect(draft!.title).toBe('Article lead sentence');
		expect(draft!.tags).toEqual(['html-clipping']);
		expect(draft!.source).toEqual({ kind: 'html', title: 'page.html' });
		expect(draft!.toast).toMatch(/HTML/i);
	});

	it('buildHtmlClippingDraft returns null for empty excerpt', () => {
		expect(buildHtmlClippingDraft(file('a.html'), { text: '' })).toBeNull();
	});

	it('buildPdfClippingDraft text path includes page in source and toast', async () => {
		const draft = await buildPdfClippingDraft(file('paper.pdf', 'application/pdf'), {
			page: 3,
			text: 'Key finding about performance. Details later.'
		});
		expect(draft).not.toBeNull();
		expect(draft!.title).toBe('Key finding about performance');
		expect(draft!.body).toBe('Key finding about performance. Details later.');
		expect(draft!.tags).toEqual(['pdf-clipping']);
		expect(draft!.source).toEqual({ kind: 'pdf', title: 'paper.pdf', page: 3 });
		expect(draft!.toast).toBe('Saved excerpt from page 3');
		expect(draft!.clipping).toMatchObject({
			noteId: '',
			page: 3,
			text: draft!.body
		});
	});

	it('buildPdfClippingDraft returns null for blank text without image', async () => {
		expect(await buildPdfClippingDraft(file('paper.pdf'), { page: 1, text: '  \t  ' })).toBeNull();
	});

	it('withNoteId stamps the created note id onto a clipping row', () => {
		const row = { id: 'c1', noteId: '', text: 'excerpt', page: 2 };
		expect(withNoteId(row, 'note-42')).toEqual({
			id: 'c1',
			noteId: 'note-42',
			text: 'excerpt',
			page: 2
		});
		// original unchanged
		expect(row.noteId).toBe('');
	});
});
