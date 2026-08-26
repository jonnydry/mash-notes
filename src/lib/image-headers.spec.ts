import { describe, expect, it } from 'vitest';
import { readEncodedImageDimensions } from './image-headers';

function blob(bytes: number[]): Blob {
	return new Blob([new Uint8Array(bytes)]);
}

function pngHeader(width: number, height: number): Blob {
	const bytes = new Uint8Array(24);
	bytes.set([0x89, 0x50, 0x4e, 0x47], 0);
	bytes.set([0x49, 0x48, 0x44, 0x52], 12);
	const view = new DataView(bytes.buffer);
	view.setUint32(16, width);
	view.setUint32(20, height);
	return new Blob([bytes], { type: 'image/png' });
}

function gifHeader(signature: 'GIF87a' | 'GIF89a', width: number, height: number): Blob {
	const bytes = new Uint8Array(10);
	bytes.set([...signature].map((character) => character.charCodeAt(0)), 0);
	bytes[6] = width & 0xff;
	bytes[7] = (width >> 8) & 0xff;
	bytes[8] = height & 0xff;
	bytes[9] = (height >> 8) & 0xff;
	return new Blob([bytes], { type: 'image/gif' });
}

function jpegSof0Header(width: number, height: number): Blob {
	return blob([
		0xff,
		0xd8,
		0xff,
		0xc0,
		0x00,
		0x08,
		0x08,
		(height >> 8) & 0xff,
		height & 0xff,
		(width >> 8) & 0xff,
		width & 0xff,
		0x00
	]);
}

function webpVp8xHeader(width: number, height: number): Blob {
	const bytes = new Uint8Array(30);
	bytes.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
	bytes.set([0x16, 0x00, 0x00, 0x00], 4);
	bytes.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
	bytes.set([0x56, 0x50, 0x38, 0x58], 12); // VP8X
	bytes.set([0x0a, 0x00, 0x00, 0x00], 16);

	const widthMinusOne = width - 1;
	const heightMinusOne = height - 1;
	bytes[24] = widthMinusOne & 0xff;
	bytes[25] = (widthMinusOne >> 8) & 0xff;
	bytes[26] = (widthMinusOne >> 16) & 0xff;
	bytes[27] = heightMinusOne & 0xff;
	bytes[28] = (heightMinusOne >> 8) & 0xff;
	bytes[29] = (heightMinusOne >> 16) & 0xff;
	return new Blob([bytes], { type: 'image/webp' });
}

describe('readEncodedImageDimensions', () => {
	it('reads PNG dimensions from the IHDR header', async () => {
		expect(await readEncodedImageDimensions(pngHeader(640, 480))).toEqual({
			width: 640,
			height: 480
		});
	});

	it('reads GIF87a and GIF89a logical screen dimensions', async () => {
		expect(await readEncodedImageDimensions(gifHeader('GIF87a', 320, 200))).toEqual({
			width: 320,
			height: 200
		});
		expect(await readEncodedImageDimensions(gifHeader('GIF89a', 1024, 768))).toEqual({
			width: 1024,
			height: 768
		});
	});

	it('reads JPEG dimensions from a SOF0 marker', async () => {
		expect(await readEncodedImageDimensions(jpegSof0Header(321, 240))).toEqual({
			width: 321,
			height: 240
		});
	});

	it('reads WebP dimensions from a VP8X chunk', async () => {
		expect(await readEncodedImageDimensions(webpVp8xHeader(1024, 768))).toEqual({
			width: 1024,
			height: 768
		});
	});

	it('returns null for garbage bytes and empty blobs', async () => {
		expect(await readEncodedImageDimensions(blob([0x6e, 0x6f, 0x70, 0x65]))).toBeNull();
		expect(await readEncodedImageDimensions(new Blob([]))).toBeNull();
	});
});
