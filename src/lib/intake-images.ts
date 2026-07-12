/**
 * Pure-ish image intake: files → desk note drafts (with mash-blob: bodies).
 * Callers place drafts on the canvas and handle animated-GIF dialogs.
 */
import {
	DESK_IMAGE_MAX_PER_ACTION,
	isGifFile,
	persistImageNoteBody,
	prepareDeskImage,
	imageNoteSource
} from './desk-image';
import type { Note } from './types';

export type ImageStickyDraft = {
	title: string;
	body: string;
	source?: Note['source'];
};

export type PrepareImageIntakeResult = {
	drafts: ImageStickyDraft[];
	animatedGifs: File[];
	compacted: number;
	failed: number;
	skippedCap: number;
	/** Toast-worthy errors already formatted for one-off files. */
	errors: string[];
};

/**
 * Decode, soft-resize, and persist non-animated images as blob-backed drafts.
 * Animated GIFs are returned separately for explode UI (not still-encoded here).
 */
export async function prepareImageIntakeFromFiles(
	files: File[],
	options?: { caption?: string; titleOverride?: string }
): Promise<PrepareImageIntakeResult> {
	const capped = files.slice(0, DESK_IMAGE_MAX_PER_ACTION);
	const skippedCap = Math.max(0, files.length - capped.length);
	const drafts: ImageStickyDraft[] = [];
	const animatedGifs: File[] = [];
	const errors: string[] = [];
	let compacted = 0;
	let failed = 0;

	const { inspectGif } = await import('$lib/gif-explode');
	for (const file of capped) {
		if (isGifFile(file)) {
			const inspected = await inspectGif(file);
			if (inspected.ok && inspected.animated) {
				animatedGifs.push(file);
				continue;
			}
		}
		const prepared = await prepareDeskImage(file, {
			fileName: file.name,
			titleHint: options?.titleOverride
		});
		if (!prepared.ok) {
			failed++;
			if (prepared.error === 'too-large') {
				errors.push(`Image too large to import (max 20 MB): ${file.name}`);
			} else if (prepared.error === 'unsupported') {
				errors.push(`Can't import ${file.name} — try PNG, JPEG, WebP, or GIF`);
			}
			continue;
		}
		if (prepared.compacted) compacted++;
		const title = options?.titleOverride?.trim() || prepared.titleHint;
		const sourceTitle = file.name?.trim() || title;
		const { body } = await persistImageNoteBody(prepared.dataUrl, title, options?.caption ?? '', {
			width: prepared.width,
			height: prepared.height
		});
		drafts.push({
			title,
			body,
			source: imageNoteSource(sourceTitle)
		});
	}

	return { drafts, animatedGifs, compacted, failed, skippedCap, errors };
}
