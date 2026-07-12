/**
 * Explode animated GIFs into desk-ready frame stickies.
 * Uses gifuct-js for decode; composites disposal methods onto a full canvas.
 */
import { parseGIF, decompressFrames } from 'gifuct-js';
import {
	DESK_IMAGE_MAX_EDGE,
	DESK_IMAGE_MAX_ORIGINAL_BYTES,
	imageNoteBody,
	imageNoteSource,
	imageTitleFromFileName
} from './desk-image';
import type { NoteSource } from './types';

export const GIF_EXPLODE_MAX_FRAMES = 36;

export type GifExplodeMode = 'still' | 'frames';

type ParsedFrame = {
	dims: { width: number; height: number; top: number; left: number };
	disposalType: number;
	patch?: Uint8ClampedArray;
};

export type GifInspectResult =
	| {
			ok: true;
			animated: boolean;
			frameCount: number;
			width: number;
			height: number;
	  }
	| { ok: false; error: 'too-large' | 'undecodable' | 'not-gif' };

export type GifExplodeFrame = {
	/** 1-based index among original GIF frames (for labels). */
	frameNumber: number;
	/** Total frames in the source GIF. */
	sourceFrameCount: number;
	dataUrl: string;
	width: number;
	height: number;
	compacted: boolean;
};

export type GifExplodeResult =
	| { ok: true; frames: GifExplodeFrame[]; sampled: boolean }
	| { ok: false; error: 'too-large' | 'undecodable' | 'not-gif' | 'empty' };

export type GifCardDraft = {
	title: string;
	body: string;
	source: NoteSource;
};

export function isGifFile(file: Pick<File, 'name' | 'type'>): boolean {
	const name = file.name.trim().toLowerCase();
	const type = file.type.toLowerCase();
	return /\.gif$/i.test(name) || type === 'image/gif';
}

/** Evenly pick up to `max` indices from `0 .. total-1`. */
export function sampleFrameIndices(total: number, max: number): number[] {
	if (total <= 0) return [];
	if (max <= 0) return [];
	if (total <= max) return Array.from({ length: total }, (_, i) => i);
	if (max === 1) return [0];
	const indices: number[] = [];
	for (let i = 0; i < max; i++) {
		const idx = Math.round((i * (total - 1)) / (max - 1));
		if (indices[indices.length - 1] !== idx) indices.push(idx);
	}
	// Ensure uniqueness if rounding collided
	return [...new Set(indices)].slice(0, max);
}

export function gifFrameTitle(baseTitle: string, frameNumber: number, sourceFrameCount: number): string {
	const base = baseTitle.trim() || 'GIF';
	if (sourceFrameCount <= 1) return base.slice(0, 200);
	return `${base} · f. ${frameNumber}`.slice(0, 200);
}

export function gifFrameSource(
	fileTitle: string,
	frameNumber: number,
	sourceFrameCount: number
): NoteSource {
	const title =
		sourceFrameCount > 1
			? `${fileTitle.trim() || 'GIF'} · f. ${frameNumber}/${sourceFrameCount}`.slice(0, 300)
			: (fileTitle.trim() || 'GIF').slice(0, 300);
	return {
		kind: 'image',
		title
	};
}

export function gifFrameDraft(
	dataUrl: string,
	baseTitle: string,
	frameNumber: number,
	sourceFrameCount: number,
	caption = ''
): GifCardDraft {
	const title = gifFrameTitle(baseTitle, frameNumber, sourceFrameCount);
	return {
		title,
		body: imageNoteBody(dataUrl, title, caption),
		source: gifFrameSource(baseTitle, frameNumber, sourceFrameCount)
	};
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

export async function inspectGif(input: Blob): Promise<GifInspectResult> {
	if (typeof input.size === 'number' && input.size > DESK_IMAGE_MAX_ORIGINAL_BYTES) {
		return { ok: false, error: 'too-large' };
	}
	try {
		const buffer = await input.arrayBuffer();
		const gif = parseGIF(buffer);
		const frames = decompressFrames(gif, true) as ParsedFrame[];
		const width = gif.lsd?.width ?? frames[0]?.dims?.width ?? 0;
		const height = gif.lsd?.height ?? frames[0]?.dims?.height ?? 0;
		if (!frames.length || !width || !height) return { ok: false, error: 'undecodable' };
		return {
			ok: true,
			animated: frames.length > 1,
			frameCount: frames.length,
			width,
			height
		};
	} catch (error) {
		console.error('inspectGif failed', error);
		return { ok: false, error: 'undecodable' };
	}
}

/**
 * Composite GIF frames and export selected frames as PNG data URLs (desk-sized).
 */
export async function explodeGifFrames(
	input: Blob,
	options?: { maxFrames?: number; maxEdge?: number; fileName?: string }
): Promise<GifExplodeResult> {
	if (typeof input.size === 'number' && input.size > DESK_IMAGE_MAX_ORIGINAL_BYTES) {
		return { ok: false, error: 'too-large' };
	}
	const maxFrames = options?.maxFrames ?? GIF_EXPLODE_MAX_FRAMES;
	const maxEdge = options?.maxEdge ?? DESK_IMAGE_MAX_EDGE;

	let gif: { lsd?: { width: number; height: number } };
	let rawFrames: ParsedFrame[];
	try {
		const buffer = await input.arrayBuffer();
		gif = parseGIF(buffer);
		rawFrames = decompressFrames(gif, true) as ParsedFrame[];
	} catch (error) {
		console.error('explodeGifFrames failed', error);
		return { ok: false, error: 'undecodable' };
	}

	const fullW = gif.lsd?.width ?? 0;
	const fullH = gif.lsd?.height ?? 0;
	if (!rawFrames.length || !fullW || !fullH) return { ok: false, error: 'empty' };

	if (typeof document === 'undefined') {
		return { ok: false, error: 'undecodable' };
	}

	const indices = sampleFrameIndices(rawFrames.length, maxFrames);
	const indexSet = new Set(indices);
	const sampled = indices.length < rawFrames.length;

	const canvas = document.createElement('canvas');
	canvas.width = fullW;
	canvas.height = fullH;
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (!ctx) return { ok: false, error: 'undecodable' };

	const patchCanvas = document.createElement('canvas');
	const patchCtx = patchCanvas.getContext('2d');
	if (!patchCtx) return { ok: false, error: 'undecodable' };

	const exportSize = scaleDimensions(fullW, fullH, maxEdge);
	const exportCanvas = document.createElement('canvas');
	exportCanvas.width = exportSize.width;
	exportCanvas.height = exportSize.height;
	const exportCtx = exportCanvas.getContext('2d');
	if (!exportCtx) return { ok: false, error: 'undecodable' };

	let previousImageData: ImageData | null = null;
	const out: GifExplodeFrame[] = [];

	for (let i = 0; i < rawFrames.length; i++) {
		const frame = rawFrames[i]!;
		const { left, top, width, height } = frame.dims;

		// Disposal 3: restore previous — save before drawing
		if (frame.disposalType === 3) {
			previousImageData = ctx.getImageData(0, 0, fullW, fullH);
		}

		if (frame.patch && width > 0 && height > 0) {
			patchCanvas.width = width;
			patchCanvas.height = height;
			const imageData = new ImageData(
				new Uint8ClampedArray(frame.patch),
				width,
				height
			);
			patchCtx.putImageData(imageData, 0, 0);
			ctx.drawImage(patchCanvas, left, top);
		}

		if (indexSet.has(i)) {
			exportCtx.clearRect(0, 0, exportSize.width, exportSize.height);
			exportCtx.drawImage(canvas, 0, 0, exportSize.width, exportSize.height);
			const dataUrl = exportCanvas.toDataURL('image/png');
			out.push({
				frameNumber: i + 1,
				sourceFrameCount: rawFrames.length,
				dataUrl,
				width: exportSize.width,
				height: exportSize.height,
				compacted: exportSize.scaled
			});
		}

		// Disposal after display
		if (frame.disposalType === 2) {
			ctx.clearRect(left, top, width, height);
		} else if (frame.disposalType === 3 && previousImageData) {
			ctx.putImageData(previousImageData, 0, 0);
			previousImageData = null;
		}
	}

	if (out.length === 0) return { ok: false, error: 'empty' };
	return { ok: true, frames: out, sampled };
}

/** Build desk drafts for still (first frame) or exploded frames. */
export async function draftsFromGif(
	input: Blob,
	mode: 'still' | 'frames',
	options?: { fileName?: string; caption?: string; maxFrames?: number }
): Promise<
	| { ok: true; drafts: GifCardDraft[]; frameCount: number; importedFrames: number; sampled: boolean }
	| { ok: false; error: 'too-large' | 'undecodable' | 'not-gif' | 'empty' }
> {
	const fileName = options?.fileName?.trim() || (input instanceof File ? input.name : 'animation.gif');
	const baseTitle = imageTitleFromFileName(fileName);
	const caption = options?.caption ?? '';

	const exploded = await explodeGifFrames(input, {
		fileName,
		maxFrames: mode === 'still' ? 1 : (options?.maxFrames ?? GIF_EXPLODE_MAX_FRAMES)
	});
	if (!exploded.ok) return { ok: false, error: exploded.error };

	const frames =
		mode === 'still' ? exploded.frames.slice(0, 1) : exploded.frames;
	const drafts = frames.map((frame) =>
		mode === 'still' && frames.length === 1
			? {
					title: baseTitle,
					body: imageNoteBody(frame.dataUrl, baseTitle, caption),
					source: imageNoteSource(fileName || baseTitle)
				}
			: gifFrameDraft(
					frame.dataUrl,
					baseTitle,
					frame.frameNumber,
					frame.sourceFrameCount,
					caption
				)
	);

	return {
		ok: true,
		drafts,
		frameCount: frames[0]?.sourceFrameCount ?? frames.length,
		importedFrames: drafts.length,
		sampled: mode === 'frames' && exploded.sampled
	};
}
