<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { addNoteToCanvas, createNote, db, deleteNote, removeCanvasItem } from '$lib/db';
	import { addNoteToSearch, removeNoteFromSearch, searchNotes } from '$lib/search';
	import type { Note } from '$lib/types';
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
		LayoutGrid,
		Columns2,
		BookOpen
	} from 'lucide-svelte';
	import MashDock from '$lib/components/MashDock.svelte';
	import PeelScanner from '$lib/components/PeelScanner.svelte';
	import SearchResultsDropdown from '$lib/components/SearchResultsDropdown.svelte';
	import SettingsPanel from '$lib/components/SettingsPanel.svelte';
	import CanvasBoard from '$lib/components/CanvasBoard.svelte';
	import EditorStage from '$lib/components/EditorStage.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import ShortcutsModal from '$lib/components/ShortcutsModal.svelte';
	import SpacesOverview from '$lib/components/SpacesOverview.svelte';
	import PdfReader from '$lib/components/PdfReader.svelte';
	import { extractWikilinks } from '$lib/markdown';
	import { combineNotes, exportNotesJson } from '$lib/mash';
	import { clearCanvasViewport } from '$lib/viewport';
	import {
		clearDismissedForCanvas,
		dismissNoteFromCanvas,
		undismissNotesFromCanvas
	} from '$lib/canvas-dismiss';
	import { findBacklinks, findOutgoingNotes } from '$lib/links';
	import { downloadSyncBundle } from '$lib/sync-file';
	import {
		readSyncHygiene,
		recordSyncExport,
		shouldRemindSyncBackup
	} from '$lib/sync-hygiene';
	import { loadSnapPref, saveSnapPref } from '$lib/canvas-geom';
	import {
		COLLAPSED_CARD,
		EXPANDED_CARD,
		createCanvasSession
	} from '$lib/stores/canvas-session.svelte';
	import {
		createNoteLibrary,
		filterNotes,
		filterPeelNotes
	} from '$lib/stores/note-library.svelte';
	import { createPeelNav, windowPeelNotes } from '$lib/stores/peel-nav.svelte';
	import { createOpenSpaces } from '$lib/stores/spaces.svelte';
	import { theme } from '$lib/stores/theme.svelte';
	import { syncConflicts } from '$lib/stores/sync-conflicts.svelte';
	import {
		createEditorStage,
		type SnapZone
	} from '$lib/stores/editor-stage.svelte';
	import type { PeelConflictRow } from '$lib/components/PeelScanner.svelte';
	import { shouldShowCanvasEmptyState } from '$lib/canvas-empty-state';
	import { detectJsonImportKind, splitExternalImportFiles } from '$lib/external-file-drop';
	import {
		normalizePdfExcerpt,
		pdfClippingTitle,
		type PdfClipping
	} from '$lib/pdf-clipping';

	let actionToast = $state('');
	let toastTimer: ReturnType<typeof setTimeout> | null = null;
	let confirmDialog = $state<{
		title: string;
		message: string;
		confirmLabel: string;
		danger: boolean;
		action: () => void | Promise<void>;
	} | null>(null);

	let showPalette = $state(false);
	let paletteQuery = $state('');
	let paletteInput = $state<HTMLInputElement | null>(null);
	let paletteHighlight = $state(0);
	let settingsOpen = $state(false);
	let shortcutsOpen = $state(false);
	let spacesOverviewOpen = $state(false);
	let spacesOverviewIgnoreUntil = 0;
	/** Sync from localStorage at init (ssr=false) so CanvasBoard never paints Free first. */
	let snapEnabled = $state(loadSnapPref());
	let searchDropdownOpen = $state(false);
	let searchHighlight = $state(0);
	let searchWrapEl = $state<HTMLDivElement | null>(null);
	let syncHygiene = $state(readSyncHygiene());
	let syncBackupReminded = false;

	function refreshSyncHygiene() {
		syncHygiene = readSyncHygiene();
	}

	async function exportSyncBundle() {
		await downloadSyncBundle(library.notes);
		recordSyncExport();
		refreshSyncHygiene();
		flashToast('Exported sync bundle (notes + desk)');
	}

	$effect(() => {
		if (!showPalette) return;
		paletteHighlight = 0;
		void tick().then(() => paletteInput?.focus());
	});

	$effect(() => {
		paletteQuery;
		paletteHighlight = 0;
	});

	let importInputEl: HTMLInputElement | undefined = $state();
	let markdownImportInputEl: HTMLInputElement | undefined = $state();
	let syncInputEl: HTMLInputElement | undefined = $state();
	let pdfInputEl: HTMLInputElement | undefined = $state();
	let pdfReaderFile: File | null = $state(null);
	let pdfReaderOpen = $state(false);
	let pdfReaderView = $state({ page: 1, zoom: 1 });
	let pdfClippings = $state<PdfClipping[]>([]);

	function flashToast(msg: string, ms = 1600) {
		actionToast = msg;
		if (toastTimer) clearTimeout(toastTimer);
		toastTimer = setTimeout(() => {
			actionToast = '';
		}, ms);
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

	const canvasHolder: { session?: ReturnType<typeof createCanvasSession> } = {};
	const spacesHolder: { spaces?: ReturnType<typeof createOpenSpaces> } = {};
	const editorStage = createEditorStage();

	const library = createNoteLibrary({
		flashToast,
		askConfirm,
		getActiveCanvasId: () => canvasHolder.session?.activeCanvas?.id ?? null,
		getFilteredNoteIds: () => filteredNotes.map((n) => n.id),
		clearExpandedIfNote: (noteId) => {
			if (canvas.expandedNoteId === noteId) canvas.expandedNoteId = null;
			if (editorStage.panes.some((p) => p.noteId === noteId)) {
				const pane = editorStage.panes.find((p) => p.noteId === noteId);
				if (pane) editorStage.dismissPane(pane.id);
			}
		},
		onNotesDeleted: (ids) => {
			const idSet = new Set(ids);
			canvas.canvasItems = canvas.canvasItems.filter((i) => !idSet.has(i.noteId));
		},
		onFolderDeleted: async (folder) => {
			const folderCanvas = await db.canvases.where('folder').equals(folder).first();
			if (folderCanvas) {
				await db.canvasItems.where('canvasId').equals(folderCanvas.id).delete();
				await db.canvases.delete(folderCanvas.id);
				clearCanvasViewport(folderCanvas.id);
				clearDismissedForCanvas(folderCanvas.id);
				if (canvas.activeCanvas?.id === folderCanvas.id) {
					await canvas.loadContextCanvas('');
				}
			}
			if (peel.currentFilter.type === 'folder' && peel.currentFilter.value === folder) {
				peel.clearFilter();
			}
			spacesHolder.spaces?.removeSpace(folder);
		},
		onTagDeleted: (tag) => {
			if (peel.currentFilter.type === 'tag' && peel.currentFilter.value === tag) {
				peel.clearFilter();
			}
		},
		onDeskSynced: async () => {
			await canvas.loadContextCanvas(peel.canvasKey);
		},
		onSyncConflicts: (conflicts) => {
			syncConflicts.setFromImport(conflicts);
			const n = conflicts.length;
			flashToast(
				`${n} conflict${n === 1 ? '' : 's'} — review in Conflicts peel`,
				3600
			);
			settingsOpen = false;
			peel.openPeel('conflicts');
		},
		onNoteEdited: (noteId) => {
			syncConflicts.dismissNote(noteId);
		}
	});

	const conflictRows = $derived.by((): PeelConflictRow[] =>
		syncConflicts.items.map((c) => ({
			id: c.id,
			noteId: c.noteId,
			noteTitle: library.notesById.get(c.noteId)?.title ?? c.noteId.slice(0, 8),
			field: c.field,
			chosen: c.chosen,
			canRestoreLocal: c.chosen === 'remote'
		}))
	);

	const peel = createPeelNav({
		clearSelection: () => library.clearSelection(),
		newNote: () => void handleNewNote(),
		getExpandedNoteId: () => canvasHolder.session?.expandedNoteId ?? null,
		getSelectedId: () => library.selectedId,
		getFirstNoteId: () => library.notes[0]?.id ?? null,
		getSettingsOpen: () => settingsOpen,
		openSettings: () => {
			settingsOpen = true;
		},
		closeSettings: () => {
			settingsOpen = false;
		}
	});

	const spaces = createOpenSpaces({
		applySpaceKey: (key) => peel.applySpaceKey(key),
		getActiveKey: () => peel.canvasKey
	});
	spacesHolder.spaces = spaces;

	function showSpacesOverview() {
		if (Date.now() < spacesOverviewIgnoreUntil) return;
		spacesOverviewOpen = true;
	}

	function hideSpacesOverview() {
		// Guard against the closing click retargeting onto the title chip.
		spacesOverviewIgnoreUntil = Date.now() + 600;
		spacesOverviewOpen = false;
	}

	function switchSpace(key: string) {
		hideSpacesOverview();
		spaces.switchTo(key);
	}

	// Opening a folder / pinned context adds it to the open Spaces set.
	$effect(() => {
		const key = peel.canvasKey;
		spaces.ensureFromActiveKey(key);
	});

	function setSnapEnabled(on: boolean) {
		snapEnabled = on;
		saveSnapPref(on);
	}

	const canvas = createCanvasSession({
		flashToast,
		getNotes: () => library.notes,
		getNotesById: () => library.notesById,
		getCanvasKey: () => peel.canvasKey,
		ensureNotePinned: async (noteId) => {
			const note = library.notesById.get(noteId);
			if (note && note.pinned !== 1) {
				await library.handleStickyMetaChange(noteId, { pinned: 1 });
			}
		},
		getSelectionIds: () => library.selectionIds,
		getSelectionSet: () => library.selectionSet,
		getSelectedId: () => library.selectedId,
		setSelection: (ids, selectedId) => {
			library.selectionIds = ids;
			library.selectedId = selectedId;
		},
		selectNote: (id, selOpts) => library.selectNote(id, selOpts),
		toggleSelection: (id, selOpts) => library.toggleSelection(id, selOpts),
		deleteBlankNote: (id) => deleteNote(id),
		removeNoteFromSearch,
		removeNoteFromLibrary: (id) => {
			library.notes = library.notes.filter((n) => n.id !== id);
		},
		openNoteInStage: (noteId, zone) => {
			openInStage(noteId, zone ?? 'maximize');
		}
	});
	canvasHolder.session = canvas;

	function openPdfReader(file: File) {
		pdfReaderFile = file;
		pdfReaderOpen = true;
		pdfReaderView = { page: 1, zoom: 1 };
		pdfClippings = [];
		showPalette = false;
		settingsOpen = false;
		peel.closePeel(true);
		library.clearSelection();
		if (canvas.expandedNoteId) canvas.collapseSticky();
		if (editorStage.open) editorStage.dismissAll();
	}

	function resumePdfReader() {
		if (!pdfReaderFile) return;
		pdfReaderOpen = true;
		settingsOpen = false;
		peel.closePeel(true);
		library.clearSelection();
		if (canvas.expandedNoteId) canvas.collapseSticky();
		if (editorStage.open) editorStage.dismissAll();
	}

	function hidePdfReader() {
		pdfReaderOpen = false;
	}

	async function savePdfClipping(excerpt: { text: string; page: number }) {
		if (!pdfReaderFile) return;
		const text = normalizePdfExcerpt(excerpt.text);
		if (!text) return;
		const note = await createNote({
			title: pdfClippingTitle(text),
			body: text,
			folder: peel.canvasFolder,
			tags: ['pdf-clipping'],
			links: [],
			source: {
				kind: 'pdf',
				title: pdfReaderFile.name,
				page: excerpt.page
			}
		});
		addNoteToSearch(note);
		library.notes = [note, ...library.notes];
		pdfClippings = [
			...pdfClippings,
			{ id: crypto.randomUUID(), noteId: note.id, text, page: excerpt.page }
		];
		flashToast(`Saved excerpt from page ${excerpt.page}`);
	}

	async function openPdfClippingsOnCanvas(noteIds: string[]) {
		if (noteIds.length === 0) return;
		const spawn = canvas.canvasBoard?.getSpawnPoint(COLLAPSED_CARD, canvas.canvasItems.length) ?? {
			x: 80,
			y: 80
		};
		pdfReaderOpen = false;
		await tick();
		await canvas.handleDropNotes(noteIds, spawn.x, spawn.y);
		flashToast(`Opened ${noteIds.length} clipping${noteIds.length === 1 ? '' : 's'} on canvas`);
	}

	async function handleDroppedFiles(files: File[], x: number, y: number) {
		const batch = splitExternalImportFiles(files);
		const supportedCount =
			batch.noteTextFiles.length + batch.jsonFiles.length + batch.pdfFiles.length;
		if (supportedCount === 0) {
			flashToast('Drop a PDF, text note, or Mash JSON file', 3000);
			return;
		}

		flashToast(`Importing ${supportedCount} file${supportedCount === 1 ? '' : 's'}…`, 5000);
		const importedNoteIds: string[] = [];
		let importedFileCount = 0;
		let importedSyncCount = 0;
		let failedCount = 0;
		let waitingForConfirmation = false;
		let openedPdfName = '';

		if (batch.pdfFiles.length > 0) {
			openPdfReader(batch.pdfFiles[0]!);
			openedPdfName = batch.pdfFiles[0]!.name;
			if (batch.pdfFiles.length > 1) failedCount += batch.pdfFiles.length - 1;
		}

		if (batch.noteTextFiles.length > 0) {
			const result = await library.importMarkdownFiles(batch.noteTextFiles, {
				allowPlainText: true,
				silent: true
			});
			if (result.ok && result.notes) {
				importedNoteIds.push(...result.notes.map((note) => note.id));
				importedFileCount += batch.noteTextFiles.length;
			} else {
				failedCount += batch.noteTextFiles.length;
			}
		}

		for (const file of batch.jsonFiles) {
			try {
				if (file.size > 8_000_000) {
					failedCount++;
					continue;
				}
				const text = await file.text();
				const kind = detectJsonImportKind(text);
				if (kind === 'notes') {
					const result = await library.importNotesText(text, { silent: true });
					if (result.ok && result.notes) {
						importedNoteIds.push(...result.notes.map((note) => note.id));
						importedFileCount++;
					} else {
						failedCount++;
					}
				} else if (kind === 'sync') {
					const result = await library.importSyncText(text);
					if (result.ok) {
						importedSyncCount++;
						refreshSyncHygiene();
					} else if (result.message === 'Waiting for stale-import confirmation') {
						waitingForConfirmation = true;
					} else {
						failedCount++;
					}
				} else {
					failedCount++;
				}
			} catch (error) {
				console.error(error);
				failedCount++;
			}
		}

		const uniqueNoteIds = [...new Set(importedNoteIds)];
		if (uniqueNoteIds.length > 0) {
			await canvas.handleDropNotes(uniqueNoteIds, x, y);
		}

		const skippedCount = batch.unsupportedFiles.length + failedCount;
		const parts: string[] = [];
		if (openedPdfName) parts.push(`Opened ${openedPdfName}`);
		if (uniqueNoteIds.length > 0) {
			parts.push(
				`Imported ${uniqueNoteIds.length} note${uniqueNoteIds.length === 1 ? '' : 's'} from ${importedFileCount} file${importedFileCount === 1 ? '' : 's'}`
			);
		}
		if (importedSyncCount > 0) {
			parts.push(
				`Imported ${importedSyncCount} sync bundle${importedSyncCount === 1 ? '' : 's'}`
			);
		}
		if (skippedCount > 0) {
			parts.push(`Skipped ${skippedCount} unsupported or invalid`);
		}
		if (parts.length > 0) flashToast(parts.join(' · '), 3600);
		else if (!waitingForConfirmation) flashToast('No supported files imported', 3600);
	}

	/** Desk/folders/tags peels sit above the stage and steal clicks — dismiss unless Linked. */
	function dismissPeelForStage() {
		if (peel.peelOpen && peel.peelMode !== 'linked') {
			peel.closePeel();
		}
	}

	function openInStage(noteId: string, zone: SnapZone = 'maximize') {
		if (canvas.expandedNoteId === noteId) canvas.collapseSticky();
		library.selectNote(noteId, { keepSelection: true });
		dismissPeelForStage();
		editorStage.openNote(noteId, zone);
	}

	function openSelectionInStage() {
		const ids = [...new Set(library.selectionIds)];
		if (ids.length === 0) return;
		if (canvas.expandedNoteId) canvas.collapseSticky();
		dismissPeelForStage();
		if (ids.length === 1) {
			editorStage.openNote(ids[0]!, 'maximize');
			return;
		}
		editorStage.openSplit(ids[0]!, ids[1]!);
	}

	function openBesideSelection() {
		const id = library.selectedId ?? library.selectionIds[0];
		if (!id) return;
		if (canvas.expandedNoteId === id) canvas.collapseSticky();
		dismissPeelForStage();
		editorStage.openBeside(id);
	}

	let filteredNotes = $derived(filterNotes(library.notes, peel.currentFilter, ''));
	let showCanvasEmptyState = $derived(
		shouldShowCanvasEmptyState(
			canvas.canvasItems,
			library.notesById,
			peel.currentFilter.type === 'pinned'
		)
	);
	let peelNotes = $derived(filterPeelNotes(filteredNotes, peel.peelFilterText));
	/** Screenplay mode: any open folder/pinned board besides root Desk. */
	let screenplayActive = $derived(spaces.openKeys.length > 1);
	let screenplayChipTitle = $derived(screenplayActive ? 'Screenplay' : peel.canvasTitle);
	let headerSearchResults = $derived(
		peel.searchQuery.trim() ? searchNotes(peel.searchQuery) : []
	);
	let linkedFocusNote = $derived(
		peel.linkedFocusId
			? (library.notes.find((n) => n.id === peel.linkedFocusId) ?? null)
			: canvas.expandedNoteId
				? (library.notes.find((n) => n.id === canvas.expandedNoteId) ?? null)
				: library.selectedNote
	);
	let linkedOutgoing = $derived(
		linkedFocusNote ? findOutgoingNotes(library.notes, linkedFocusNote) : []
	);
	let linkedBacklinks = $derived(
		linkedFocusNote ? findBacklinks(library.notes, linkedFocusNote) : []
	);
	let peelNotesWindowed = $derived(windowPeelNotes(peelNotes));

	$effect(() => {
		peel.searchQuery;
		searchHighlight = 0;
		searchDropdownOpen = Boolean(peel.searchQuery.trim());
	});

	function closeSearchDropdown(clearQuery = false) {
		searchDropdownOpen = false;
		searchHighlight = 0;
		if (clearQuery) peel.searchQuery = '';
	}

	function openHeaderSearchResult(id: string) {
		void canvas.openStickyFromTray(id);
		closeSearchDropdown(true);
	}

	function onGlobalSearchKeydown(e: KeyboardEvent) {
		const q = peel.searchQuery.trim();
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			closeSearchDropdown(true);
			(e.currentTarget as HTMLInputElement).blur();
			return;
		}
		if (!q) return;
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			searchDropdownOpen = true;
			if (headerSearchResults.length === 0) return;
			searchHighlight = (searchHighlight + 1) % headerSearchResults.length;
			return;
		}
		if (e.key === 'ArrowUp') {
			e.preventDefault();
			searchDropdownOpen = true;
			if (headerSearchResults.length === 0) return;
			searchHighlight =
				(searchHighlight - 1 + headerSearchResults.length) % headerSearchResults.length;
			return;
		}
		if (e.key === 'Enter') {
			e.preventDefault();
			const hit = headerSearchResults[searchHighlight] ?? headerSearchResults[0];
			if (hit) openHeaderSearchResult(hit.id);
		}
	}

	function onSearchPointerDown(e: PointerEvent) {
		const t = e.target as Node | null;
		if (searchWrapEl && t && searchWrapEl.contains(t)) return;
		if (searchDropdownOpen) closeSearchDropdown(false);
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
		if (!canvas.activeCanvas) {
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
			const onBoard = canvas.canvasItems.filter((i) =>
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
			folder: peel.canvasFolder,
			tags: mergedTags,
			links: extractWikilinks(body),
			mashedFrom: sourceIds
		});
		addNoteToSearch(mashed);
		library.notes = [mashed, ...library.notes];

		const removeIds =
			opts?.removeItemIds ??
			canvas.canvasItems.filter((i) => sourceIds.includes(i.noteId)).map((i) => i.id);
		for (const id of removeIds) {
			await removeCanvasItem(id);
		}
		// Keep mashed sources off folder canvases until Unmash / drop-back.
		for (const noteId of sourceIds) {
			dismissNoteFromCanvas(canvas.activeCanvas.id, noteId);
		}
		// Drop undo entries that referenced removed cards — keep unrelated history.
		canvas.pruneCanvasUndo(removeIds);

		const item = await addNoteToCanvas(canvas.activeCanvas.id, mashed.id, {
			x: placeX,
			y: placeY,
			w: EXPANDED_CARD.w,
			h: EXPANDED_CARD.h
		});
		await canvas.refreshCanvasItems();
		library.selectionIds = [mashed.id];
		library.selectedId = mashed.id;
		canvas.settlingIds = new Set([item.id]);
		setTimeout(() => {
			canvas.settlingIds = new Set();
		}, 320);
		openInStage(mashed.id, 'maximize');
		flashToast('Mashed — use Unmash to restore sources');
	}

	async function combineSelection() {
		const notes = library.selectedNotes;
		if (notes.length < 2) {
			flashToast('Select at least 2 notes to mash');
			return;
		}
		const preview = notes
			.slice(0, 3)
			.map((n) => n.title)
			.join(', ');
		const extra = notes.length > 3 ? ` +${notes.length - 3}` : '';
		const noteIds = notes.map((n) => n.id);
		askConfirm({
			title: 'Mash these notes?',
			message: `Combine ${notes.length} notes (${preview}${extra}) into one sticky. Sources leave the desk until you Unmash.`,
			confirmLabel: 'Mash',
			action: async () => {
				const latest = noteIds
					.map((id) => library.notesById.get(id))
					.filter((n): n is Note => Boolean(n));
				if (latest.length < 2) {
					flashToast('Select at least 2 notes to mash');
					return;
				}
				await mashNotesIntoBubble(latest);
			}
		});
	}

	/** Restore source notes onto the canvas and remove the mash bubble. */
	async function unmashSelection() {
		if (!canvas.activeCanvas) return;
		const mashNotes = library.selectedNotes.filter(
			(n) => n.mashedFrom && n.mashedFrom.length > 0
		);
		if (mashNotes.length === 0) {
			flashToast('Select a mashed sticky to unmash');
			return;
		}

		const placed: string[] = [];
		let missingSources = 0;
		for (const mash of mashNotes) {
			const sourceIds = mash.mashedFrom ?? [];
			const sources = sourceIds
				.map((id) => library.notes.find((n) => n.id === id))
				.filter((n): n is Note => Boolean(n));
			missingSources += sourceIds.length - sources.length;
			const mashItem = canvas.canvasItems.find((i) => i.noteId === mash.id);
			const baseX = mashItem?.x ?? 80;
			const baseY = mashItem?.y ?? 80;

			if (mashItem) {
				await removeCanvasItem(mashItem.id);
			}
			undismissNotesFromCanvas(
				canvas.activeCanvas.id,
				sources.map((s) => s.id)
			);

			for (let i = 0; i < sources.length; i++) {
				const item = await addNoteToCanvas(canvas.activeCanvas.id, sources[i].id, {
					x: baseX + i * 24,
					y: baseY + i * 24,
					w: COLLAPSED_CARD.w,
					h: COLLAPSED_CARD.h
				});
				placed.push(item.id);
			}

			await deleteNote(mash.id);
			removeNoteFromSearch(mash.id);
			library.notes = library.notes.filter((n) => n.id !== mash.id);
			if (canvas.expandedNoteId === mash.id) canvas.expandedNoteId = null;
		}

		await canvas.refreshCanvasItems();
		library.selectionIds = [];
		library.selectedId = null;
		canvas.settlingIds = new Set(placed);
		setTimeout(() => {
			canvas.settlingIds = new Set();
		}, 320);
		flashToast(
			missingSources > 0
				? `Unmashed — ${missingSources} source${missingSources === 1 ? '' : 's'} missing`
				: 'Unmashed — sources restored'
		);
	}

	async function openWikilink(target: string) {
		const title = target.trim();
		const needle = title.toLowerCase();
		if (!needle) return;
		const existing = library.notes.find((n) => n.title.trim().toLowerCase() === needle);
		if (existing) {
			peel.openLinkedPeel(existing.id);
			await canvas.openStickyFromTray(existing.id);
			return;
		}
		askConfirm({
			title: 'Create note?',
			message: `No note titled “${title}” yet. Create it and open it on the desk?`,
			confirmLabel: 'Create',
			action: async () => {
				const note = await createNote({
					title,
					body: '',
					folder: peel.canvasFolder,
					links: []
				});
				addNoteToSearch(note);
				library.notes = [note, ...library.notes];
				flashToast(`Created “${note.title}”`);
				peel.openLinkedPeel(note.id);
				await canvas.openStickyFromTray(note.id);
			}
		});
	}

	async function handleMashCards(sourceItemId: string, targetItemId: string) {
		const source = canvas.canvasItems.find((i) => i.id === sourceItemId);
		const target = canvas.canvasItems.find((i) => i.id === targetItemId);
		if (!source || !target) return;

		// Drag-onto always mashes the overlapped pair only. Use the selection-bar
		// Mash action (or ⌘M) to combine a larger multi-selection.
		const mashNoteIds = [source.noteId, target.noteId];
		const mashNotes = mashNoteIds
			.map((id) => library.notesById.get(id))
			.filter((n): n is Note => Boolean(n));
		if (mashNotes.length < 2) return;

		const mashItems = canvas.canvasItems.filter((i) => mashNoteIds.includes(i.noteId));
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

	async function handleNewNote() {
		const onPinned = peel.currentFilter.type === 'pinned';
		const note = await createNote({
			title: 'Untitled',
			body: '',
			folder: peel.currentFilter.type === 'folder' ? peel.currentFilter.value || '' : '',
			links: [],
			pinned: onPinned ? 1 : 0
		});
		addNoteToSearch(note);
		library.notes = [note, ...library.notes];
		if (canvas.activeCanvas) {
			const spawn =
				canvas.canvasBoard?.getSpawnPoint(COLLAPSED_CARD, canvas.canvasItems.length) ?? {
					x: 80,
					y: 80
				};
			const item = await addNoteToCanvas(canvas.activeCanvas.id, note.id, {
				x: spawn.x,
				y: spawn.y,
				w: COLLAPSED_CARD.w,
				h: COLLAPSED_CARD.h
			});
			await canvas.refreshCanvasItems();
			library.selectNote(note.id);
			canvas.settlingIds = new Set([item.id, ...canvas.settlingIds]);
			setTimeout(() => {
				canvas.settlingIds = new Set();
			}, 320);
			openInStage(note.id, 'maximize');
			return;
		}
		library.selectNote(note.id);
		openInStage(note.id, 'maximize');
	}

	async function runConfirmDialog() {
		const pending = confirmDialog;
		confirmDialog = null;
		if (!pending) return;
		await pending.action();
	}

	function handleKeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
			const tag = (e.target as HTMLElement)?.tagName;
			if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
				e.preventDefault();
				if (e.shiftKey) void canvas.redoCanvasLayout();
				else void canvas.undoCanvasLayout();
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
			if (tag !== 'INPUT' && tag !== 'TEXTAREA' && library.selectionIds.length >= 2) {
				e.preventDefault();
				void combineSelection();
			}
		}
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p') {
			const tag = (e.target as HTMLElement)?.tagName;
			if (tag !== 'INPUT' && tag !== 'TEXTAREA' && library.selectedId) {
				e.preventDefault();
				const note = library.selectedNote;
				if (note) {
					const np = note.pinned === 1 ? 0 : 1;
					void library.handleStickyMetaChange(note.id, { pinned: np as 0 | 1 });
				}
			}
		}
		if (e.key === '?') {
			const tag = (e.target as HTMLElement)?.tagName;
			if (tag !== 'INPUT' && tag !== 'TEXTAREA' && !(e.target as HTMLElement)?.isContentEditable) {
				e.preventDefault();
				shortcutsOpen = true;
			}
		}
		// Ctrl+ArrowUp — Show Screenplay (open folder boards)
		if (e.ctrlKey && e.key === 'ArrowUp') {
			const tag = (e.target as HTMLElement)?.tagName;
			if (tag !== 'INPUT' && tag !== 'TEXTAREA' && !(e.target as HTMLElement)?.isContentEditable) {
				e.preventDefault();
				showSpacesOverview();
			}
		}
		if (e.key === '/' && document.activeElement?.tagName === 'BODY') {
			e.preventDefault();
			(document.getElementById('global-search') as HTMLInputElement)?.focus();
		}
		if (e.key === 'Escape') {
			if (pdfReaderOpen) {
				hidePdfReader();
				return;
			}
			if (confirmDialog) {
				confirmDialog = null;
				return;
			}
			if (spacesOverviewOpen) {
				hideSpacesOverview();
				return;
			}
			if (shortcutsOpen) {
				shortcutsOpen = false;
				return;
			}
			if (library.bulkMenu) {
				library.bulkMenu = null;
				return;
			}
			if (showPalette) {
				showPalette = false;
				return;
			}
			if (searchDropdownOpen || peel.searchQuery.trim()) {
				closeSearchDropdown(true);
				return;
			}
			if (editorStage.open) {
				editorStage.dismissAll();
				return;
			}
			if (canvas.expandedNoteId) {
				canvas.collapseSticky();
				return;
			}
			if (settingsOpen) {
				settingsOpen = false;
				return;
			}
			if (peel.peelOpen) {
				peel.closePeel(true);
				return;
			}
			if (library.selectionIds.length > 0) {
				library.clearSelection();
			}
		}
	}

	const paletteActions = [
		{ label: 'New note', action: handleNewNote, shortcut: '⌘N' },
		{
			label: 'Open PDF reader…',
			action: () => {
				showPalette = false;
				pdfInputEl?.click();
			},
			shortcut: ''
		},
		{
			label: 'Show Screenplay…',
			action: () => {
				showPalette = false;
				showSpacesOverview();
			},
			shortcut: '⌃↑'
		},
		{
			label: 'Open Settings…',
			action: () => {
				showPalette = false;
				peel.closePeel(true);
				settingsOpen = true;
			},
			shortcut: ''
		},
		{
			label: 'Mash selected notes',
			action: () => {
				void combineSelection();
				showPalette = false;
			},
			shortcut: '⌘M'
		},
		{
			label: 'Copy selected as Markdown',
			action: () => {
				void library.copySelection();
				showPalette = false;
			},
			shortcut: ''
		},
		{
			label: 'Export selected as Markdown',
			action: () => {
				library.exportSelectionMarkdown();
				showPalette = false;
			},
			shortcut: ''
		},
		{
			label: 'Export selected as JSON',
			action: () => {
				library.exportSelectionJson();
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
				if (library.selectionIds.length === 0) return;
				library.bulkMenu = 'tag';
				showPalette = false;
			},
			shortcut: ''
		},
		{
			label: 'Move selected to folder',
			action: () => {
				if (library.selectionIds.length === 0) return;
				library.bulkMenu = 'folder';
				showPalette = false;
			},
			shortcut: ''
		},
		{
			label: 'Delete selected notes',
			action: () => {
				void library.handleDelete();
				showPalette = false;
			},
			shortcut: ''
		},
		{
			label: 'Toggle pin',
			action: () => {
				if (!library.selectedId) return;
				const np = library.selectedNote?.pinned === 1 ? 0 : 1;
				library.handleStickyMetaChange(library.selectedId, { pinned: np as 0 | 1 });
				showPalette = false;
			},
			shortcut: '⌘P'
		},
		{
			label: 'Delete current note',
			action: () => {
				library.handleDelete();
				showPalette = false;
			},
			shortcut: ''
		},
		{ label: 'Clear filters & search', action: peel.clearFilter, shortcut: 'Esc' },
		{
			label: 'Import notes from JSON…',
			action: () => {
				showPalette = false;
				importInputEl?.click();
			},
			shortcut: ''
		},
		{
			label: 'Import markdown vault…',
			action: () => {
				showPalette = false;
				markdownImportInputEl?.click();
			},
			shortcut: ''
		},
		{
			label: 'Export all as JSON',
			action: () => {
				exportNotesJson(library.notes, 'mash-notes-export.json');
				showPalette = false;
			},
			shortcut: ''
		},
		{
			label: 'Export sync bundle…',
			action: () => {
				void exportSyncBundle();
				showPalette = false;
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
				shortcutsOpen = true;
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
				? library.notes
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
					library.selectNote(note.id);
					void canvas.openStickyFromTray(note.id);
					showPalette = false;
				}
			}
		}
	}

	onMount(() => {
		void library.loadNotes().then(() => {
			if (syncBackupReminded) return;
			if (!shouldRemindSyncBackup(library.notes.length)) return;
			syncBackupReminded = true;
			flashToast('Tip: export a sync bundle to back up this browser', 4200);
		});
		window.addEventListener('keydown', handleKeydown);
		window.addEventListener('pointerdown', onSearchPointerDown, true);
		window.addEventListener('pagehide', library.flushPendingSave);
		document.addEventListener('visibilitychange', library.handleVisibilityChange);
		// E2E / diagnostics: import a sync bundle without relying on hidden file inputs.
		window.__mashImportSync = async (text: string) => {
			const result = await library.importSyncText(text);
			refreshSyncHygiene();
			return result;
		};
		return () => {
			window.removeEventListener('keydown', handleKeydown);
			window.removeEventListener('pointerdown', onSearchPointerDown, true);
			window.removeEventListener('pagehide', library.flushPendingSave);
			document.removeEventListener('visibilitychange', library.handleVisibilityChange);
			delete window.__mashImportSync;
		};
	});
</script>

<div
	class="mash-app-shell mash-board-surface flex h-screen flex-col {snapEnabled
		? 'is-snap-on'
		: ''}"
	style="color: var(--mash-ink);"
>
	<!-- Header -->
	<header class="mash-app-header flex items-center justify-between px-5 py-3.5">
		<div class="flex items-center gap-3.5">
			<img
				src="/icons/mash-logo-sprouts.png"
				srcset="/icons/mash-logo-sprouts.png 1x, /icons/mash-logo-sprouts@2x.png 2x"
				alt="Mash"
				width="56"
				height="70"
				class="mash-logo h-[4rem] w-auto select-none"
				draggable="false"
			/>
			<div class="flex flex-col leading-none">
				<span class="mash-display text-[22px] font-semibold tracking-tight">Mash</span>
				<span
					class="mt-1 text-[11px] font-medium tracking-[0.14em] uppercase"
					style="color: var(--mash-accent-bright);"
				>
					Infinite textual stovetop
				</span>
			</div>
		</div>

		<div class="flex flex-1 items-center justify-center px-4">
			<div class="relative w-full max-w-md" bind:this={searchWrapEl}>
				<Search
					class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
					style="color: var(--mash-ink-muted);"
				/>
				<input
					id="global-search"
					type="text"
					placeholder="Search notes to grab…"
					bind:value={peel.searchQuery}
					oninput={peel.handleGlobalSearch}
					onfocus={() => {
						if (peel.searchQuery.trim()) searchDropdownOpen = true;
					}}
					onkeydown={onGlobalSearchKeydown}
					class="mash-focus mash-header-search w-full rounded-lg border py-2 pr-14 pl-9 text-sm transition-colors"
					style="border-color: var(--mash-tray-edge); color: var(--mash-ink);"
					aria-autocomplete="list"
					aria-expanded={searchDropdownOpen && Boolean(peel.searchQuery.trim())}
					aria-controls="mash-header-search-results"
				/>
				<kbd
					class="pointer-events-none absolute top-1/2 right-2.5 hidden -translate-y-1/2 items-center gap-0.5 rounded border px-1.5 py-0.5 text-[10px] font-medium sm:flex"
					style="border-color: var(--mash-tray-edge); color: var(--mash-ink-muted);"
				>
					/
				</kbd>
				<div id="mash-header-search-results">
					<SearchResultsDropdown
						open={searchDropdownOpen && Boolean(peel.searchQuery.trim())}
						query={peel.searchQuery}
						results={headerSearchResults}
						notesById={library.notesById}
						highlightIndex={searchHighlight}
						draggingId={canvas.draggingTrayId}
						onOpen={openHeaderSearchResult}
						onHighlight={(i) => (searchHighlight = i)}
						onDragStart={canvas.onTrayDragStart}
						onDragEnd={canvas.onTrayDragEnd}
					/>
				</div>
			</div>
		</div>

		<div class="flex items-center gap-2">
			<button
				type="button"
				class="mash-reader-launch mash-focus"
				class:is-active={pdfReaderOpen}
				class:has-session={Boolean(pdfReaderFile) && !pdfReaderOpen}
				onclick={() => (pdfReaderFile ? resumePdfReader() : pdfInputEl?.click())}
				aria-label={pdfReaderFile ? 'Return to PDF reader' : 'Open PDF reader'}
				title={pdfReaderFile ? `Return to ${pdfReaderFile.name}` : 'Open a PDF and capture excerpts'}
			>
				<BookOpen class="h-[18px] w-[18px]" strokeWidth={1.9} />
			</button>
			<button
				type="button"
				class="mash-theme-toggle mash-focus"
				onclick={() => theme.toggle()}
				aria-label={theme.mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
				title={theme.mode === 'dark' ? 'Night kitchen — switch to day' : 'Day kitchen — switch to night'}
			>
				{#if theme.mode === 'dark'}
					<img
						src="/icons/mash-flame-night.png"
						srcset="/icons/mash-flame-night.png 1x, /icons/mash-flame-night@2x.png 2x"
						alt=""
						width="40"
						height="40"
						class="mash-theme-flame"
						draggable="false"
					/>
				{:else}
					<img
						src="/icons/mash-flame-day.png"
						srcset="/icons/mash-flame-day.png 1x, /icons/mash-flame-day@2x.png 2x"
						alt=""
						width="40"
						height="40"
						class="mash-theme-flame"
						draggable="false"
					/>
				{/if}
			</button>
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

	{#if library.loadError}
		<div
			class="flex items-center justify-between gap-3 border-b px-4 py-2 text-xs"
			style="border-color: var(--mash-tray-edge); background: var(--mash-danger-wash); color: var(--mash-ink);"
		>
			<span>{library.loadError}</span>
			<button
				type="button"
				class="mash-btn rounded-md px-2.5 py-1 text-[11px] font-semibold"
				onclick={() => void library.loadNotes()}
			>
				Retry
			</button>
		</div>
	{/if}

	<!-- Full-bleed canvas stage -->
	<div class="relative flex min-h-0 flex-1">
		<div class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
			{#if !pdfReaderOpen}
				<div
					class="mash-canvas-title-chip is-spaces-trigger absolute top-3 left-[4.75rem] z-10 rounded-full border px-3 py-1 text-[10px] backdrop-blur-sm"
				class:pointer-events-none={spacesOverviewOpen}
				style="border-color: var(--mash-chrome-chip-border); background: var(--mash-chrome-chip-soft); color: var(--mash-chrome-muted);"
				role="button"
				tabindex="0"
				aria-label="Show Screenplay"
				aria-haspopup="dialog"
				aria-expanded={spacesOverviewOpen}
				data-screenplay-chip
				onclick={() => showSpacesOverview()}
				onkeydown={(e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						showSpacesOverview();
					}
				}}
			>
				<span class="mash-display font-medium" style="color: var(--mash-chrome-ink);">{screenplayChipTitle}</span>
				<span class="mx-1.5 opacity-40">·</span>
				{canvas.canvasItems.length} on canvas
				{#if spaces.openKeys.length > 1}
					<span class="mash-spaces-dots" aria-hidden="true">
						{#each spaces.openKeys as key (key === '' ? '__desk__' : key)}
							<span class="mash-spaces-dot" class:is-active={key === peel.canvasKey}></span>
						{/each}
					</span>
				{/if}
				</div>
			{/if}

			<div class="relative min-h-0 flex-1 overflow-hidden">
				{#if pdfReaderFile && !pdfReaderOpen}
					<button
						type="button"
						class="mash-reader-return mash-focus"
						onclick={resumePdfReader}
						title={`Return to ${pdfReaderFile.name}`}
					>
						<BookOpen class="h-4 w-4 shrink-0" strokeWidth={2} />
						<span>Return to PDF</span>
						<small>{pdfReaderFile.name}</small>
					</button>
				{/if}
				<CanvasBoard
					bind:this={canvas.canvasBoard}
					items={canvas.canvasItems}
					notesById={library.notesById}
					selectedIds={library.selectionSet}
					primarySelectedId={library.selectedId}
					expandedNoteId={canvas.expandedNoteId}
					expandFocus={canvas.expandFocus}
					settlingIds={canvas.settlingIds}
					canvasId={canvas.activeCanvas?.id ?? null}
					edges={canvas.canvasEdges}
					onConnectFlow={(from, to) => canvas.connectFlowEdge(from, to)}
					onDisconnectFlow={(id) => void canvas.disconnectFlowEdge(id)}
					onUnstitchSequence={(i) => void canvas.unstitchSequence(i)}
					onRelayoutFlow={() => canvas.relayoutFlowSequences()}
					onClearSelection={() => library.clearSelection()}
					onToast={flashToast}
					emptyMascot={
						peel.currentFilter.type === 'pinned'
							? {
									src: '/icons/mash-pinned-mascot.png',
									srcset:
										'/icons/mash-pinned-mascot.png 1x, /icons/mash-pinned-mascot@2x.png 2x',
									width: 160,
									height: 160,
									title: 'Pin notes here',
									copy: 'Drop favorites onto this board — or pin from any sticky.'
								}
							: undefined
					}
					showEmptyState={showCanvasEmptyState}
					onSelect={canvas.handleCanvasSelect}
					onSelectNotes={canvas.handleCanvasSelectNotes}
					onMove={canvas.handleCanvasMove}
					onMoveMany={canvas.handleCanvasMoveMany}
					onMoveEnd={canvas.handleCanvasMoveEnd}
					onResize={canvas.handleCanvasResize}
					onResizeEnd={canvas.handleCanvasResizeEnd}
					onRemove={canvas.handleCanvasRemove}
					onExpand={canvas.expandSticky}
					onCollapse={canvas.collapseSticky}
					onOpenInStage={openInStage}
					onStageSnapPreview={(zone) => editorStage.setPreview(zone)}
					stagePanes={editorStage.panes}
					stageSplitH={editorStage.splitH}
					stageSplitV={editorStage.splitV}
					onTitleChange={library.handleStickyTitleChange}
					onBodyChange={library.handleStickyBodyChange}
					onMetaChange={library.handleStickyMetaChange}
					onWikilink={(target) => void openWikilink(target)}
					onOpenLinks={peel.openLinkedPeel}
					folders={library.uniqueFolders}
					onDropNotes={canvas.handleDropNotes}
					onDropFiles={handleDroppedFiles}
					onMashCards={handleMashCards}
					onBlankPointerDown={() => {
						peel.closePeel();
						settingsOpen = false;
					}}
					canUndo={canvas.canCanvasUndo}
					canRedo={canvas.canCanvasRedo}
					onUndo={() => void canvas.undoCanvasLayout()}
					onRedo={() => void canvas.redoCanvasLayout()}
					onOpenShortcuts={() => (shortcutsOpen = true)}
					bind:snapEnabled
				/>
				{#if pdfReaderFile}
					{#key pdfReaderFile}
						<PdfReader
							file={pdfReaderFile}
							clippings={pdfClippings}
							open={pdfReaderOpen}
							initialPage={pdfReaderView.page}
							initialZoom={pdfReaderView.zoom}
							onClose={hidePdfReader}
							onClip={savePdfClipping}
							onOpenClippings={openPdfClippingsOnCanvas}
							onViewChange={(view) => (pdfReaderView = view)}
						/>
					{/key}
				{/if}
				{#if !pdfReaderOpen}
					<EditorStage
						stage={editorStage}
						notesById={library.notesById}
						canvasNotes={canvas.canvasItems
							.map((i) => library.notesById.get(i.noteId))
							.filter((n): n is Note => Boolean(n))}
						folders={library.uniqueFolders}
						onTitleChange={library.handleStickyTitleChange}
						onBodyChange={library.handleStickyBodyChange}
						onMetaChange={library.handleStickyMetaChange}
						onWikilink={(target) => void openWikilink(target)}
					/>
				{/if}
			</div>
		</div>

		<!-- Dock + peel sit above the canvas stage so magnification isn't clipped by overflow-hidden. -->
		<div
			class="mash-dock-slot pointer-events-auto absolute top-1/2 left-3 z-30 -translate-y-1/2 overflow-visible py-5 pr-8"
		>
			<MashDock
				currentFilter={peel.currentFilter}
				searchQuery={peel.searchQuery}
				foldersOpen={peel.foldersFlyout}
				tagsOpen={peel.tagsFlyout}
				linkedOpen={peel.linkedFlyout}
				settingsOpen={settingsOpen}
				dockSelect={peel.handleDockAction}
			/>
		</div>
		{#if settingsOpen}
			<div class="mash-peel-slot pointer-events-auto absolute top-1/2 left-[4.75rem] z-30 -translate-y-1/2">
				<SettingsPanel
					{snapEnabled}
					lastExportAt={syncHygiene.lastExportAt}
					lastImportAt={syncHygiene.lastImportAt}
					onClose={() => (settingsOpen = false)}
					onSnapChange={setSnapEnabled}
					onOrganize={() => canvas.canvasBoard?.organizeToSnap?.()}
					onOpenShortcuts={() => {
						settingsOpen = false;
						shortcutsOpen = true;
					}}
					onImportMarkdown={() => markdownImportInputEl?.click()}
					onImportJson={() => importInputEl?.click()}
					onExportJson={() => exportNotesJson(library.notes, 'mash-notes-export.json')}
					onImportSync={() => syncInputEl?.click()}
					onExportSync={() => {
						void exportSyncBundle();
					}}
					conflictCount={syncConflicts.count}
					onOpenConflicts={() => {
						settingsOpen = false;
						peel.openPeel('conflicts');
					}}
				/>
			</div>
		{:else if peel.peelOpen}
			<div class="mash-peel-slot pointer-events-auto absolute top-1/2 left-[4.75rem] z-30 -translate-y-1/2">
				<PeelScanner
					open={peel.peelOpen}
					pinned={peel.peelPinned}
					mode={peel.peelMode}
					title={peel.peelTitle}
					notes={peelNotesWindowed}
					outgoingNotes={linkedOutgoing}
					backlinkNotes={linkedBacklinks}
					linkedFocusTitle={linkedFocusNote?.title ?? ''}
					folders={library.uniqueFolders}
					tags={library.uniqueTags}
					selectedIds={library.selectionSet}
					draggingId={canvas.draggingTrayId}
					saveStatus={library.saveStatus}
					filterText={peel.peelFilterText}
					isLoading={library.isLoading}
					onClose={() => peel.closePeel(true)}
					onTogglePin={peel.togglePin}
					onFilterText={(v) => (peel.peelFilterText = v)}
					onNoteClick={library.handleNoteClick}
					onNoteOpen={(id) => void canvas.openStickyFromTray(id)}
					onDragStart={canvas.onTrayDragStart}
					onDragEnd={canvas.onTrayDragEnd}
					onPickFolder={(folder) => {
						peel.setFilter('folder', folder);
						peel.openPeel('notes');
					}}
					onPickTag={(tag) => {
						peel.setFilter('tag', tag);
						peel.openPeel('notes');
					}}
					onDeleteFolder={(folder) => void library.deleteFolder(folder)}
					onDeleteTag={(tag) => void library.deleteTag(tag)}
					onNewNote={handleNewNote}
					onSelectAllNotes={() => {
						library.selectionIds = peelNotesWindowed.map((n) => n.id);
						library.selectedId = library.selectionIds[0] ?? null;
					}}
					onTouchPlaceStart={canvas.startTouchPlace}
					conflictRows={conflictRows}
					onConflictKeepRemote={(id) => {
						syncConflicts.dismiss(id);
						if (syncConflicts.count === 0) peel.closePeel(true);
					}}
					onConflictRestoreLocal={(id) => {
						void (async () => {
							const pending = syncConflicts.get(id);
							if (!pending) return;
							const ok = await library.restoreConflictLocal(
								pending.noteId,
								pending.field,
								pending.local
							);
							if (ok) {
								syncConflicts.dismiss(id);
								if (syncConflicts.count === 0) peel.closePeel(true);
							}
						})();
					}}
					onConflictOpenNote={(noteId) => {
						library.selectNote(noteId);
						void canvas.openStickyFromTray(noteId);
					}}
				/>
			</div>
		{/if}

		{#if canvas.touchPlaceGhost}
			{@const ghostNote = library.notesById.get(canvas.touchPlaceGhost.noteId)}
			<div
				class="pointer-events-none fixed z-50 w-[180px] rounded-xl border px-3 py-2 shadow-xl"
				style="left: {canvas.touchPlaceGhost.clientX - 40}px; top: {canvas.touchPlaceGhost.clientY - 20}px; border-color: var(--mash-paper-chip-border); background: var(--mash-paper-chip);"
			>
				<div class="text-xs font-semibold" style="color: var(--mash-card-ink);">
					{ghostNote?.title ?? 'Note'}
				</div>
				<div class="mt-0.5 text-[10px]" style="color: var(--mash-card-muted);">Drop on canvas</div>
			</div>
		{/if}

		{#if library.selectionIds.length > 0 && !pdfReaderOpen}
			<div
				class="mash-selection-bar absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-2"
				class:mash-selection-bar--peel={peel.peelOpen || settingsOpen}
			>
				{#if library.bulkMenu === 'tag'}
					<div
						class="w-64 rounded-xl border p-3 shadow-xl"
						style="border-color: var(--mash-panel-border); background: var(--mash-panel); backdrop-filter: blur(10px);"
					>
						<div class="mb-2 text-[10px] font-medium tracking-wide uppercase" style="color: var(--mash-accent-bright);">
							Tag {library.selectionIds.length} note{library.selectionIds.length === 1 ? '' : 's'}
						</div>
						<input
							type="text"
							bind:value={library.bulkTagDraft}
							placeholder="new tag…"
							class="mash-focus mb-2 w-full rounded-md border bg-transparent px-2 py-1.5 text-xs outline-none"
							style="border-color: var(--mash-tray-edge); color: var(--mash-ink);"
							onkeydown={(e) => {
								if (e.key === 'Enter') library.tagSelection(library.bulkTagDraft);
								if (e.key === 'Escape') library.bulkMenu = null;
							}}
						/>
						<div class="flex max-h-28 flex-wrap gap-1 overflow-auto">
							{#each library.uniqueTags as tag}
								<button
									type="button"
									class="mash-chip mash-chip-hover rounded-full px-2 py-0.5 text-[10px]"
									onclick={() => library.tagSelection(tag)}
								>
									#{tag}
								</button>
							{/each}
						</div>
					</div>
				{:else if library.bulkMenu === 'folder'}
					<div
						class="w-64 rounded-xl border p-3 shadow-xl"
						style="border-color: var(--mash-panel-border); background: var(--mash-panel); backdrop-filter: blur(10px);"
					>
						<div class="mb-2 text-[10px] font-medium tracking-wide uppercase" style="color: var(--mash-accent-bright);">
							Move {library.selectionIds.length} to folder
						</div>
						<input
							type="text"
							bind:value={library.bulkFolderDraft}
							placeholder="new or existing folder…"
							class="mash-focus mb-2 w-full rounded-md border bg-transparent px-2 py-1.5 text-xs outline-none"
							style="border-color: var(--mash-tray-edge); color: var(--mash-ink);"
							onkeydown={(e) => {
								if (e.key === 'Enter') library.assignFolderToSelection(library.bulkFolderDraft);
								if (e.key === 'Escape') library.bulkMenu = null;
							}}
						/>
						<button
							type="button"
							class="mash-peel-meta-row rounded-md"
							onclick={() => library.assignFolderToSelection('')}
						>
							<span class="text-[11px]">No folder</span>
						</button>
						<div class="max-h-28 overflow-auto">
							{#each library.uniqueFolders as folder}
								<button
									type="button"
									class="mash-peel-meta-row"
									onclick={() => library.assignFolderToSelection(folder)}
								>
									<Folder class="h-3.5 w-3.5 shrink-0 opacity-60" />
									<span class="truncate text-[11px]">{folder}</span>
								</button>
							{/each}
						</div>
					</div>
				{:else if library.bulkMenu === 'align'}
					<div
						class="flex max-w-[min(92vw,28rem)] flex-wrap items-center justify-center gap-1 rounded-xl border p-2 shadow-xl"
						style="border-color: var(--mash-panel-border); background: var(--mash-panel); backdrop-filter: blur(10px);"
						role="toolbar"
						aria-label="Pack selected"
					>
						<button
							type="button"
							class="mash-align-btn"
							onclick={() => canvas.canvasBoard?.applyAlign('left')}
							title="Pack into a left-aligned column"
							aria-label="Pack into a left-aligned column"
						>
							<AlignLeft class="h-3.5 w-3.5" />
						</button>
						<button
							type="button"
							class="mash-align-btn"
							onclick={() => canvas.canvasBoard?.applyAlign('center')}
							title="Pack into a centered column"
							aria-label="Pack into a centered column"
						>
							<AlignCenter class="h-3.5 w-3.5" />
						</button>
						<button
							type="button"
							class="mash-align-btn"
							onclick={() => canvas.canvasBoard?.applyAlign('right')}
							title="Pack into a right-aligned column"
							aria-label="Pack into a right-aligned column"
						>
							<AlignRight class="h-3.5 w-3.5" />
						</button>
						<button
							type="button"
							class="mash-align-btn"
							onclick={() => canvas.canvasBoard?.applyAlign('top')}
							title="Pack into a top-aligned row"
							aria-label="Pack into a top-aligned row"
						>
							<AlignStartVertical class="h-3.5 w-3.5" />
						</button>
						<button
							type="button"
							class="mash-align-btn"
							onclick={() => canvas.canvasBoard?.applyAlign('middle')}
							title="Pack into a middle-aligned row"
							aria-label="Pack into a middle-aligned row"
						>
							<AlignCenterVertical class="h-3.5 w-3.5" />
						</button>
						<button
							type="button"
							class="mash-align-btn"
							onclick={() => canvas.canvasBoard?.applyAlign('bottom')}
							title="Pack into a bottom-aligned row"
							aria-label="Pack into a bottom-aligned row"
						>
							<AlignEndVertical class="h-3.5 w-3.5" />
						</button>
						{#if library.selectionIds.length >= 3}
							<button
								type="button"
								class="mash-align-btn"
								onclick={() => canvas.canvasBoard?.applyAlign('distribute-h')}
								title="Space across"
								aria-label="Space evenly horizontally"
							>
								<StretchHorizontal class="h-3.5 w-3.5" />
							</button>
							<button
								type="button"
								class="mash-align-btn"
								onclick={() => canvas.canvasBoard?.applyAlign('distribute-v')}
								title="Space down"
								aria-label="Space evenly vertically"
							>
								<StretchVertical class="h-3.5 w-3.5" />
							</button>
						{/if}
						<button
							type="button"
							class="mash-align-btn"
							onclick={() => canvas.canvasBoard?.applyAlign('stack')}
							title="Stack"
							aria-label="Stack selected"
						>
							<Layers class="h-3.5 w-3.5" />
						</button>
						<button
							type="button"
							class="mash-align-btn"
							onclick={() => canvas.canvasBoard?.applyAlign('grid')}
							title="Grid"
							aria-label="Grid selected"
						>
							<LayoutGrid class="h-3.5 w-3.5" />
						</button>
					</div>
				{/if}

				<div
					class="mash-dock flex items-center gap-1 rounded-2xl border px-2 py-1.5 shadow-xl"
					style="border-color: var(--mash-panel-border); background: var(--mash-panel); backdrop-filter: blur(10px);"
				>
					<span
						class="px-2 text-[10px] font-medium tracking-wide uppercase"
						style="color: var(--mash-accent-bright);"
					>
						{library.selectionIds.length} selected
					</span>
					<button
						type="button"
						onclick={() => void combineSelection()}
						class="mash-btn flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold"
						disabled={library.selectionIds.length < 2}
						title="Combine into one sticky — sources leave the desk until Unmash"
					>
						<Layers class="h-3.5 w-3.5" />
						Mash
					</button>
					{#if library.selectionIds.length >= 2}
						<button
							type="button"
							onclick={openSelectionInStage}
							class="mash-btn-ghost flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs"
							title="Edit the first two selected notes side by side"
						>
							<Columns2 class="h-3.5 w-3.5" />
							Split
						</button>
					{:else if editorStage.open}
						<button
							type="button"
							onclick={openBesideSelection}
							class="mash-btn-ghost flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs"
							title="Open this note in the empty half"
						>
							<Columns2 class="h-3.5 w-3.5" />
							Beside
						</button>
					{:else}
						<button
							type="button"
							onclick={() => {
								const id = library.selectedId ?? library.selectionIds[0];
								if (id) openInStage(id, 'maximize');
							}}
							class="mash-btn-ghost flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs"
							title="Open large editor"
						>
							<Columns2 class="h-3.5 w-3.5" />
							Edit
						</button>
					{/if}
					{#if library.canUnmash}
						<button
							type="button"
							onclick={() => void unmashSelection()}
							class="mash-btn-ghost flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs"
							title="Restore source notes and remove mash"
						>
							Unmash
						</button>
					{/if}
					{#if library.selectionIds.length >= 2}
						<button
							type="button"
							onclick={() => (library.bulkMenu = library.bulkMenu === 'align' ? null : 'align')}
							class="mash-btn-ghost flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs {library.bulkMenu ===
							'align'
								? 'border-[var(--mash-accent)] text-[var(--mash-accent-bright)]'
								: ''}"
							title="Pack selected into a column, row, stack, or grid"
						>
							<AlignLeft class="h-3.5 w-3.5" />
							Pack
						</button>
					{/if}
					<button
						type="button"
						onclick={() => (library.bulkMenu = library.bulkMenu === 'tag' ? null : 'tag')}
						class="mash-btn-ghost flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs {library.bulkMenu === 'tag'
							? 'border-[var(--mash-accent)] text-[var(--mash-accent-bright)]'
							: ''}"
						title="Tag selected"
					>
						<Tag class="h-3.5 w-3.5" />
						Tag
					</button>
					<button
						type="button"
						onclick={() => (library.bulkMenu = library.bulkMenu === 'folder' ? null : 'folder')}
						class="mash-btn-ghost flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs {library.bulkMenu ===
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
						onclick={() => void library.copySelection()}
						class="mash-btn-ghost flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs"
					>
						<Copy class="h-3.5 w-3.5" />
						Copy
					</button>
					<button
						type="button"
						onclick={() => library.exportSelectionMarkdown()}
						class="mash-btn-ghost flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs"
					>
						<Download class="h-3.5 w-3.5" />
						MD
					</button>
					<button
						type="button"
						onclick={() => void library.handleDelete()}
						class="mash-btn-ghost flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs hover:text-[var(--mash-danger)]"
						title="Delete selected"
					>
						<Trash2 class="h-3.5 w-3.5" />
					</button>
					<button
						type="button"
						onclick={library.clearSelection}
						class="mash-row-hover rounded-lg p-1.5 text-[var(--mash-ink-muted)] hover:text-[var(--mash-ink)]"
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
							class="mash-row-hover flex w-full items-center justify-between rounded px-3 py-2 text-left {i ===
							paletteHighlight
								? 'mash-row-active'
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
						{#each library.notes
							.filter((n: Note) => n.title
										.toLowerCase()
										.includes(paletteQuery.toLowerCase()) || n.body
										.toLowerCase()
										.includes(paletteQuery.toLowerCase()))
							.slice(0, 6) as note, j}
							<button
								onclick={() => {
									void canvas.openStickyFromTray(note.id);
									showPalette = false;
								}}
								class="mash-row-hover flex w-full items-center justify-between rounded px-3 py-1.5 text-left text-xs {j +
									paletteActions.filter((a) =>
										a.label.toLowerCase().includes(paletteQuery.toLowerCase())
									).length ===
								paletteHighlight
									? 'mash-row-active'
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
		data-testid="notes-import"
		type="file"
		accept="application/json,.json"
		class="hidden"
		onchange={(e) => void library.handleImportFile(e)}
	/>
	<input
		bind:this={pdfInputEl}
		data-testid="pdf-reader-input"
		type="file"
		accept="application/pdf,.pdf"
		class="hidden"
		onchange={(e) => {
			const input = e.currentTarget as HTMLInputElement;
			const file = input.files?.[0];
			input.value = '';
			if (file) openPdfReader(file);
		}}
	/>
	<input
		bind:this={markdownImportInputEl}
		data-testid="markdown-import"
		type="file"
		accept=".md,text/markdown"
		multiple
		webkitdirectory
		class="hidden"
		onchange={(e) => void library.handleMarkdownImport(e)}
	/>
	<input
		bind:this={syncInputEl}
		data-testid="sync-import"
		type="file"
		accept="application/json,.json"
		class="hidden"
		onchange={async (e) => {
			await library.handleSyncFile(e);
			refreshSyncHygiene();
		}}
	/>

	{#if actionToast}
		<div
			class="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg border px-3 py-1.5 text-xs shadow-lg"
			style="border-color: var(--mash-tray-edge); background: var(--mash-panel); color: var(--mash-ink);"
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

	<ShortcutsModal open={shortcutsOpen} onClose={() => (shortcutsOpen = false)} />
	{#if spacesOverviewOpen}
		<SpacesOverview
			openKeys={spaces.openKeys}
			activeKey={peel.canvasKey}
			activeItems={canvas.canvasItems}
			onClose={hideSpacesOverview}
			onSwitch={switchSpace}
			onCloseSpace={(key) => spaces.closeSpace(key)}
		/>
	{/if}
</div>
