import { describe, expect, it } from 'vitest';
import {
	DESK_IMAGE_MAX_ORIGINAL_BYTES,
	DESK_IMAGE_MAX_PER_ACTION,
	imageNoteBody,
	imageNoteSource,
	imageTitleFromFileName,
	isImageFile,
	prepareDeskImage
} from './desk-image';

function file(name: string, type: string, bytes = 16): File {
	return new File([new Uint8Array(bytes)], name, { type });
}

describe('desk-image helpers', () => {
	it('detects supported image files', () => {
		expect(isImageFile(file('a.png', 'image/png'))).toBe(true);
		expect(isImageFile(file('b.JPEG', ''))).toBe(true);
		expect(isImageFile(file('c.webp', 'image/webp'))).toBe(true);
		expect(isImageFile(file('d.gif', 'image/gif'))).toBe(true);
		expect(isImageFile(file('e.svg', 'image/svg+xml'))).toBe(false);
		expect(isImageFile(file('f.txt', 'text/plain'))).toBe(false);
	});

	it('derives titles from filenames', () => {
		expect(imageTitleFromFileName('vacation photo.PNG')).toBe('vacation photo');
		expect(imageTitleFromFileName('/tmp/shot.jpeg')).toBe('shot');
		expect(imageTitleFromFileName('')).toBe('Image');
	});

	it('composes note body with optional caption', () => {
		expect(imageNoteBody('data:image/png;base64,abc', 'Alt')).toBe(
			'![Alt](data:image/png;base64,abc)'
		);
		expect(imageNoteBody('data:image/png;base64,abc', 'Alt', 'Hello')).toBe(
			'![Alt](data:image/png;base64,abc)\n\nHello'
		);
	});

	it('builds image source metadata', () => {
		expect(imageNoteSource('shot.png')).toEqual({ kind: 'image', title: 'shot.png' });
		expect(imageNoteSource('  ')).toEqual({ kind: 'image', title: 'Image' });
	});

	it('exports sensible action caps', () => {
		expect(DESK_IMAGE_MAX_PER_ACTION).toBe(50);
		expect(DESK_IMAGE_MAX_ORIGINAL_BYTES).toBe(20 * 1024 * 1024);
	});

	it('rejects originals over the hard size cap', async () => {
		const huge = new Blob([new Uint8Array(DESK_IMAGE_MAX_ORIGINAL_BYTES + 1)], {
			type: 'image/png'
		});
		const result = await prepareDeskImage(huge, { fileName: 'huge.png' });
		expect(result).toEqual({ ok: false, error: 'too-large' });
	});

	it('rejects undecodable image bytes', async () => {
		const result = await prepareDeskImage(file('bad.png', 'image/png', 8), {
			fileName: 'bad.png'
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toBe('undecodable');
	});
});
