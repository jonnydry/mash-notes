/** Quarter-turn rotation for embedded clipping images (browser canvas). */
import {
	blobIdFromRef,
	composeMashBlobSrc,
	deleteBlobIdsIfUnreferenced,
	isMashBlobRef,
	putNoteBlobFromDataUrl,
	resolveToDataUrl
} from './note-blobs';

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
 * Rotate an image source (data URL or mash-blob:) by 90° increments.
 * Returns a PNG data URL (caller may persist as a new blob).
 */
export async function rotateImageDataUrl(src: string, quarterTurns: QuarterTurns): Promise<string> {
	if (typeof document === 'undefined') {
		throw new Error('Image rotation requires a browser');
	}
	const trimmed = src.trim();
	let loadSrc = trimmed;
	if (isMashBlobRef(trimmed)) {
		const dataUrl = await resolveToDataUrl(trimmed);
		if (!dataUrl) throw new Error('Could not load image blob for rotation');
		loadSrc = dataUrl;
	} else if (!/^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(trimmed)) {
		throw new Error('Only embedded image data URLs or mash-blob refs can be rotated');
	}

	const turns = ((Math.trunc(quarterTurns) % 4) + 4) % 4;
	if (turns === 0) return loadSrc;

	const img = await loadImage(loadSrc);
	const size = rotatedCanvasSize(
		img.naturalWidth || img.width,
		img.naturalHeight || img.height,
		turns
	);
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

/**
 * Rotate and persist a new mash-blob; returns the new mash-blob: src for note bodies.
 *
 * Call {@link releaseRotatedBlob} after the note body has been rewritten to the
 * new src so the previous blob can be reclaimed.
 */
export async function rotateImageToBlobRef(
	src: string,
	quarterTurns: QuarterTurns
): Promise<{ src: string; previousBlobId: string | null }> {
	const previousBlobId = blobIdFromRef(src);
	const dataUrl = await rotateImageDataUrl(src, quarterTurns);
	const blob = await putNoteBlobFromDataUrl(dataUrl);
	return {
		src: composeMashBlobSrc(blob.id),
		previousBlobId: previousBlobId && previousBlobId !== blob.id ? previousBlobId : null
	};
}

/**
 * Free the pre-rotate blob once no *other* active note still points at it.
 * Pass the note id being rotated so a not-yet-persisted body rewrite does not
 * keep the old id alive via the stale IDB row.
 */
export async function releaseRotatedBlob(
	previousBlobId: string | null | undefined,
	noteId?: string
): Promise<void> {
	if (!previousBlobId) return;
	await deleteBlobIdsIfUnreferenced([previousBlobId], {
		ignoreNoteIds: noteId ? [noteId] : undefined
	});
}
