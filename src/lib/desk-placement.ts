/**
 * Place note drafts / images / GIF frames on the active desk canvas.
 */
import { addNoteToCanvas, createNote } from './db';
import { extractWikilinks } from './markdown';
import { COLLAPSED_CARD } from './stores/canvas-session.svelte';
import { DESK_IMAGE_MAX_PER_ACTION } from './desk-image';
import { prepareImageIntakeFromFiles } from './intake-images';
import type { Note } from './types';
import type { GifExplodeMode } from './gif-explode';

export type DeskPlacementDeps = {
	flashToast: (msg: string, ms?: number) => void;
	getActiveCanvasId: () => string | null | undefined;
	getCanvasFolder: () => string;
	activeNoteOwnership: () => { sessionId?: string; scope?: 'session' | 'kept' };
	getCanvasItemCount: () => number;
	getSpawnPoint: (
		size: { w: number; h: number },
		index: number
	) => { x: number; y: number } | undefined;
	refreshCanvasItems: () => Promise<void>;
	adoptNotesToLibrary: (notes: Note[]) => void;
	setSelection: (ids: string[], primary: string | null) => void;
	setSettlingIds: (ids: Set<string>) => void;
	ensureNoteVisible: (noteId: string) => void;
	recordMeaningfulActivity: () => void;
	queueGifExplodeChoice: (
		file: File | Blob,
		fileName: string,
		frameCount: number,
		origin?: { x: number; y: number },
		caption?: string
	) => void;
};

export function createDeskPlacement(deps: DeskPlacementDeps) {
	async function placeNoteDraftsOnDesk(
		drafts: Array<{ title: string; body: string; source?: Note['source']; tags?: string[] }>,
		origin?: { x: number; y: number }
	): Promise<Note[]> {
		const canvasId = deps.getActiveCanvasId();
		if (!canvasId) {
			deps.flashToast('Desk is still getting ready');
			return [];
		}
		if (drafts.length === 0) return [];
		const spawn = origin ??
			deps.getSpawnPoint(COLLAPSED_CARD, deps.getCanvasItemCount()) ?? {
				x: 80,
				y: 80
			};
		const columns = Math.min(3, Math.max(1, drafts.length));
		const createdNotes: Note[] = [];
		const placedIds: string[] = [];
		for (let index = 0; index < drafts.length; index++) {
			const draft = drafts[index]!;
			const note = await createNote({
				...deps.activeNoteOwnership(),
				title: draft.title,
				body: draft.body,
				folder: deps.getCanvasFolder(),
				tags: draft.tags ?? [],
				links: extractWikilinks(draft.body),
				...(draft.source ? { source: draft.source } : {})
			});
			createdNotes.push(note);
			const item = await addNoteToCanvas(canvasId, note.id, {
				x: spawn.x + (index % columns) * (COLLAPSED_CARD.w + 24),
				y: spawn.y + Math.floor(index / columns) * (COLLAPSED_CARD.h + 24),
				w: COLLAPSED_CARD.w,
				h: COLLAPSED_CARD.h
			});
			placedIds.push(item.id);
		}
		deps.adoptNotesToLibrary(createdNotes);
		await deps.refreshCanvasItems();
		deps.setSelection(
			createdNotes.map((note) => note.id),
			createdNotes[0]?.id ?? null
		);
		deps.setSettlingIds(new Set(placedIds));
		setTimeout(() => {
			deps.setSettlingIds(new Set());
		}, 320);
		if (createdNotes[0]) deps.ensureNoteVisible(createdNotes[0].id);
		deps.recordMeaningfulActivity();
		return createdNotes;
	}

	async function placeGifAsDrafts(
		blob: Blob,
		mode: GifExplodeMode,
		opts: { fileName: string; origin?: { x: number; y: number }; caption?: string }
	): Promise<number> {
		const { draftsFromGif } = await import('./gif-explode');
		const result = await draftsFromGif(blob, mode, {
			fileName: opts.fileName,
			caption: opts.caption
		});
		if (!result.ok) {
			if (result.error === 'too-large') {
				deps.flashToast('Image too large to import (max 20 MB)', 3200);
			} else {
				deps.flashToast("Couldn't explode that GIF — try another file", 3200);
			}
			return 0;
		}
		const notes = await placeNoteDraftsOnDesk(result.drafts, opts.origin);
		if (notes.length === 0) return 0;
		const parts: string[] = [];
		if (mode === 'still') {
			parts.push('Added 1 image card');
		} else {
			parts.push(notes.length === 1 ? 'Exploded 1 frame' : `Exploded ${notes.length} frames`);
			if (result.sampled) {
				parts.push(`sampled from ${result.frameCount}`);
			}
		}
		deps.flashToast(parts.join(' · '), 3600);
		return notes.length;
	}

	async function createVisualStickiesFromFiles(
		files: File[],
		origin?: { x: number; y: number },
		options?: { caption?: string; titleOverride?: string }
	): Promise<{ created: number; compacted: number; failed: number; skippedCap: number }> {
		const intake = await prepareImageIntakeFromFiles(files, options);
		for (const msg of intake.errors.slice(0, 3)) deps.flashToast(msg, 3200);

		const notes = await placeNoteDraftsOnDesk(intake.drafts, origin);
		let created = notes.length;
		let failed = intake.failed;
		const compacted = intake.compacted;
		const skippedCap = intake.skippedCap;
		const animatedGifs = intake.animatedGifs;

		if (animatedGifs.length === 1) {
			const gif = animatedGifs[0]!;
			const { inspectGif } = await import('./gif-explode');
			const inspected = await inspectGif(gif);
			if (inspected.ok) {
				deps.queueGifExplodeChoice(
					gif,
					gif.name || 'animation.gif',
					inspected.frameCount,
					origin,
					options?.caption
				);
			} else {
				failed++;
			}
		} else if (animatedGifs.length > 1) {
			for (const gif of animatedGifs) {
				const n = await placeGifAsDrafts(gif, 'still', {
					fileName: gif.name || 'animation.gif',
					origin,
					caption: options?.caption
				});
				created += n;
			}
			deps.flashToast(
				`Imported ${animatedGifs.length} GIFs as stills — drop one GIF to explode frames`,
				4200
			);
		}

		return { created, compacted, failed, skippedCap };
	}

	async function handleOpenImageFiles(files: File[]) {
		if (!files.length) return;
		const result = await createVisualStickiesFromFiles(files);
		const parts: string[] = [];
		if (result.created > 0) {
			parts.push(
				result.created === 1 ? 'Added 1 image card' : `Added ${result.created} image cards`
			);
		}
		if (result.compacted > 0) {
			parts.push(
				result.compacted === 1
					? 'Image resized for the desk'
					: `${result.compacted} images resized for the desk`
			);
		}
		if (result.skippedCap > 0) {
			parts.push(`Imported ${DESK_IMAGE_MAX_PER_ACTION} of ${files.length} images`);
		}
		if (result.created === 0 && result.failed > 0) {
			parts.push('No images imported');
		}
		if (parts.length > 0) deps.flashToast(parts.join(' · '), 3600);
	}

	return {
		placeNoteDraftsOnDesk,
		placeGifAsDrafts,
		createVisualStickiesFromFiles,
		handleOpenImageFiles
	};
}

export type DeskPlacement = ReturnType<typeof createDeskPlacement>;
