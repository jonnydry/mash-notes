/**
 * Prepare screenshots and photos for visual stickies on the desk.
 * Soft-resizes large images; persists pixels as noteBlobs + mash-blob: body refs.
 */
import { composeEmbeddedNoteImage } from './markdown';
import { imageNoteBodyFromBlob, putNoteBlobFromDataUrl } from './note-blobs';
import type { NoteSource } from './types';

export const DESK_IMAGE_MAX_ORIGINAL_BYTES = 20 * 1024 * 1024;
export const DESK_IMAGE_MAX_EDGE = 2400;
export const DESK_IMAGE_JPEG_QUALITY = 0.82;
export const DESK_IMAGE_MAX_PER_ACTION = 50;

const IMAGE_MIME = /^image\/(png|jpeg|webp|gif)$/i;
const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;

export type PrepareDeskImageResult =
	| {
			ok: true;
			dataUrl: string;
			width: number;
			height: number;
			compacted: boolean;
			titleHint: string;
	  }
	| { ok: false; error: 'too-large' | 'undecodable' | 'unsupported' };

export function isImageFile(file: Pick<File, 'name' | 'type'>): boolean {
	const name = file.name.trim().toLowerCase();
	const type = file.type.toLowerCase();
	return IMAGE_EXT.test(name) || IMAGE_MIME.test(type);
}

/** Lightweight GIF detection — does not load the gifuct decoder. */
export function isGifFile(file: Pick<File, 'name' | 'type'>): boolean {
	const name = file.name.trim().toLowerCase();
	const type = file.type.toLowerCase();
	return /\.gif$/i.test(name) || type === 'image/gif';
}

export function imageTitleFromFileName(name: string): string {
	const base = name.trim().replace(/^.*[/\\]/, '');
	const withoutExt = base.replace(/\.(png|jpe?g|webp|gif)$/i, '').trim();
	return (withoutExt || 'Image').slice(0, 200);
}

/** @deprecated Prefer imageNoteBodyFromBlob after persist; kept for tests/legacy data URLs. */
export function imageNoteBody(dataUrl: string, alt: string, caption = ''): string {
	return composeEmbeddedNoteImage(alt.slice(0, 200) || 'Image', dataUrl, caption);
}

/**
 * Persist a prepared data URL as a NoteBlob and return a short mash-blob body.
 */
export async function persistImageNoteBody(
	dataUrl: string,
	alt: string,
	caption = '',
	dims?: { width: number; height: number }
): Promise<{ body: string; blobId: string }> {
	const blob = await putNoteBlobFromDataUrl(dataUrl, dims);
	return {
		body: imageNoteBodyFromBlob(blob.id, alt, caption),
		blobId: blob.id
	};
}

export function imageNoteSource(title: string): NoteSource {
	return {
		kind: 'image',
		title: title.trim().slice(0, 300) || 'Image'
	};
}

function hasAlpha(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
	const sampleW = Math.min(width, 64);
	const sampleH = Math.min(height, 64);
	if (sampleW < 1 || sampleH < 1) return false;
	const data = ctx.getImageData(0, 0, sampleW, sampleH).data;
	for (let i = 3; i < data.length; i += 4) {
		if (data[i]! < 250) return true;
	}
	return false;
}

function scaleDimensions(
	width: number,
	height: number,
	maxEdge: number
): { width: number; height: number; scaled: boolean } {
	const edge = Math.max(width, height);
	if (edge <= maxEdge) return { width, height, scaled: false };
	const scale = maxEdge / edge;
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale)),
		scaled: true
	};
}

async function decodeBitmap(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
	if (typeof createImageBitmap === 'function') {
		return createImageBitmap(blob);
	}
	const url = URL.createObjectURL(blob);
	try {
		const img = await new Promise<HTMLImageElement>((resolve, reject) => {
			const el = new Image();
			el.onload = () => resolve(el);
			el.onerror = () => reject(new Error('decode failed'));
			el.src = url;
		});
		return img;
	} finally {
		URL.revokeObjectURL(url);
	}
}

function canvasToDataUrl(
	canvas: HTMLCanvasElement,
	preferPng: boolean,
	quality: number
): string {
	if (preferPng) return canvas.toDataURL('image/png');
	return canvas.toDataURL('image/jpeg', quality);
}

/**
 * Decode and optionally soft-resize an image for desk storage as a data URL.
 */
export async function prepareDeskImage(
	input: Blob,
	options?: { fileName?: string; titleHint?: string }
): Promise<PrepareDeskImageResult> {
	const fileName = options?.fileName?.trim() ?? (input instanceof File ? input.name : '');
	const type = (input.type || '').toLowerCase();
	const nameOk = fileName ? IMAGE_EXT.test(fileName) : false;
	const typeOk = IMAGE_MIME.test(type);
	if (fileName && !nameOk && type && !typeOk) {
		return { ok: false, error: 'unsupported' };
	}
	if (type && !typeOk && !nameOk && !type.startsWith('image/')) {
		return { ok: false, error: 'unsupported' };
	}
	if (typeof input.size === 'number' && input.size > DESK_IMAGE_MAX_ORIGINAL_BYTES) {
		return { ok: false, error: 'too-large' };
	}

	const titleHint =
		options?.titleHint?.trim() ||
		(fileName ? imageTitleFromFileName(fileName) : '') ||
		'Pasted image';

	let bitmap: ImageBitmap | HTMLImageElement;
	try {
		bitmap = await decodeBitmap(input);
	} catch {
		return { ok: false, error: 'undecodable' };
	}

	const srcW =
		'naturalWidth' in bitmap
			? bitmap.naturalWidth || bitmap.width
			: (bitmap as ImageBitmap).width;
	const srcH =
		'naturalHeight' in bitmap
			? bitmap.naturalHeight || bitmap.height
			: (bitmap as ImageBitmap).height;

	if (!srcW || !srcH) {
		if ('close' in bitmap && typeof bitmap.close === 'function') bitmap.close();
		return { ok: false, error: 'undecodable' };
	}

	const { width, height, scaled } = scaleDimensions(srcW, srcH, DESK_IMAGE_MAX_EDGE);

	try {
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext('2d');
		if (!ctx) {
			return { ok: false, error: 'undecodable' };
		}
		ctx.drawImage(bitmap as CanvasImageSource, 0, 0, width, height);
		const alpha = hasAlpha(ctx, width, height);
		const isPngLike =
			alpha || /\.png$/i.test(fileName) || type === 'image/png' || type === 'image/gif';
		let dataUrl = canvasToDataUrl(canvas, isPngLike, DESK_IMAGE_JPEG_QUALITY);
		let compacted = scaled;

		// If still huge as PNG, try JPEG when no alpha
		const roughBytes = Math.ceil((dataUrl.length - 22) * 0.75);
		if (!alpha && roughBytes > 2_500_000) {
			dataUrl = canvasToDataUrl(canvas, false, DESK_IMAGE_JPEG_QUALITY);
			compacted = true;
		}
		if (roughBytes > 4_000_000 && Math.max(width, height) > 1200) {
			const tighter = scaleDimensions(srcW, srcH, 1600);
			canvas.width = tighter.width;
			canvas.height = tighter.height;
			ctx.drawImage(bitmap as CanvasImageSource, 0, 0, tighter.width, tighter.height);
			const stillAlpha = hasAlpha(ctx, tighter.width, tighter.height);
			dataUrl = canvasToDataUrl(canvas, stillAlpha, 0.75);
			compacted = true;
			return {
				ok: true,
				dataUrl,
				width: tighter.width,
				height: tighter.height,
				compacted,
				titleHint
			};
		}

		return {
			ok: true,
			dataUrl,
			width,
			height,
			compacted,
			titleHint
		};
	} finally {
		if ('close' in bitmap && typeof bitmap.close === 'function') bitmap.close();
	}
}

/** Extract the first image Blob from a paste ClipboardEvent, if any. */
export function clipboardImageBlob(data: DataTransfer | null | undefined): Blob | null {
	if (!data) return null;
	const files = data.files;
	if (files?.length) {
		for (let i = 0; i < files.length; i++) {
			const f = files[i]!;
			if (f.type.startsWith('image/') || isImageFile(f)) return f;
		}
	}
	const items = data.items;
	if (items) {
		for (let i = 0; i < items.length; i++) {
			const item = items[i]!;
			if (item.kind === 'file' && item.type.startsWith('image/')) {
				const file = item.getAsFile();
				if (file) return file;
			}
		}
	}
	return null;
}
