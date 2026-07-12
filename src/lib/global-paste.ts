/**
 * Desk-level paste intake (images, URL lines, multi-line text → cards).
 */
import { clipboardImageBlob, isGifFile, persistImageNoteBody, prepareDeskImage, imageNoteSource } from './desk-image';
import {
	analyzePastedText,
	draftsFromPastedText,
	type PasteAnalysis,
	type PasteSplitMode
} from './paste-cards';
import { draftsFromUrlOnlyText, URL_SOURCE_MAX_PER_PASTE } from './url-source';
import type { Note } from './types';

export type GlobalPasteDeps = {
	flashToast: (msg: string, ms?: number) => void;
	/** When true, paste is ignored (modals, readers, stage, etc.). */
	isPasteBlocked: () => boolean;
	placeNoteDraftsOnDesk: (
		drafts: Array<{ title: string; body: string; source?: Note['source'] }>
	) => Promise<Note[]>;
	queueGifExplodeChoice: (
		file: File | Blob,
		fileName: string,
		frameCount: number,
		origin: undefined,
		caption?: string
	) => void;
	openPasteDialog: (analysis: PasteAnalysis) => void;
	closePasteDialog: () => void;
};

export function isEditablePasteTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	return Boolean(target.closest('input, textarea, [contenteditable="true"], [role="textbox"]'));
}

export function createGlobalPasteHandler(deps: GlobalPasteDeps) {
	async function createCardsFromPaste(analysis: PasteAnalysis, mode: PasteSplitMode) {
		const drafts = draftsFromPastedText(analysis.text, mode);
		if (drafts.length === 0) return;
		const createdNotes = await deps.placeNoteDraftsOnDesk(drafts);
		deps.closePasteDialog();
		if (createdNotes.length > 0) {
			deps.flashToast(
				createdNotes.length === 1 ? 'Pasted 1 card' : `Pasted ${createdNotes.length} cards`
			);
		}
	}

	function handleGlobalPaste(event: ClipboardEvent) {
		if (isEditablePasteTarget(event.target)) return;
		if (deps.isPasteBlocked()) return;

		const imageBlob = clipboardImageBlob(event.clipboardData);
		const text = event.clipboardData?.getData('text/plain') ?? '';
		if (imageBlob) {
			event.preventDefault();
			void (async () => {
				const caption = text.trim();
				const fileName =
					imageBlob instanceof File && imageBlob.name
						? imageBlob.name
						: isGifFile({ name: '', type: imageBlob.type })
							? 'clipboard.gif'
							: 'clipboard.png';
				if (isGifFile({ name: fileName, type: imageBlob.type })) {
					const { inspectGif } = await import('./gif-explode');
					const inspected = await inspectGif(imageBlob);
					if (inspected.ok && inspected.animated) {
						deps.queueGifExplodeChoice(
							imageBlob,
							fileName,
							inspected.frameCount,
							undefined,
							caption
						);
						return;
					}
				}
				const prepared = await prepareDeskImage(imageBlob, {
					fileName,
					titleHint: 'Pasted image'
				});
				if (!prepared.ok) {
					if (prepared.error === 'too-large') {
						deps.flashToast('Image too large to import (max 20 MB)', 3200);
					} else {
						deps.flashToast("Can't import that image — try PNG, JPEG, WebP, or GIF", 3200);
					}
					return;
				}
				const title = prepared.titleHint || 'Pasted image';
				const { body } = await persistImageNoteBody(
					prepared.dataUrl,
					title,
					caption,
					{ width: prepared.width, height: prepared.height }
				);
				const notes = await deps.placeNoteDraftsOnDesk([
					{
						title,
						body,
						source: imageNoteSource(
							imageBlob instanceof File && imageBlob.name ? imageBlob.name : 'Clipboard'
						)
					}
				]);
				if (notes.length > 0) {
					const bits = [
						notes.length === 1 ? 'Pasted image card' : `Pasted ${notes.length} image cards`
					];
					if (prepared.compacted) bits.push('Image resized for the desk');
					deps.flashToast(bits.join(' · '));
				}
			})();
			return;
		}

		const urlDrafts = draftsFromUrlOnlyText(text);
		if (urlDrafts) {
			event.preventDefault();
			void (async () => {
				const notes = await deps.placeNoteDraftsOnDesk(urlDrafts);
				if (notes.length === 0) return;
				const totalLines = text
					.replace(/\r\n?/g, '\n')
					.split('\n')
					.map((l) => l.trim())
					.filter(Boolean).length;
				const parts = [
					notes.length === 1 ? 'Pasted 1 link card' : `Pasted ${notes.length} link cards`
				];
				if (totalLines > URL_SOURCE_MAX_PER_PASTE) {
					parts.push(`Imported ${URL_SOURCE_MAX_PER_PASTE} of ${totalLines} links`);
				}
				deps.flashToast(parts.join(' · '));
			})();
			return;
		}

		const analysis = analyzePastedText(text);
		if (!analysis.text) return;
		event.preventDefault();
		if (analysis.lines.length <= 1 && analysis.paragraphs.length <= 1) {
			void createCardsFromPaste(analysis, 'single');
			return;
		}
		deps.openPasteDialog(analysis);
	}

	return { handleGlobalPaste, createCardsFromPaste, isEditablePasteTarget };
}
