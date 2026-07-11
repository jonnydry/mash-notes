/** Quarter-turn rotation for embedded clipping images (browser canvas). */

export type QuarterTurns = 1 | -1 | 2;

/** Swap width/height when rotating by an odd number of 90° turns. */
export function rotatedCanvasSize(
	width: number,
	height: number,
	quarterTurns: number
): { width: number; height: number } {
	const turns = ((Math.trunc(quarterTurns) % 4) + 4) % 4;
	return turns % 2 === 1 ? { width: height, height: width } : { width, height };
}

function loadImage(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error('Could not load image for rotation'));
		img.src = src;
	});
}

/**
 * Rotate a data-URL image by 90° increments and return a PNG data URL.
 * Mutates pixels so cards, preview, and export stay correct without CSS transforms.
 */
export async function rotateImageDataUrl(
	dataUrl: string,
	quarterTurns: QuarterTurns
): Promise<string> {
	if (typeof document === 'undefined') {
		throw new Error('Image rotation requires a browser');
	}
	const trimmed = dataUrl.trim();
	if (!/^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(trimmed)) {
		throw new Error('Only embedded image data URLs can be rotated');
	}

	const turns = ((Math.trunc(quarterTurns) % 4) + 4) % 4;
	if (turns === 0) return trimmed;

	const img = await loadImage(trimmed);
	const size = rotatedCanvasSize(img.naturalWidth || img.width, img.naturalHeight || img.height, turns);
	if (size.width < 1 || size.height < 1) {
		throw new Error('Image has no dimensions');
	}

	const canvas = document.createElement('canvas');
	canvas.width = size.width;
	canvas.height = size.height;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Could not rotate image');

	ctx.translate(size.width / 2, size.height / 2);
	ctx.rotate((turns * Math.PI) / 2);
	ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);

	try {
		return canvas.toDataURL('image/png');
	} catch {
		throw new Error('Could not export rotated image');
	}
}
