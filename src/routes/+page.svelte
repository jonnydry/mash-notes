<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import {
		addNoteToCanvas,
		createNote,
		db,
		deleteNote,
		getActiveNotes,
		getCanvasItems,
		getOrCreateFolderCanvas,
		removeCanvasItem,
		removeNotesFromCanvas,
		syncNoteUpdate,
		updateCanvasItemPosition
	} from '$lib/db';
	import {
		initSearchIndex,
		updateNoteInSearch,
		addNoteToSearch,
		removeNoteFromSearch
	} from '$lib/search';
	import type { Canvas, CanvasItem, Note } from '$lib/types';
	import {
		Search,
		Command,
		Copy,
		Download,
		Layers,
		X,
		Trash2,
		Folder,
		Tag,
		AlignLeft,
		AlignCenter,
		AlignRight,
		AlignStartVertical,
		AlignCenterVertical,
		AlignEndVertical,
		StretchHorizontal,
		StretchVertical,
		LayoutGrid
	} from 'lucide-svelte';
	import MashDock from '$lib/components/MashDock.svelte';
	import PeelScanner from '$lib/components/PeelScanner.svelte';
	import CanvasBoard from '$lib/components/CanvasBoard.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import type { DockAction } from '$lib/dock';
	import type { PeelMode } from '$lib/components/PeelScanner.svelte';
	import { isBlankUntitledNote, notePreview } from '$lib/format';
	import { extractWikilinks } from '$lib/markdown';
	import { parseNotesJson } from '$lib/import-notes';
	import { type NavFilter } from '$lib/note-ui';
	import {
		combineNotes,
		copyText,
		exportNotesJson,
		exportNotesMarkdown,
		notesFromSelection
	} from '$lib/mash';
	import { clearCanvasViewport } from '$lib/viewport';
	import {
		clearDismissedForCanvas,
		dismissNoteFromCanvas,
		getDismissedNoteIds,
		undismissNotesFromCanvas
	} from '$lib/canvas-dismiss';
	import {
		CanvasUndoStack,
		rangeBetween,
		spatialNoteOrder,
		type CanvasLayoutSnapshot
	} from '$lib/canvas-undo';
	import { bumpOverlappingRects, type AlignMode } from '$lib/canvas-geom';
	import { findBacklinks, findOutgoingNotes } from '$lib/links';
	import { parseSyncBundle, mergeSyncBundle, downloadSyncBundle } from '$lib/sync-file';
	import {
		NOTE_MIME,
		COLLAPSED_CARD,
		EXPANDED_CARD,
		BUMP_GAP
	} from '$lib/stores/canvas-session';
	import {
		filterNotes,
		filterPeelNotes,
		uniqueFoldersFrom,
		uniqueTagsFrom,
		canvasFolderFromFilter,
		canvasTitleFromFilter
	} from '$lib/stores/note-library';
	import {
		peelTitleFor,
		peelOpenPatch,
		peelClosePatch,
		dispatchDockAction,
		windowPeelNotes
	} from '$lib/stores/peel-nav';

	let notes = $state<Note[]>([]);
	let selectedId = $state<string | null>(null);
	let selectionIds = $state<string[]>([]);
	let searchQuery = $state('');
	let currentFilter = $state<NavFilter>({ type: null });
	let activeCanvas = $state<Canvas | null>(null);
	let canvasItems = $state<CanvasItem[]>([]);
	let actionToast = $state('');
	let toastTimer: ReturnType<typeof setTimeout> | null = null;
	let expandedNoteId = $state<string | null>(null);
	/** Original neighbor positions before expand-bump; restored on collapse. */
	let bumpRestore: Map<string, { x: number; y: number }> | null = $state(null);
	let settlingIds = $state<Set<string>>(new Set());
	let draggingTrayId = $state<string | null>(null);
	let canvasLoadSeq = 0;
	const stickySaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
	let stickySaveStatusClear: ReturnType<typeof setTimeout> | null = null;
	const canvasUndo = new CanvasUndoStack();
	let canvasUndoTick = $state(0);
	let canCanvasUndo = $derived.by(() => {
		canvasUndoTick;
		return canvasUndo.canUndo;
	});
	let canCanvasRedo = $derived.by(() => {
		canvasUndoTick;
		return canvasUndo.canRedo;
	});

	let peelOpen = $state(false);
	let peelPinned = $state(false);
	let peelMode = $state<PeelMode>('notes');
	let peelFilterText = $state('');
	let foldersFlyout = $state(false);
	let tagsFlyout = $state(false);
	let linkedFlyout = $state(false);
	let linkedFocusId = $state<string | null>(null);
	let bulkMenu = $state<'tag' | 'folder' | 'align' | null>(null);
	let bulkTagDraft = $state('');
	let bulkFolderDraft = $state('');
	let expandFocus = $state<'title' | 'body' | null>(null);
	let touchPlaceGhost = $state<{
		noteId: string;
		clientX: number;
		clientY: number;
	} | null>(null);
	let canvasBoard: {
		getSpawnPoint: (size: { w: number; h: number }, cascadeIndex?: number) => { x: number; y: number };
		ensureNoteVisible: (noteId: string) => void;
		applyAlign: (mode: AlignMode) => void;
		clientToWorld?: (clientX: number, clientY: number) => { x: number; y: number };
	} | undefined = $state();
	let confirmDialog = $state<{
		title: string;
		message: string;
		confirmLabel: string;
		danger: boolean;
		action: () => void | Promise<void>;
	} | null>(null);

	let selectedNote = $derived(notes.find((n) => n.id === selectedId) ?? null);
	let selectionSet = $derived(new Set(selectionIds));
	let selectedNotes = $derived(notesFromSelection(notes, selectionIds));
	let notesById = $derived(new Map(notes.map((n) => [n.id, n])));
	let canvasFolder = $derived(canvasFolderFromFilter(currentFilter));
	let filteredNotes = $derived(filterNotes(notes, currentFilter, searchQuery));
	let uniqueFolders = $derived(uniqueFoldersFrom(notes));
	let uniqueTags = $derived(uniqueTagsFrom(notes));
	let peelNotes = $derived(filterPeelNotes(filteredNotes, peelFilterText));
	let linkedFocusNote = $derived(
		linkedFocusId
			? (notes.find((n) => n.id === linkedFocusId) ?? null)
			: expandedNoteId
				? (notes.find((n) => n.id === expandedNoteId) ?? null)
				: selectedNote
	);
	let linkedOutgoing = $derived(
		linkedFocusNote ? findOutgoingNotes(notes, linkedFocusNote) : []
	);
	let linkedBacklinks = $derived(
		linkedFocusNote ? findBacklinks(notes, linkedFocusNote) : []
	);
	let peelTitle = $derived(peelTitleFor(peelMode, searchQuery, currentFilter));
	let peelNotesWindowed = $derived(windowPeelNotes(peelNotes));
	let canvasTitle = $derived(canvasTitleFromFilter(currentFilter));

	let isLoading = $state(true);
	let saveStatus = $state<'saved' | 'saving' | ''>('');
	let showPalette = $state(false);
	let paletteQuery = $state('');
	let paletteInput = $state<HTMLInputElement | null>(null);
	let paletteHighlight = $state(0);

	$effect(() => {
		if (!showPalette) return;
		paletteHighlight = 0;
		void tick().then(() => paletteInput?.focus());
	});

	$effect(() => {
		paletteQuery;
		paletteHighlight = 0;
	});

	let loadError = $state('');
	let importInputEl: HTMLInputElement | undefined = $state();
	let syncInputEl: HTMLInputElement | undefined = $state();

	function flashToast(msg: string) {
		actionToast = msg;
		if (toastTimer) clearTimeout(toastTimer);
		toastTimer = setTimeout(() => {
			actionToast = '';
		}, 1600);
	}

	function clearSelection() {
		selectionIds = [];
		bulkMenu = null;
	}

	function toggleSelection(id: string, opts?: { additive?: boolean; range?: boolean }) {
		const additive = opts?.additive ?? false;
		const range = opts?.range ?? false;

		if (range && selectedId) {
			const ids = filteredNotes.map((n) => n.id);
			const from = ids.indexOf(selectedId);
			const to = ids.indexOf(id);
			if (from >= 0 && to >= 0) {
				const [lo, hi] = from < to ? [from, to] : [to, from];
				const rangeIds = ids.slice(lo, hi + 1);
				const next = new Set(additive ? selectionIds : []);
				for (const rid of rangeIds) next.add(rid);
				selectionIds = [...next];
				return;
			}
		}

		if (additive) {
			if (selectionSet.has(id)) {
				selectionIds = selectionIds.filter((x) => x !== id);
			} else {
				selectionIds = [...selectionIds, id];
			}
			return;
		}

		selectionIds = [id];
	}

	function handleNoteClick(id: string, e: MouseEvent) {
		if (e.metaKey || e.ctrlKey || e.shiftKey) {
			e.preventDefault();
			toggleSelection(id, {
				additive: e.metaKey || e.ctrlKey || selectionIds.length > 0,
				range: e.shiftKey
			});
			selectNote(id, { keepSelection: true });
			return;
		}
		selectNote(id);
	}

	/**
	 * Mash notes into a new note + canvas bubble.
	 * Source notes stay in the library; their canvas cards are removed and can be restored via Unmash.
	 */
	async function mashNotesIntoBubble(
		sourceNotes: Note[],
		opts?: { x?: number; y?: number; removeItemIds?: string[] }
	) {
		if (sourceNotes.length < 2) {
			flashToast('Pick at least two notes to mash');
			return;
		}
		if (!activeCanvas) {
			flashToast('Canvas not ready');
			return;
		}

		const body = combineNotes(sourceNotes);
		const title =
			sourceNotes.length === 2
				? `${sourceNotes[0].title} + ${sourceNotes[1].title}`.slice(0, 200)
				: `Mash of ${sourceNotes.length} notes`;

		const xs = opts?.x;
		const ys = opts?.y;
		let placeX = xs ?? 80;
		let placeY = ys ?? 80;
		if (xs === undefined || ys === undefined) {
			const onBoard = canvasItems.filter((i) =>
				sourceNotes.some((n) => n.id === i.noteId)
			);
			if (onBoard.length > 0) {
				placeX = onBoard.reduce((s, i) => s + i.x, 0) / onBoard.length;
				placeY = onBoard.reduce((s, i) => s + i.y, 0) / onBoard.length;
			}
		}

		const sourceIds = sourceNotes.map((n) => n.id);
		const mergedTags = [
			...new Set(['mash', ...sourceNotes.flatMap((n) => n.tags)])
		];
		const mashed = await createNote({
			title,
			body,
			folder: canvasFolder,
			tags: mergedTags,
			links: extractWikilinks(body),
			mashedFrom: sourceIds
		});
		addNoteToSearch(mashed);
		notes = [mashed, ...notes];

		const removeIds =
			opts?.removeItemIds ??
			canvasItems.filter((i) => sourceIds.includes(i.noteId)).map((i) => i.id);
		for (const id of removeIds) {
			await removeCanvasItem(id);
		}
		// Keep mashed sources off folder canvases until Unmash / drop-back.
		for (const noteId of sourceIds) {
			dismissNoteFromCanvas(activeCanvas.id, noteId);
		}
		canvasUndo.clear();
		canvasUndoTick++;

		const item = await addNoteToCanvas(activeCanvas.id, mashed.id, {
			x: placeX,
			y: placeY,
			w: EXPANDED_CARD.w,
			h: EXPANDED_CARD.h
		});
		await refreshCanvasItems();
		selectionIds = [mashed.id];
		selectedId = mashed.id;
		expandedNoteId = mashed.id;
		settlingIds = new Set([item.id]);
		setTimeout(() => {
			settlingIds = new Set();
		}, 320);
		flashToast('Mashed — use Unmash to restore sources');
	}

	async function combineSelection() {
		await mashNotesIntoBubble(selectedNotes);
	}

	/** Restore source notes onto the canvas and remove the mash bubble. */
	async function unmashSelection() {
		if (!activeCanvas) return;
		const mashNotes = selectedNotes.filter((n) => n.mashedFrom && n.mashedFrom.length > 0);
		if (mashNotes.length === 0) {
			flashToast('Select a mashed sticky to unmash');
			return;
		}

		const placed: string[] = [];
		let missingSources = 0;
		for (const mash of mashNotes) {
			const sourceIds = mash.mashedFrom ?? [];
			const sources = sourceIds
				.map((id) => notes.find((n) => n.id === id))
				.filter((n): n is Note => Boolean(n));
			missingSources += sourceIds.length - sources.length;
			const mashItem = canvasItems.find((i) => i.noteId === mash.id);
			const baseX = mashItem?.x ?? 80;
			const baseY = mashItem?.y ?? 80;

			if (mashItem) {
				await removeCanvasItem(mashItem.id);
			}
			undismissNotesFromCanvas(
				activeCanvas.id,
				sources.map((s) => s.id)
			);

			for (let i = 0; i < sources.length; i++) {
				const item = await addNoteToCanvas(activeCanvas.id, sources[i].id, {
					x: baseX + i * 28,
					y: baseY + i * 24,
					w: COLLAPSED_CARD.w,
					h: COLLAPSED_CARD.h
				});
				placed.push(item.id);
			}

			await deleteNote(mash.id);
			removeNoteFromSearch(mash.id);
			notes = notes.filter((n) => n.id !== mash.id);
			if (expandedNoteId === mash.id) expandedNoteId = null;
		}

		await refreshCanvasItems();
		selectionIds = [];
		selectedId = null;
		settlingIds = new Set(placed);
		setTimeout(() => {
			settlingIds = new Set();
		}, 320);
		flashToast(
			missingSources > 0
				? `Unmashed — ${missingSources} source${missingSources === 1 ? '' : 's'} missing`
				: 'Unmashed — sources restored'
		);
	}

	let canUnmash = $derived(
		selectedNotes.some((n) => Boolean(n.mashedFrom && n.mashedFrom.length > 0))
	);

	async function copySelection(sourceNotes: Note[] = selectedNotes) {
		if (sourceNotes.length === 0) {
			flashToast('Select notes to copy');
			return;
		}
		const ok = await copyText(combineNotes(sourceNotes));
		flashToast(
			ok
				? `Copied ${sourceNotes.length} note${sourceNotes.length > 1 ? 's' : ''}`
				: 'Clipboard unavailable'
		);
	}

	function exportSelectionMarkdown(sourceNotes: Note[] = selectedNotes) {
		if (sourceNotes.length === 0) {
			flashToast('Select notes to export');
			return;
		}
		exportNotesMarkdown(sourceNotes);
		flashToast(`Exported ${sourceNotes.length} as Markdown`);
	}

	function exportSelectionJson(sourceNotes: Note[] = selectedNotes) {
		if (sourceNotes.length === 0) {
			flashToast('Select notes to export');
			return;
		}
		exportNotesJson(sourceNotes);
		flashToast(`Exported ${sourceNotes.length} as JSON`);
	}

	async function loadContextCanvas(folder: string) {
		const seq = ++canvasLoadSeq;
		try {
			const canvas = await getOrCreateFolderCanvas(folder);
			if (seq !== canvasLoadSeq) return;
			activeCanvas = canvas;
			let items = await getCanvasItems(canvas.id);
			if (seq !== canvasLoadSeq) return;

			// Folder canvases mirror membership: add missing notes, prune leavers.
			// Notes the user removed from the board stay dismissed until dropped back.
			if (folder) {
				const folderNotes = notes.filter(
					(n) => n.folder === folder || n.folder.startsWith(folder + '/')
				);
				const folderNoteIds = new Set(folderNotes.map((n) => n.id));
				const dismissed = getDismissedNoteIds(canvas.id);
				const staleIds = items
					.filter((i) => !folderNoteIds.has(i.noteId))
					.map((i) => i.noteId);
				if (staleIds.length > 0) {
					await removeNotesFromCanvas(canvas.id, staleIds);
					if (seq !== canvasLoadSeq) return;
					items = items.filter((i) => folderNoteIds.has(i.noteId));
				}

				const onCanvas = new Set(items.map((i) => i.noteId));
				const missing = folderNotes.filter(
					(n) => !onCanvas.has(n.id) && !dismissed.has(n.id)
				);
				if (missing.length > 0) {
					await Promise.all(
						missing.map((note, i) => {
							const idx = items.length + i;
							return addNoteToCanvas(canvas.id, note.id, {
								x: 40 + (idx % 4) * 240,
								y: 40 + Math.floor(idx / 4) * 160,
								w: COLLAPSED_CARD.w,
								h: COLLAPSED_CARD.h
							});
						})
					);
					if (seq !== canvasLoadSeq) return;
					items = await getCanvasItems(canvas.id);
				}
			}

			if (seq !== canvasLoadSeq) return;
			// Preserve optimistic drag/resize positions if a reload races mid-gesture.
			const localById = new Map(canvasItems.map((i) => [i.id, i]));
			canvasItems = items.map((item) => {
				const local = localById.get(item.id);
				if (!local) return item;
				if (
					local.x !== item.x ||
					local.y !== item.y ||
					local.w !== item.w ||
					local.h !== item.h
				) {
					return { ...item, x: local.x, y: local.y, w: local.w, h: local.h };
				}
				return item;
			});
			if (expandedNoteId && !items.some((i) => i.noteId === expandedNoteId)) {
				expandedNoteId = null;
				expandFocus = null;
				bumpRestore = null;
			}
		} catch (e) {
			if (seq !== canvasLoadSeq) return;
			console.error('Failed to load canvas', e);
			activeCanvas = null;
			canvasItems = [];
		}
	}

	/** Re-run canvas load when folder context or folder membership changes. */
	let folderMembershipKey = $derived.by(() => {
		if (!canvasFolder) return '';
		return notes
			.filter((n) => n.folder === canvasFolder || n.folder.startsWith(canvasFolder + '/'))
			.map((n) => n.id)
			.sort()
			.join(',');
	});

	$effect(() => {
		canvasFolder;
		folderMembershipKey;
		// untrack: canvasUndoTick++ both reads and writes — would infinite-loop the effect.
		untrack(() => {
			canvasUndo.clear();
			canvasUndoTick++;
			bumpRestore = null;
		});
		void loadContextCanvas(canvasFolder);
	});

	async function refreshCanvasItems() {
		if (!activeCanvas) return;
		canvasItems = await getCanvasItems(activeCanvas.id);
	}

	async function handleDropNotes(noteIds: string[], x: number, y: number) {
		if (!activeCanvas || noteIds.length === 0) return;
		undismissNotesFromCanvas(activeCanvas.id, noteIds);
		const placed: string[] = [];
		for (let i = 0; i < noteIds.length; i++) {
			const dropX = x + i * 28;
			const dropY = y + i * 24;
			const existing = canvasItems.find((item) => item.noteId === noteIds[i]);
			if (existing) {
				canvasItems = canvasItems.map((item) =>
					item.id === existing.id ? { ...item, x: dropX, y: dropY } : item
				);
				await updateCanvasItemPosition(existing.id, { x: dropX, y: dropY });
				placed.push(existing.id);
				continue;
			}
			const item = await addNoteToCanvas(activeCanvas.id, noteIds[i], {
				x: dropX,
				y: dropY,
				w: COLLAPSED_CARD.w,
				h: COLLAPSED_CARD.h
			});
			placed.push(item.id);
		}
		await refreshCanvasItems();
		selectionIds = [...noteIds];
		selectedId = noteIds[0] ?? null;
		settlingIds = new Set(placed);
		setTimeout(() => {
			settlingIds = new Set();
		}, 320);
		flashToast(`Dropped ${noteIds.length} on canvas`);
	}

	function snapshotItems(itemIds: string[]): CanvasLayoutSnapshot[] {
		const out: CanvasLayoutSnapshot[] = [];
		for (const id of itemIds) {
			const item = canvasItems.find((i) => i.id === id);
			if (!item) continue;
			out.push({ itemId: id, x: item.x, y: item.y, w: item.w, h: item.h });
		}
		return out;
	}

	function applyLayoutSnapshots(snaps: CanvasLayoutSnapshot[]) {
		const byId = new Map(snaps.map((s) => [s.itemId, s]));
		canvasItems = canvasItems.map((item) => {
			const s = byId.get(item.id);
			return s ? { ...item, x: s.x, y: s.y, w: s.w, h: s.h } : item;
		});
		void Promise.all(
			snaps.map((s) =>
				updateCanvasItemPosition(s.itemId, { x: s.x, y: s.y, w: s.w, h: s.h })
			)
		);
	}

	function pushCanvasUndo(
		label: string,
		before: CanvasLayoutSnapshot[],
		after: CanvasLayoutSnapshot[]
	) {
		canvasUndo.push({ label, before, after });
		canvasUndoTick++;
	}

	function undoCanvasLayout() {
		const entry = canvasUndo.undo();
		canvasUndoTick++;
		if (!entry) return;
		applyLayoutSnapshots(entry.before);
		flashToast(`Undo ${entry.label}`);
	}

	function redoCanvasLayout() {
		const entry = canvasUndo.redo();
		canvasUndoTick++;
		if (!entry) return;
		applyLayoutSnapshots(entry.after);
		flashToast(`Redo ${entry.label}`);
	}

	function handleCanvasMove(itemId: string, x: number, y: number) {
		// Optimistic only — persist on drag end to avoid IndexedDB thrash.
		canvasItems = canvasItems.map((item) => (item.id === itemId ? { ...item, x, y } : item));
	}

	function handleCanvasMoveMany(moves: Array<{ itemId: string; x: number; y: number }>) {
		const byId = new Map(moves.map((m) => [m.itemId, m]));
		canvasItems = canvasItems.map((item) => {
			const m = byId.get(item.id);
			return m ? { ...item, x: m.x, y: m.y } : item;
		});
	}

	async function handleCanvasMoveEnd(
		moves: Array<{ itemId: string; x: number; y: number }>,
		before?: Array<{ itemId: string; x: number; y: number }>,
		opts?: { recordUndo?: boolean }
	) {
		const beforeSnaps =
			before?.map((b) => {
				const cur = canvasItems.find((i) => i.id === b.itemId);
				return { itemId: b.itemId, x: b.x, y: b.y, w: cur?.w, h: cur?.h };
			}) ?? snapshotItems(moves.map((m) => m.itemId));
		handleCanvasMoveMany(moves);
		const afterSnaps = moves.map((m) => {
			const cur = canvasItems.find((i) => i.id === m.itemId);
			return { itemId: m.itemId, x: m.x, y: m.y, w: cur?.w, h: cur?.h };
		});
		if (opts?.recordUndo !== false) {
			pushCanvasUndo(moves.length > 1 ? 'Arrange' : 'Move', beforeSnaps, afterSnaps);
		}
		await Promise.all(
			moves.map((m) => updateCanvasItemPosition(m.itemId, { x: m.x, y: m.y }))
		);
	}

	function handleCanvasResize(itemId: string, w: number, h: number) {
		canvasItems = canvasItems.map((item) => (item.id === itemId ? { ...item, w, h } : item));
	}

	async function handleCanvasResizeEnd(
		itemId: string,
		w: number,
		h: number,
		before?: { w: number; h: number }
	) {
		const item = canvasItems.find((i) => i.id === itemId);
		if (!item) return;
		const beforeSnap: CanvasLayoutSnapshot = {
			itemId,
			x: item.x,
			y: item.y,
			w: before?.w ?? item.w,
			h: before?.h ?? item.h
		};
		canvasItems = canvasItems.map((i) => (i.id === itemId ? { ...i, w, h } : i));
		pushCanvasUndo('Resize', [beforeSnap], [{ itemId, x: item.x, y: item.y, w, h }]);
		await updateCanvasItemPosition(itemId, { x: item.x, y: item.y, w, h });
		if (expandedNoteId === item.noteId) {
			bumpNeighborsAround(itemId, { w, h });
		}
	}

	function handleCanvasSelectNotes(noteIds: string[], opts: { additive: boolean }) {
		if (!opts.additive) {
			selectionIds = [...noteIds];
		} else {
			const next = new Set(selectionIds);
			for (const id of noteIds) {
				if (next.has(id)) next.delete(id);
				else next.add(id);
			}
			selectionIds = [...next];
		}
		selectedId = selectionIds[0] ?? null;
	}

	function handleCanvasSelect(noteId: string, opts: { additive: boolean; range: boolean }) {
		if (opts.range && selectedId) {
			const order = spatialNoteOrder(canvasItems);
			const rangeIds = rangeBetween(order, selectedId, noteId);
			const next = new Set(opts.additive ? selectionIds : []);
			for (const id of rangeIds) next.add(id);
			selectionIds = [...next];
			selectedId = noteId;
			return;
		}
		toggleSelection(noteId, { additive: opts.additive, range: false });
		selectNote(noteId, { keepSelection: true });
	}

	async function handleCanvasRemove(itemId: string) {
		const item = canvasItems.find((i) => i.id === itemId);
		const note = item ? notesById.get(item.noteId) : undefined;
		await removeCanvasItem(itemId);
		canvasItems = canvasItems.filter((i) => i.id !== itemId);
		// Layout undo snapshots may reference the removed card — drop the stack.
		canvasUndo.clear();
		canvasUndoTick++;

		if (item && expandedNoteId === item.noteId) {
			expandedNoteId = null;
			expandFocus = null;
			restoreBumpLayout();
		}

		// Blank Untitled scratch notes shouldn't linger in the tray.
		if (item && note && isBlankUntitledNote(note)) {
			await deleteNote(item.noteId);
			removeNoteFromSearch(item.noteId);
			notes = notes.filter((n) => n.id !== item.noteId);
			selectionIds = selectionIds.filter((id) => id !== item.noteId);
			if (selectedId === item.noteId) selectedId = selectionIds[0] ?? null;
			return;
		}

		if (item && activeCanvas && canvasFolder) {
			dismissNoteFromCanvas(activeCanvas.id, item.noteId);
		}
	}

	function cardDisplaySize(item: CanvasItem, noteId: string, asExpanded: boolean): {
		w: number;
		h: number;
	} {
		if (asExpanded) {
			return {
				w: Math.max(item.w ?? 0, EXPANDED_CARD.w),
				h: Math.max(item.h ?? 0, EXPANDED_CARD.h)
			};
		}
		return {
			w: item.w ?? COLLAPSED_CARD.w,
			h: item.h ?? COLLAPSED_CARD.h
		};
	}

	/** Push neighbors clear of an expanded/resized card; remember originals for collapse. */
	function bumpNeighborsAround(anchorId: string, size: { w: number; h: number }) {
		const anchor = canvasItems.find((i) => i.id === anchorId);
		if (!anchor) return;
		const others = canvasItems
			.filter((i) => i.id !== anchorId)
			.map((i) => {
				const s = cardDisplaySize(i, i.noteId, expandedNoteId === i.noteId);
				return { id: i.id, x: i.x, y: i.y, w: s.w, h: s.h };
			});
		const moved = bumpOverlappingRects(
			{ id: anchor.id, x: anchor.x, y: anchor.y, w: size.w, h: size.h },
			others,
			BUMP_GAP
		);
		if (moved.size === 0) return;

		const restore = bumpRestore ?? new Map<string, { x: number; y: number }>();
		for (const item of canvasItems) {
			if (!moved.has(item.id) || restore.has(item.id)) continue;
			restore.set(item.id, { x: item.x, y: item.y });
		}
		bumpRestore = restore;

		canvasItems = canvasItems.map((item) => {
			const next = moved.get(item.id);
			return next ? { ...item, x: next.x, y: next.y } : item;
		});
		settlingIds = new Set(moved.keys());
		setTimeout(() => {
			settlingIds = new Set();
		}, 320);
		void Promise.all(
			[...moved.entries()].map(([itemId, pos]) =>
				updateCanvasItemPosition(itemId, { x: pos.x, y: pos.y })
			)
		);
	}

	/** Snap bumped neighbors back to their pre-expand positions. */
	function restoreBumpLayout() {
		const restore = bumpRestore;
		bumpRestore = null;
		if (!restore || restore.size === 0) return;

		canvasItems = canvasItems.map((item) => {
			const prev = restore.get(item.id);
			return prev ? { ...item, x: prev.x, y: prev.y } : item;
		});
		settlingIds = new Set(restore.keys());
		setTimeout(() => {
			settlingIds = new Set();
		}, 320);
		void Promise.all(
			[...restore.entries()].map(([itemId, pos]) =>
				updateCanvasItemPosition(itemId, { x: pos.x, y: pos.y })
			)
		);
	}

	function expandSticky(noteId: string, focus: 'title' | 'body' = 'body') {
		if (expandedNoteId && expandedNoteId !== noteId) {
			restoreBumpLayout();
		}
		selectNote(noteId, { keepSelection: true });
		expandFocus = focus;
		expandedNoteId = noteId;
		const item = canvasItems.find((i) => i.noteId === noteId);
		if (!item) return;
		// Grow to at least expanded defaults; keep larger custom sizes.
		const w = Math.max(item.w ?? 0, EXPANDED_CARD.w);
		const h = Math.max(item.h ?? 0, EXPANDED_CARD.h);
		if (w !== item.w || h !== item.h) {
			canvasItems = canvasItems.map((i) => (i.id === item.id ? { ...i, w, h } : i));
			void updateCanvasItemPosition(item.id, { x: item.x, y: item.y, w, h });
		}
		bumpNeighborsAround(item.id, { w, h });
	}

	function collapseSticky() {
		const noteId = expandedNoteId;
		expandedNoteId = null;
		expandFocus = null;
		restoreBumpLayout();
		if (!noteId) return;
		const item = canvasItems.find((i) => i.noteId === noteId);
		if (!item) return;
		// Shrink oversized expanded cards back to a compact default; keep intentional small sizes.
		const tooBig =
			(item.w ?? 0) > COLLAPSED_CARD.w + 40 || (item.h ?? 0) > COLLAPSED_CARD.h + 40;
		if (!tooBig) return;
		const w = COLLAPSED_CARD.w;
		const h = COLLAPSED_CARD.h;
		canvasItems = canvasItems.map((i) => (i.id === item.id ? { ...i, w, h } : i));
		void updateCanvasItemPosition(item.id, { x: item.x, y: item.y, w, h });
	}

	function markStickySaving() {
		saveStatus = 'saving';
		if (stickySaveStatusClear) clearTimeout(stickySaveStatusClear);
	}

	function markStickySaved() {
		saveStatus = 'saved';
		if (stickySaveStatusClear) clearTimeout(stickySaveStatusClear);
		stickySaveStatusClear = setTimeout(() => {
			if (saveStatus === 'saved') saveStatus = '';
		}, 1200);
	}

	/** Coalesce rapid title/body/meta edits so earlier fields aren't dropped. */
	const stickyPendingPatches = new Map<string, Partial<Note>>();

	function scheduleStickyPersist(
		noteId: string,
		patch: Partial<Note>,
		updated: Note
	) {
		markStickySaving();
		const mergedPatch = { ...(stickyPendingPatches.get(noteId) ?? {}), ...patch };
		stickyPendingPatches.set(noteId, mergedPatch);
		const prev = stickySaveTimers.get(noteId);
		if (prev) clearTimeout(prev);
		stickySaveTimers.set(
			noteId,
			setTimeout(() => {
				stickySaveTimers.delete(noteId);
				const pending = stickyPendingPatches.get(noteId) ?? mergedPatch;
				stickyPendingPatches.delete(noteId);
				const latest = notes.find((n) => n.id === noteId) ?? updated;
				syncNoteUpdate(noteId, pending);
				updateNoteInSearch({ id: noteId, ...pending }, latest);
				markStickySaved();
			}, 400)
		);
	}

	/** Tray double-click: ensure note is on canvas, then expand as sticky. */
	async function openStickyFromTray(noteId: string) {
		if (!activeCanvas) return;
		const existing = canvasItems.find((i) => i.noteId === noteId);
		if (!existing) {
			const spawn =
				canvasBoard?.getSpawnPoint(EXPANDED_CARD, canvasItems.length) ?? {
					x: 80,
					y: 80
				};
			const item = await addNoteToCanvas(activeCanvas.id, noteId, {
				x: spawn.x,
				y: spawn.y,
				w: EXPANDED_CARD.w,
				h: EXPANDED_CARD.h
			});
			await refreshCanvasItems();
			settlingIds = new Set([item.id]);
			setTimeout(() => {
				settlingIds = new Set();
			}, 320);
		} else {
			canvasBoard?.ensureNoteVisible(noteId);
		}
		expandSticky(noteId, 'body');
	}

	function handleStickyTitleChange(noteId: string, title: string) {
		const note = notes.find((n) => n.id === noteId);
		if (!note) return;
		const updated = { ...note, title, modified: Date.now() };
		notes = notes.map((n) => (n.id === noteId ? updated : n));
		scheduleStickyPersist(noteId, { title }, updated);
	}

	function handleStickyBodyChange(noteId: string, body: string) {
		const note = notes.find((n) => n.id === noteId);
		if (!note) return;
		const links = extractWikilinks(body);
		const updated = { ...note, body, links, modified: Date.now() };
		notes = notes.map((n) => (n.id === noteId ? updated : n));
		scheduleStickyPersist(noteId, { body, links }, updated);
	}

	function handleStickyMetaChange(
		noteId: string,
		patch: { folder?: string; tags?: string[]; pinned?: 0 | 1 }
	) {
		const note = notes.find((n) => n.id === noteId);
		if (!note) return;
		const updated = { ...note, ...patch, modified: Date.now() };
		notes = notes.map((n) => (n.id === noteId ? updated : n));
		scheduleStickyPersist(noteId, patch, updated);
	}

	function openLinkedPeel(noteId: string) {
		linkedFocusId = noteId;
		openPeel('linked');
	}

	async function openWikilink(target: string) {
		const needle = target.trim().toLowerCase();
		if (!needle) return;
		let note = notes.find((n) => n.title.trim().toLowerCase() === needle);
		if (!note) {
			note = await createNote({
				title: target.trim(),
				body: '',
				folder: canvasFolder,
				links: []
			});
			addNoteToSearch(note);
			notes = [note, ...notes];
			flashToast(`Created “${note.title}”`);
		}
		linkedFocusId = note.id;
		openPeel('linked');
		await openStickyFromTray(note.id);
	}

	async function handleMashCards(sourceItemId: string, targetItemId: string) {
		const source = canvasItems.find((i) => i.id === sourceItemId);
		const target = canvasItems.find((i) => i.id === targetItemId);
		if (!source || !target) return;

		// If the dragged card is part of a multi-selection that includes the target,
		// mash the whole selection. Otherwise mash just the two overlapped cards.
		const pairNoteIds = new Set([source.noteId, target.noteId]);
		const selectionIncludesPair =
			selectionSet.has(source.noteId) &&
			selectionSet.has(target.noteId) &&
			selectionIds.length >= 2;

		const mashNoteIds = selectionIncludesPair
			? [...new Set(selectionIds)]
			: [...pairNoteIds];

		const mashNotes = mashNoteIds
			.map((id) => notesById.get(id))
			.filter((n): n is Note => Boolean(n));
		if (mashNotes.length < 2) return;

		const mashItems = canvasItems.filter((i) => mashNoteIds.includes(i.noteId));
		const midX =
			mashItems.reduce((s, i) => s + i.x, 0) / Math.max(1, mashItems.length);
		const midY =
			mashItems.reduce((s, i) => s + i.y, 0) / Math.max(1, mashItems.length);

		await mashNotesIntoBubble(mashNotes, {
			x: midX,
			y: midY,
			removeItemIds: mashItems.map((i) => i.id)
		});
	}

	function onTrayDragStart(e: DragEvent, noteId: string) {
		const ids =
			selectionSet.has(noteId) && selectionIds.length > 1 ? [...selectionIds] : [noteId];
		if (!selectionSet.has(noteId)) {
			selectionIds = [noteId];
		}
		selectedId = noteId;
		draggingTrayId = noteId;
		const payload = JSON.stringify(ids);
		e.dataTransfer?.setData(NOTE_MIME, payload);
		e.dataTransfer?.setData('text/plain', payload);
		if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';

		const note = notesById.get(noteId);
		if (note && e.dataTransfer) {
			const ghost = document.createElement('div');
			ghost.className = 'mash-note-card';
			ghost.style.cssText =
				'position:absolute;top:-999px;left:-999px;width:180px;padding:10px 12px;border-radius:12px;font:500 12px var(--mash-font-ui);';
			ghost.innerHTML = `<div style="font-weight:600;margin-bottom:4px">${escapeHtml(note.title)}</div><div style="font-size:10px;opacity:.65">${escapeHtml(notePreview(note.body, 60))}</div>`;
			document.body.appendChild(ghost);
			e.dataTransfer.setDragImage(ghost, 40, 20);
			requestAnimationFrame(() => ghost.remove());
		}
	}

	function onTrayDragEnd() {
		draggingTrayId = null;
	}

	function escapeHtml(s: string): string {
		return s
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;');
	}

	async function loadNotes() {
		isLoading = true;
		loadError = '';
		try {
			await initSearchIndex();
			let loaded = await getActiveNotes({ limit: 10000 });

			if (loaded.length === 0) {
				const seed1 = await createNote({
					title: 'Welcome to Mash',
					body: 'Mash is where notes go to become useful.\n\nDrag notes from the tray onto the canvas. Select a few, then Combine, Copy, or Export.\n\nTry a [[Project ideas]] link in preview mode.',
					tags: ['welcome']
				});
				addNoteToSearch(seed1);
				const seed2 = await createNote({
					title: 'Project ideas',
					body: '- Build the thing\n- Talk to users\n- Ship fast',
					tags: ['project'],
					folder: 'Ideas'
				});
				addNoteToSearch(seed2);
				const seed3 = await createNote({
					title: 'Meeting scraps',
					body: 'Decide on the export format.\nFollow up with design on the workbench.',
					tags: ['meeting'],
					folder: 'Ideas'
				});
				addNoteToSearch(seed3);
				loaded = [seed1, seed2, seed3];
			}

			notes = loaded.map((n) => ({
				...n,
				links: n.links?.length ? n.links : extractWikilinks(n.body)
			}));
		} catch (e) {
			console.error('Failed to load notes', e);
			loadError = 'Couldn’t load notes. Check storage permissions and retry.';
			flashToast(loadError);
		}
		isLoading = false;
	}

	async function handleNewNote() {
		const note = await createNote({
			title: 'Untitled',
			body: '',
			folder: currentFilter.type === 'folder' ? currentFilter.value || '' : '',
			links: []
		});
		addNoteToSearch(note);
		notes = [note, ...notes];
		if (activeCanvas) {
			const spawn =
				canvasBoard?.getSpawnPoint(EXPANDED_CARD, canvasItems.length) ?? {
					x: 80,
					y: 80
				};
			const item = await addNoteToCanvas(activeCanvas.id, note.id, {
				x: spawn.x,
				y: spawn.y,
				w: EXPANDED_CARD.w,
				h: EXPANDED_CARD.h
			});
			await refreshCanvasItems();
			selectNote(note.id);
			expandFocus = 'title';
			expandedNoteId = note.id;
			bumpNeighborsAround(item.id, EXPANDED_CARD);
			settlingIds = new Set([item.id, ...settlingIds]);
			setTimeout(() => {
				settlingIds = new Set();
			}, 320);
			return;
		}
		selectNote(note.id);
		expandFocus = 'title';
		expandedNoteId = note.id;
	}

	function selectNote(id: string, opts?: { keepSelection?: boolean }) {
		if (selectedId && selectedId !== id) flushPendingSave();
		selectedId = id;
		if (!opts?.keepSelection) {
			selectionIds = [id];
		}
	}

	function flushPendingSave(): void {
		for (const [noteId, timer] of stickySaveTimers) {
			clearTimeout(timer);
			stickySaveTimers.delete(noteId);
			stickyPendingPatches.delete(noteId);
			const note = notes.find((n) => n.id === noteId);
			if (!note) continue;
			syncNoteUpdate(noteId, {
				title: note.title,
				body: note.body,
				folder: note.folder,
				tags: note.tags,
				pinned: note.pinned,
				links: note.links
			});
			updateNoteInSearch(
				{
					id: noteId,
					title: note.title,
					body: note.body,
					folder: note.folder,
					tags: note.tags,
					pinned: note.pinned,
					links: note.links
				},
				note
			);
		}
		stickyPendingPatches.clear();
	}

	async function handleSyncFile(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		try {
			const text = await file.text();
			if (text.length > 8_000_000) {
				flashToast('Sync file too large');
				return;
			}
			const parsed = parseSyncBundle(text);
			if (!parsed.ok) {
				flashToast(parsed.error);
				return;
			}
			const { notes: mergedNotes, summary } = mergeSyncBundle(notes, parsed.bundle);
			for (const n of mergedNotes) {
				await db.notes.put(n);
			}
			notes = mergedNotes;
			for (const n of mergedNotes) {
				removeNoteFromSearch(n.id);
				addNoteToSearch(n);
			}
			const conflictFields = [
				...new Set(summary.conflicts.map((c) => `${c.noteId}:${c.field}`))
			];
			flashToast(
				`Sync: ${summary.added} added · ${summary.updated} updated` +
					(conflictFields.length ? ` · ${conflictFields.length} field conflicts (LWW)` : '')
			);
			if (summary.conflicts.length > 0) {
				const bodyConflicts = summary.conflicts.filter((c) => c.field === 'body');
				if (bodyConflicts.length > 0) {
					const first = bodyConflicts[0];
					askConfirm({
						title: 'Sync body conflict',
						message: `Note ${first.noteId.slice(0, 8)}… had conflicting body. LWW kept ${first.chosen}. Re-export after reviewing if needed.`,
						confirmLabel: 'OK',
						danger: false,
						action: () => {}
					});
				}
			}
		} catch {
			flashToast('Sync import failed');
		}
	}

	function startTouchPlace(noteId: string, clientX: number, clientY: number) {
		touchPlaceGhost = { noteId, clientX, clientY };
		const onMove = (ev: PointerEvent) => {
			if (!touchPlaceGhost) return;
			touchPlaceGhost = { ...touchPlaceGhost, clientX: ev.clientX, clientY: ev.clientY };
		};
		const onUp = (ev: PointerEvent) => {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('pointercancel', onUp);
			const ghost = touchPlaceGhost;
			touchPlaceGhost = null;
			if (!ghost || !canvasBoard?.clientToWorld) return;
			const world = canvasBoard.clientToWorld(ev.clientX, ev.clientY);
			void handleDropNotes([ghost.noteId], world.x - COLLAPSED_CARD.w / 2, world.y - COLLAPSED_CARD.h / 2);
		};
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
		window.addEventListener('pointercancel', onUp);
	}

	async function handleImportFile(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		try {
			const text = await file.text();
			if (text.length > 8_000_000) {
				flashToast('Import file too large');
				return;
			}
			const result = parseNotesJson(text);
			if (!result.ok) {
				flashToast(result.error);
				return;
			}
			let added = 0;
			for (const note of result.notes) {
				const existing = notes.find((n) => n.id === note.id);
				if (existing) {
					const merged = {
						...existing,
						...note,
						id: existing.id,
						modified: Math.max(existing.modified, note.modified)
					};
					await db.notes.put(merged);
					notes = notes.map((n) => (n.id === existing.id ? merged : n));
					updateNoteInSearch(merged, merged);
				} else {
					await db.notes.put(note);
					addNoteToSearch(note);
					notes = [note, ...notes];
					added++;
				}
			}
			flashToast(
				added === result.notes.length
					? `Imported ${added} notes`
					: `Imported ${result.notes.length} notes (${added} new)`
			);
		} catch (err) {
			console.error(err);
			flashToast('Import failed');
		}
	}

	function askConfirm(opts: {
		title: string;
		message: string;
		confirmLabel?: string;
		danger?: boolean;
		action: () => void | Promise<void>;
	}) {
		confirmDialog = {
			title: opts.title,
			message: opts.message,
			confirmLabel: opts.confirmLabel ?? 'Confirm',
			danger: opts.danger ?? false,
			action: opts.action
		};
	}

	async function runConfirmDialog() {
		const pending = confirmDialog;
		confirmDialog = null;
		if (!pending) return;
		await pending.action();
	}

	async function handleDelete() {
		const ids = selectionIds.length > 0 ? [...selectionIds] : selectedId ? [selectedId] : [];
		if (ids.length === 0) return;
		askConfirm({
			title: ids.length === 1 ? 'Delete note' : `Delete ${ids.length} notes`,
			message:
				ids.length === 1
					? 'Delete this note? This cannot be undone.'
					: `Delete ${ids.length} notes? This cannot be undone.`,
			confirmLabel: 'Delete',
			danger: true,
			action: async () => {
				for (const id of ids) {
					await deleteNote(id);
					removeNoteFromSearch(id);
				}
				const idSet = new Set(ids);
				notes = notes.filter((n) => !idSet.has(n.id));
				canvasItems = canvasItems.filter((i) => !idSet.has(i.noteId));
				if (expandedNoteId && idSet.has(expandedNoteId)) expandedNoteId = null;
				selectionIds = [];
				selectedId = notes[0]?.id ?? null;
				if (selectedId) selectNote(selectedId);
				bulkMenu = null;
				flashToast(ids.length === 1 ? 'Note deleted' : `${ids.length} notes deleted`);
			}
		});
	}

	function applyNotePatch(id: string, patch: Partial<Note>) {
		const note = notes.find((n) => n.id === id);
		if (!note) return;
		const updated = { ...note, ...patch, modified: Date.now() };
		notes = notes.map((n) => (n.id === id ? updated : n));
		syncNoteUpdate(id, patch);
		updateNoteInSearch({ id, ...patch }, updated);
	}

	function tagSelection(tag: string) {
		const t = tag.trim();
		if (!t || selectionIds.length === 0) return;
		for (const id of selectionIds) {
			const note = notes.find((n) => n.id === id);
			if (!note || note.tags.includes(t)) continue;
			applyNotePatch(id, { tags: [...note.tags, t] });
		}
		bulkTagDraft = '';
		bulkMenu = null;
		flashToast(`Tagged ${selectionIds.length} with #${t}`);
	}

	function assignFolderToSelection(folder: string) {
		const f = folder.trim();
		if (selectionIds.length === 0) return;
		for (const id of selectionIds) {
			applyNotePatch(id, { folder: f });
		}
		bulkFolderDraft = '';
		bulkMenu = null;
		flashToast(f ? `Moved ${selectionIds.length} to ${f}` : `Cleared folder on ${selectionIds.length}`);
	}

	async function deleteFolder(folder: string) {
		const matching = notes.filter(
			(n) => n.folder === folder || n.folder.startsWith(folder + '/')
		);
		askConfirm({
			title: 'Remove folder',
			message:
				matching.length > 0
					? `Remove folder “${folder}”? ${matching.length} note${matching.length === 1 ? '' : 's'} will move to no folder.`
					: `Remove folder “${folder}”?`,
			confirmLabel: 'Remove',
			danger: true,
			action: async () => {
				for (const note of matching) {
					applyNotePatch(note.id, { folder: '' });
				}

				const canvas = await db.canvases.where('folder').equals(folder).first();
				if (canvas) {
					await db.canvasItems.where('canvasId').equals(canvas.id).delete();
					await db.canvases.delete(canvas.id);
					clearCanvasViewport(canvas.id);
					clearDismissedForCanvas(canvas.id);
					if (activeCanvas?.id === canvas.id) {
						await loadContextCanvas('');
					}
				}

				if (currentFilter.type === 'folder' && currentFilter.value === folder) {
					clearFilter();
				}
				flashToast(`Folder “${folder}” removed`);
			}
		});
	}

	async function deleteTag(tag: string) {
		const matching = notes.filter((n) => n.tags.includes(tag));
		askConfirm({
			title: 'Remove tag',
			message:
				matching.length > 0
					? `Remove tag #${tag} from ${matching.length} note${matching.length === 1 ? '' : 's'}?`
					: `Remove tag #${tag}?`,
			confirmLabel: 'Remove',
			danger: true,
			action: () => {
				for (const note of matching) {
					applyNotePatch(note.id, { tags: note.tags.filter((t) => t !== tag) });
				}
				if (currentFilter.type === 'tag' && currentFilter.value === tag) {
					clearFilter();
				}
				flashToast(`Tag #${tag} removed`);
			}
		});
	}

	function setFilter(type: 'folder' | 'tag' | 'pinned', value?: string) {
		if (currentFilter.type === type && currentFilter.value === value) {
			currentFilter = { type: null };
		} else if (type === 'pinned') {
			currentFilter = { type: 'pinned' };
		} else {
			currentFilter = { type, value };
		}
		searchQuery = '';
		peelFilterText = '';
		clearSelection();
	}

	function clearFilter() {
		currentFilter = { type: null };
		searchQuery = '';
		peelFilterText = '';
		clearSelection();
	}

	function handleGlobalSearch(e: Event) {
		searchQuery = (e.target as HTMLInputElement).value;
		if (searchQuery) {
			// Keep folder/tag context; only open peel so results are scannable.
			openPeel('notes');
		}
	}

	function openPeel(mode: PeelMode = 'notes') {
		const patch = peelOpenPatch(mode);
		peelMode = patch.peelMode;
		peelOpen = patch.peelOpen;
		foldersFlyout = patch.foldersFlyout;
		tagsFlyout = patch.tagsFlyout;
		linkedFlyout = patch.linkedFlyout;
	}

	function closePeel(force = false) {
		if (peelPinned && !force) return;
		const patch = peelClosePatch();
		peelOpen = patch.peelOpen;
		foldersFlyout = patch.foldersFlyout;
		tagsFlyout = patch.tagsFlyout;
		linkedFlyout = patch.linkedFlyout;
	}

	function handleDockAction(action: DockAction) {
		dispatchDockAction(action, {
			clearFilter,
			setFilter: (type, value) => setFilter(type, value),
			openPeel,
			closePeel,
			getPeelOpen: () => peelOpen,
			getPeelMode: () => peelMode,
			setLinkedFocus: (id) => {
				linkedFocusId = id;
			},
			resolveLinkedFocus: () =>
				expandedNoteId ?? selectedId ?? linkedFocusId ?? notes[0]?.id ?? null,
			newNote: () => void handleNewNote(),
			focusSearch: () => {
				void tick().then(() => {
					(document.getElementById('global-search') as HTMLInputElement | null)?.focus();
				});
			}
		});
	}

	function handleKeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
			const tag = (e.target as HTMLElement)?.tagName;
			if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
				e.preventDefault();
				if (e.shiftKey) redoCanvasLayout();
				else undoCanvasLayout();
				return;
			}
		}
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			showPalette = !showPalette;
			if (showPalette) paletteQuery = '';
		}
		if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
			e.preventDefault();
			handleNewNote();
		}
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'm') {
			const tag = (e.target as HTMLElement)?.tagName;
			if (tag !== 'INPUT' && tag !== 'TEXTAREA' && selectionIds.length >= 2) {
				e.preventDefault();
				void combineSelection();
			}
		}
		if (e.key === '?' && document.activeElement?.tagName === 'BODY') {
			e.preventDefault();
			flashToast(
				'⌘K palette · ⌘N new · ⌘M mash · ⌘Z board=layout undo (in text=content) · / search · Esc dismiss'
			);
		}
		if (e.key === '/' && document.activeElement?.tagName === 'BODY') {
			e.preventDefault();
			(document.getElementById('global-search') as HTMLInputElement)?.focus();
		}
		if (e.key === 'Escape') {
			if (confirmDialog) {
				confirmDialog = null;
				return;
			}
			if (bulkMenu) {
				bulkMenu = null;
				return;
			}
			if (showPalette) {
				showPalette = false;
				return;
			}
			if (expandedNoteId) {
				collapseSticky();
				return;
			}
			if (peelOpen) {
				closePeel(true);
				return;
			}
			if (selectionIds.length > 0) {
				clearSelection();
			}
		}
	}

	const paletteActions = [
		{ label: 'New note', action: handleNewNote, shortcut: '⌘N' },
		{
			label: 'Combine selected into mash sticky',
			action: () => {
				void combineSelection();
				showPalette = false;
			},
			shortcut: ''
		},
		{
			label: 'Copy selected as Markdown',
			action: () => {
				void copySelection();
				showPalette = false;
			},
			shortcut: ''
		},
		{
			label: 'Export selected as Markdown',
			action: () => {
				exportSelectionMarkdown();
				showPalette = false;
			},
			shortcut: ''
		},
		{
			label: 'Export selected as JSON',
			action: () => {
				exportSelectionJson();
				showPalette = false;
			},
			shortcut: ''
		},
		{
			label: 'Unmash selected sticky',
			action: () => {
				void unmashSelection();
				showPalette = false;
			},
			shortcut: ''
		},
		{
			label: 'Tag selected notes',
			action: () => {
				if (selectionIds.length === 0) return;
				bulkMenu = 'tag';
				showPalette = false;
			},
			shortcut: ''
		},
		{
			label: 'Move selected to folder',
			action: () => {
				if (selectionIds.length === 0) return;
				bulkMenu = 'folder';
				showPalette = false;
			},
			shortcut: ''
		},
		{
			label: 'Delete selected notes',
			action: () => {
				void handleDelete();
				showPalette = false;
			},
			shortcut: ''
		},
		{
			label: 'Toggle pin',
			action: () => {
				if (!selectedId) return;
				const np = selectedNote?.pinned === 1 ? 0 : 1;
				handleStickyMetaChange(selectedId, { pinned: np as 0 | 1 });
				showPalette = false;
			},
			shortcut: '⌘P'
		},
		{
			label: 'Delete current note',
			action: () => {
				handleDelete();
				showPalette = false;
			},
			shortcut: ''
		},
		{ label: 'Clear filters & search', action: clearFilter, shortcut: 'Esc' },
		{
			label: 'Import notes from JSON…',
			action: () => {
				showPalette = false;
				importInputEl?.click();
			},
			shortcut: ''
		},
		{
			label: 'Export all as JSON',
			action: () => {
				exportNotesJson(notes, 'mash-notes-export.json');
				showPalette = false;
			},
			shortcut: ''
		},
		{
			label: 'Export sync bundle…',
			action: () => {
				downloadSyncBundle(notes);
				showPalette = false;
				flashToast('Exported sync bundle');
			},
			shortcut: ''
		},
		{
			label: 'Import sync bundle…',
			action: () => {
				showPalette = false;
				syncInputEl?.click();
			},
			shortcut: ''
		},
		{
			label: 'Keyboard shortcuts',
			action: () => {
				showPalette = false;
				flashToast(
					'⌘Z in text = content undo · ⌘Z on board = layout undo · ⌘K · ⌘N · / search'
				);
			},
			shortcut: '?'
		},
		{
			label: 'Undo tip: content vs layout',
			action: () => {
				showPalette = false;
				flashToast('In a sticky: ⌘Z undoes typing. On the board: ⌘Z undoes move/align.');
			},
			shortcut: '⌘Z'
		}
	];

	function handlePaletteKeydown(e: KeyboardEvent): void {
		const commands = paletteActions.filter((a) =>
			a.label.toLowerCase().includes(paletteQuery.toLowerCase())
		);
		const noteJumps =
			paletteQuery.length > 1
				? notes
						.filter(
							(n: Note) =>
								n.title.toLowerCase().includes(paletteQuery.toLowerCase()) ||
								n.body.toLowerCase().includes(paletteQuery.toLowerCase())
						)
						.slice(0, 6)
				: [];
		const total = commands.length + noteJumps.length;
		if (total === 0) return;

		if (e.key === 'ArrowDown') {
			e.preventDefault();
			paletteHighlight = Math.min(paletteHighlight + 1, total - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			paletteHighlight = Math.max(paletteHighlight - 1, 0);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (paletteHighlight < commands.length) {
				commands[paletteHighlight].action();
				showPalette = false;
			} else {
				const note = noteJumps[paletteHighlight - commands.length];
				if (note) {
					selectNote(note.id);
					void openStickyFromTray(note.id);
					showPalette = false;
				}
			}
		}
	}

	function handleVisibilityChange(): void {
		if (document.visibilityState === 'hidden') flushPendingSave();
	}

	onMount(() => {
		loadNotes();
		window.addEventListener('keydown', handleKeydown);
		window.addEventListener('pagehide', flushPendingSave);
		document.addEventListener('visibilitychange', handleVisibilityChange);
		return () => {
			window.removeEventListener('keydown', handleKeydown);
			window.removeEventListener('pagehide', flushPendingSave);
			document.removeEventListener('visibilitychange', handleVisibilityChange);
		};
	});
</script>

<div class="flex h-screen flex-col" style="background: var(--mash-bg); color: var(--mash-ink);">
	<!-- Header -->
	<header
		class="flex items-center justify-between border-b px-5 py-3.5"
		style="border-color: var(--mash-tray-edge); background: var(--mash-rail);"
	>
		<div class="flex items-center gap-3.5">
			<img
				src="/icons/mash-logo-sprouts.png"
				srcset="/icons/mash-logo-sprouts.png 1x, /icons/mash-logo-sprouts@2x.png 2x"
				alt="Mash"
				width="48"
				height="60"
				class="mash-logo h-[3.25rem] w-auto select-none"
				draggable="false"
			/>
			<div class="flex flex-col leading-none">
				<span class="mash-display text-[22px] font-semibold tracking-tight">Mash</span>
				<span
					class="mt-1 text-[11px] font-medium tracking-[0.14em] uppercase"
					style="color: var(--mash-accent-bright);"
				>
					Infinite stovetop
				</span>
			</div>
		</div>

		<div class="flex flex-1 items-center justify-center px-4">
			<div class="relative w-full max-w-md">
				<Search
					class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
					style="color: var(--mash-ink-muted);"
				/>
				<input
					id="global-search"
					type="text"
					placeholder="Search notes to grab…"
					bind:value={searchQuery}
					oninput={handleGlobalSearch}
					class="mash-focus w-full rounded-lg border py-2 pr-14 pl-9 text-sm transition-colors"
					style="border-color: var(--mash-tray-edge); background: var(--mash-tray); color: var(--mash-ink);"
				/>
				<kbd
					class="pointer-events-none absolute top-1/2 right-2.5 hidden -translate-y-1/2 items-center gap-0.5 rounded border px-1.5 py-0.5 text-[10px] font-medium sm:flex"
					style="border-color: var(--mash-tray-edge); color: var(--mash-ink-muted);"
				>
					/
				</kbd>
			</div>
		</div>

		<div class="flex items-center gap-2">
			<div
				class="hidden items-center gap-1 text-xs lg:flex"
				style="color: var(--mash-ink-muted);"
			>
				<kbd
					class="flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-[10px] font-medium"
					style="border-color: var(--mash-tray-edge);"
				>
					<Command class="h-2.5 w-2.5" />K
				</kbd>
			</div>
		</div>
	</header>

	{#if loadError}
		<div
			class="flex items-center justify-between gap-3 border-b px-4 py-2 text-xs"
			style="border-color: var(--mash-tray-edge); background: rgba(196,92,74,0.15); color: var(--mash-ink);"
		>
			<span>{loadError}</span>
			<button
				type="button"
				class="mash-btn rounded-md px-2.5 py-1 text-[11px] font-semibold"
				onclick={() => void loadNotes()}
			>
				Retry
			</button>
		</div>
	{/if}

	<!-- Full-bleed canvas stage -->
	<div class="relative flex min-h-0 flex-1">
		<div class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
			<div
				class="pointer-events-none absolute top-3 left-[4.75rem] z-10 rounded-full border px-3 py-1 text-[10px] backdrop-blur-sm"
				style="border-color: rgba(80,60,30,0.18); background: rgba(247,241,230,0.72); color: var(--mash-card-muted);"
			>
				<span class="mash-display font-medium" style="color: var(--mash-card-ink);">{canvasTitle}</span>
				<span class="mx-1.5 opacity-40">·</span>
				{canvasItems.length} on canvas
			</div>

			<div class="relative min-h-0 flex-1 overflow-hidden">
				<CanvasBoard
					bind:this={canvasBoard}
					items={canvasItems}
					{notesById}
					selectedIds={selectionSet}
					{expandedNoteId}
					{expandFocus}
					{settlingIds}
					canvasId={activeCanvas?.id ?? null}
					onSelect={handleCanvasSelect}
					onSelectNotes={handleCanvasSelectNotes}
					onMove={handleCanvasMove}
					onMoveMany={handleCanvasMoveMany}
					onMoveEnd={handleCanvasMoveEnd}
					onResize={handleCanvasResize}
					onResizeEnd={handleCanvasResizeEnd}
					onRemove={handleCanvasRemove}
					onExpand={expandSticky}
					onCollapse={collapseSticky}
					onTitleChange={handleStickyTitleChange}
					onBodyChange={handleStickyBodyChange}
					onMetaChange={handleStickyMetaChange}
					onWikilink={(target) => void openWikilink(target)}
					onOpenLinks={openLinkedPeel}
					folders={uniqueFolders}
					onDropNotes={handleDropNotes}
					onMashCards={handleMashCards}
					onBlankPointerDown={() => closePeel()}
					canUndo={canCanvasUndo}
					canRedo={canCanvasRedo}
					onUndo={undoCanvasLayout}
					onRedo={redoCanvasLayout}
				/>
			</div>
		</div>

		<!-- Dock + peel sit above the canvas stage so magnification isn't clipped by overflow-hidden. -->
		<div
			class="mash-dock-slot pointer-events-auto absolute top-1/2 left-3 z-30 -translate-y-1/2 overflow-visible py-5 pr-8"
		>
			<MashDock
				{currentFilter}
				{searchQuery}
				foldersOpen={foldersFlyout}
				tagsOpen={tagsFlyout}
				linkedOpen={linkedFlyout}
				dockSelect={handleDockAction}
			/>
		</div>
		{#if peelOpen}
			<div class="mash-peel-slot pointer-events-auto absolute top-1/2 left-[4.75rem] z-30 -translate-y-1/2">
				<PeelScanner
					open={peelOpen}
					pinned={peelPinned}
					mode={peelMode}
					title={peelTitle}
					notes={peelNotesWindowed}
					outgoingNotes={linkedOutgoing}
					backlinkNotes={linkedBacklinks}
					linkedFocusTitle={linkedFocusNote?.title ?? ''}
					folders={uniqueFolders}
					tags={uniqueTags}
					selectedIds={selectionSet}
					draggingId={draggingTrayId}
					{saveStatus}
					filterText={peelFilterText}
					{isLoading}
					onClose={() => closePeel(true)}
					onTogglePin={() => (peelPinned = !peelPinned)}
					onFilterText={(v) => (peelFilterText = v)}
					onNoteClick={handleNoteClick}
					onNoteOpen={(id) => void openStickyFromTray(id)}
					onDragStart={onTrayDragStart}
					onDragEnd={onTrayDragEnd}
					onPickFolder={(folder) => {
						setFilter('folder', folder);
						openPeel('notes');
					}}
					onPickTag={(tag) => {
						setFilter('tag', tag);
						openPeel('notes');
					}}
					onDeleteFolder={(folder) => void deleteFolder(folder)}
					onDeleteTag={(tag) => void deleteTag(tag)}
					onNewNote={handleNewNote}
					onSelectAllNotes={() => {
						selectionIds = peelNotesWindowed.map((n) => n.id);
						selectedId = selectionIds[0] ?? null;
					}}
					onTouchPlaceStart={startTouchPlace}
				/>
			</div>
		{/if}

		{#if touchPlaceGhost}
			{@const ghostNote = notesById.get(touchPlaceGhost.noteId)}
			<div
				class="pointer-events-none fixed z-50 w-[180px] rounded-xl border px-3 py-2 shadow-xl"
				style="left: {touchPlaceGhost.clientX - 40}px; top: {touchPlaceGhost.clientY - 20}px; border-color: rgba(80,60,30,0.25); background: rgba(247,241,230,0.95);"
			>
				<div class="text-xs font-semibold" style="color: var(--mash-card-ink);">
					{ghostNote?.title ?? 'Note'}
				</div>
				<div class="mt-0.5 text-[10px]" style="color: var(--mash-card-muted);">Drop on canvas</div>
			</div>
		{/if}

		{#if selectionIds.length > 0}
			<div class="absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-2">
				{#if bulkMenu === 'tag'}
					<div
						class="w-64 rounded-xl border p-3 shadow-xl"
						style="border-color: rgba(80,60,30,0.2); background: rgba(28, 24, 18, 0.95); backdrop-filter: blur(10px);"
					>
						<div class="mb-2 text-[10px] font-medium tracking-wide uppercase" style="color: var(--mash-accent-bright);">
							Tag {selectionIds.length} note{selectionIds.length === 1 ? '' : 's'}
						</div>
						<input
							type="text"
							bind:value={bulkTagDraft}
							placeholder="new tag…"
							class="mash-focus mb-2 w-full rounded-md border bg-transparent px-2 py-1.5 text-xs outline-none"
							style="border-color: var(--mash-tray-edge); color: var(--mash-ink);"
							onkeydown={(e) => {
								if (e.key === 'Enter') tagSelection(bulkTagDraft);
								if (e.key === 'Escape') bulkMenu = null;
							}}
						/>
						<div class="flex max-h-28 flex-wrap gap-1 overflow-auto">
							{#each uniqueTags as tag}
								<button
									type="button"
									class="mash-chip rounded-full px-2 py-0.5 text-[10px] hover:bg-white/10"
									onclick={() => tagSelection(tag)}
								>
									#{tag}
								</button>
							{/each}
						</div>
					</div>
				{:else if bulkMenu === 'folder'}
					<div
						class="w-64 rounded-xl border p-3 shadow-xl"
						style="border-color: rgba(80,60,30,0.2); background: rgba(28, 24, 18, 0.95); backdrop-filter: blur(10px);"
					>
						<div class="mb-2 text-[10px] font-medium tracking-wide uppercase" style="color: var(--mash-accent-bright);">
							Move {selectionIds.length} to folder
						</div>
						<input
							type="text"
							bind:value={bulkFolderDraft}
							placeholder="new or existing folder…"
							class="mash-focus mb-2 w-full rounded-md border bg-transparent px-2 py-1.5 text-xs outline-none"
							style="border-color: var(--mash-tray-edge); color: var(--mash-ink);"
							onkeydown={(e) => {
								if (e.key === 'Enter') assignFolderToSelection(bulkFolderDraft);
								if (e.key === 'Escape') bulkMenu = null;
							}}
						/>
						<button
							type="button"
							class="mash-peel-meta-row rounded-md"
							onclick={() => assignFolderToSelection('')}
						>
							<span class="text-[11px]">No folder</span>
						</button>
						<div class="max-h-28 overflow-auto">
							{#each uniqueFolders as folder}
								<button
									type="button"
									class="mash-peel-meta-row"
									onclick={() => assignFolderToSelection(folder)}
								>
									<Folder class="h-3.5 w-3.5 shrink-0 opacity-60" />
									<span class="truncate text-[11px]">{folder}</span>
								</button>
							{/each}
						</div>
					</div>
				{:else if bulkMenu === 'align'}
					<div
						class="flex max-w-[min(92vw,28rem)] flex-wrap items-center justify-center gap-1 rounded-xl border p-2 shadow-xl"
						style="border-color: rgba(80,60,30,0.2); background: rgba(28, 24, 18, 0.95); backdrop-filter: blur(10px);"
						role="toolbar"
						aria-label="Align selected"
					>
						<button
							type="button"
							class="mash-align-btn"
							onclick={() => canvasBoard?.applyAlign('left')}
							title="Align left"
							aria-label="Align left"
						>
							<AlignLeft class="h-3.5 w-3.5" />
						</button>
						<button
							type="button"
							class="mash-align-btn"
							onclick={() => canvasBoard?.applyAlign('center')}
							title="Align center"
							aria-label="Align center"
						>
							<AlignCenter class="h-3.5 w-3.5" />
						</button>
						<button
							type="button"
							class="mash-align-btn"
							onclick={() => canvasBoard?.applyAlign('right')}
							title="Align right"
							aria-label="Align right"
						>
							<AlignRight class="h-3.5 w-3.5" />
						</button>
						<button
							type="button"
							class="mash-align-btn"
							onclick={() => canvasBoard?.applyAlign('top')}
							title="Align top"
							aria-label="Align top"
						>
							<AlignStartVertical class="h-3.5 w-3.5" />
						</button>
						<button
							type="button"
							class="mash-align-btn"
							onclick={() => canvasBoard?.applyAlign('middle')}
							title="Align middle"
							aria-label="Align middle"
						>
							<AlignCenterVertical class="h-3.5 w-3.5" />
						</button>
						<button
							type="button"
							class="mash-align-btn"
							onclick={() => canvasBoard?.applyAlign('bottom')}
							title="Align bottom"
							aria-label="Align bottom"
						>
							<AlignEndVertical class="h-3.5 w-3.5" />
						</button>
						{#if selectionIds.length >= 3}
							<button
								type="button"
								class="mash-align-btn"
								onclick={() => canvasBoard?.applyAlign('distribute-h')}
								title="Space across"
								aria-label="Space evenly horizontally"
							>
								<StretchHorizontal class="h-3.5 w-3.5" />
							</button>
							<button
								type="button"
								class="mash-align-btn"
								onclick={() => canvasBoard?.applyAlign('distribute-v')}
								title="Space down"
								aria-label="Space evenly vertically"
							>
								<StretchVertical class="h-3.5 w-3.5" />
							</button>
						{/if}
						<button
							type="button"
							class="mash-align-btn"
							onclick={() => canvasBoard?.applyAlign('stack')}
							title="Stack"
							aria-label="Stack selected"
						>
							<Layers class="h-3.5 w-3.5" />
						</button>
						<button
							type="button"
							class="mash-align-btn"
							onclick={() => canvasBoard?.applyAlign('grid')}
							title="Grid"
							aria-label="Grid selected"
						>
							<LayoutGrid class="h-3.5 w-3.5" />
						</button>
					</div>
				{/if}

				<div
					class="mash-dock flex items-center gap-1 rounded-2xl border px-2 py-1.5 shadow-xl"
					style="border-color: rgba(80,60,30,0.2); background: rgba(28, 24, 18, 0.92); backdrop-filter: blur(10px);"
				>
					<span
						class="px-2 text-[10px] font-medium tracking-wide uppercase"
						style="color: var(--mash-accent-bright);"
					>
						{selectionIds.length} selected
					</span>
					<button
						type="button"
						onclick={() => void combineSelection()}
						class="mash-btn flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold"
						disabled={selectionIds.length < 2}
					>
						<Layers class="h-3.5 w-3.5" />
						Mash
					</button>
					{#if canUnmash}
						<button
							type="button"
							onclick={() => void unmashSelection()}
							class="mash-btn-ghost flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs"
							title="Restore source notes and remove mash"
						>
							Unmash
						</button>
					{/if}
					{#if selectionIds.length >= 2}
						<button
							type="button"
							onclick={() => (bulkMenu = bulkMenu === 'align' ? null : 'align')}
							class="mash-btn-ghost flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs {bulkMenu ===
							'align'
								? 'border-[var(--mash-accent)] text-[var(--mash-accent-bright)]'
								: ''}"
							title="Align selected"
						>
							<AlignLeft class="h-3.5 w-3.5" />
							Align
						</button>
					{/if}
					<button
						type="button"
						onclick={() => (bulkMenu = bulkMenu === 'tag' ? null : 'tag')}
						class="mash-btn-ghost flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs {bulkMenu === 'tag'
							? 'border-[var(--mash-accent)] text-[var(--mash-accent-bright)]'
							: ''}"
						title="Tag selected"
					>
						<Tag class="h-3.5 w-3.5" />
						Tag
					</button>
					<button
						type="button"
						onclick={() => (bulkMenu = bulkMenu === 'folder' ? null : 'folder')}
						class="mash-btn-ghost flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs {bulkMenu ===
						'folder'
							? 'border-[var(--mash-accent)] text-[var(--mash-accent-bright)]'
							: ''}"
						title="Move to folder"
					>
						<Folder class="h-3.5 w-3.5" />
						Folder
					</button>
					<button
						type="button"
						onclick={() => void copySelection()}
						class="mash-btn-ghost flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs"
					>
						<Copy class="h-3.5 w-3.5" />
						Copy
					</button>
					<button
						type="button"
						onclick={() => exportSelectionMarkdown()}
						class="mash-btn-ghost flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs"
					>
						<Download class="h-3.5 w-3.5" />
						MD
					</button>
					<button
						type="button"
						onclick={() => void handleDelete()}
						class="mash-btn-ghost flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs hover:text-[var(--mash-danger)]"
						title="Delete selected"
					>
						<Trash2 class="h-3.5 w-3.5" />
					</button>
					<button
						type="button"
						onclick={clearSelection}
						class="rounded-lg p-1.5 text-[var(--mash-ink-muted)] hover:bg-white/5 hover:text-[var(--mash-ink)]"
						aria-label="Clear selection"
					>
						<X class="h-3.5 w-3.5" />
					</button>
				</div>
			</div>
		{/if}
	</div>

	<!-- Command Palette -->
	{#if showPalette}
		<div
			class="fixed inset-0 z-50 flex items-start justify-center bg-black/70 pt-[20vh] backdrop-blur-sm"
			role="presentation"
			tabindex="-1"
			onclick={(e) => {
				if (e.target === e.currentTarget) showPalette = false;
			}}
			onkeydown={(e) => {
				if (e.key === 'Escape') showPalette = false;
			}}
		>
			<div
				role="dialog"
				aria-modal="true"
				tabindex="-1"
				aria-label="Command palette"
				class="relative z-10 w-full max-w-md rounded-xl border shadow-2xl"
				style="border-color: var(--mash-tray-edge); background: var(--mash-tray);"
			>
				<div class="border-b p-3" style="border-color: var(--mash-tray-edge);">
					<input
						bind:this={paletteInput}
						type="text"
						bind:value={paletteQuery}
						placeholder="Type a command…"
						class="mash-focus w-full rounded bg-transparent px-1 text-sm outline-none"
						style="color: var(--mash-ink);"
						onkeydown={handlePaletteKeydown}
					/>
				</div>
				<div class="max-h-80 overflow-auto p-1 text-sm">
					{#each paletteActions.filter((a) => a.label
							.toLowerCase()
							.includes(paletteQuery.toLowerCase())) as action, i}
						<button
							onclick={action.action}
							class="flex w-full items-center justify-between rounded px-3 py-2 text-left hover:bg-white/5 {i ===
							paletteHighlight
								? 'bg-white/8 ring-1 ring-[var(--mash-accent)]/40 ring-inset'
								: ''}"
						>
							<span>{action.label}</span>
							<span class="text-xs" style="color: var(--mash-ink-muted);">{action.shortcut}</span>
						</button>
					{/each}

					{#if paletteQuery.length > 1}
						<div
							class="mt-1 border-t px-3 pt-1 text-[10px]"
							style="border-color: var(--mash-tray-edge); color: var(--mash-ink-muted);"
						>
							Jump to note
						</div>
						{#each notes
							.filter((n: Note) => n.title
										.toLowerCase()
										.includes(paletteQuery.toLowerCase()) || n.body
										.toLowerCase()
										.includes(paletteQuery.toLowerCase()))
							.slice(0, 6) as note, j}
							<button
								onclick={() => {
									void openStickyFromTray(note.id);
									showPalette = false;
								}}
								class="flex w-full items-center justify-between rounded px-3 py-1.5 text-left text-xs hover:bg-white/5 {j +
									paletteActions.filter((a) =>
										a.label.toLowerCase().includes(paletteQuery.toLowerCase())
									).length ===
								paletteHighlight
									? 'bg-white/8 ring-1 ring-[var(--mash-accent)]/40 ring-inset'
									: ''}"
							>
								<span class="truncate">{note.title}</span>
								<span class="text-[10px]" style="color: var(--mash-ink-muted);">{note.folder}</span>
							</button>
						{/each}
					{/if}
				</div>
			</div>
		</div>
	{/if}

	<input
		bind:this={importInputEl}
		type="file"
		accept="application/json,.json"
		class="hidden"
		onchange={(e) => void handleImportFile(e)}
	/>
	<input
		bind:this={syncInputEl}
		type="file"
		accept="application/json,.json"
		class="hidden"
		onchange={(e) => void handleSyncFile(e)}
	/>

	{#if actionToast}
		<div
			class="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg border px-3 py-1.5 text-xs shadow-lg"
			style="border-color: var(--mash-tray-edge); background: rgba(28,24,18,0.95); color: var(--mash-ink);"
		>
			{actionToast}
		</div>
	{/if}

	<ConfirmDialog
		open={Boolean(confirmDialog)}
		title={confirmDialog?.title ?? ''}
		message={confirmDialog?.message ?? ''}
		confirmLabel={confirmDialog?.confirmLabel ?? 'Confirm'}
		danger={confirmDialog?.danger ?? false}
		onConfirm={() => void runConfirmDialog()}
		onCancel={() => (confirmDialog = null)}
	/>
</div>
