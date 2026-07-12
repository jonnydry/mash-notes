<script lang="ts">
	import { onMount, tick } from 'svelte';
	import {
		addNoteToCanvas,
		createNote,
		createOperationRecord,
		db,
		deleteNote,
		listOperationRecords,
		replaceNoteSubset
	} from '$lib/db';
	import { addNoteToSearch, removeNoteFromSearch, searchNotes } from '$lib/search';
	import type { Note, Operation } from '$lib/types';
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
		BookOpen,
		FileDown,
		Printer,
		Bookmark,
		MoreHorizontal
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
	import SessionPanel from '$lib/components/SessionPanel.svelte';
	import PasteChoiceDialog from '$lib/components/PasteChoiceDialog.svelte';
	import { focusTrap } from '$lib/focus-trap';
	import { actionsForSurface, createActionRegistry } from '$lib/action-registry';
	import {
		shuffledSetMoves,
		sortedSetMoves,
		spreadSetMoves,
		stackedSetMoves
	} from '$lib/set-operators';
	import {
		KITCHEN_GROUPS,
		formatContentOperatorToast,
		formatLayoutOperatorToast,
		kitchenActionSubtitle,
		kitchenActionTitle,
		kitchenGroupForActionId,
		latestActiveOperation,
		operationReceiptView
	} from '$lib/operator-kitchen';
	import OperatorReceiptStrip from '$lib/components/OperatorReceiptStrip.svelte';

	import { extractWikilinks } from '$lib/markdown';
	import {
		combineNotes,
		copyText,
		exportNotesJson,
		exportNotesMarkdown,
		printSequenceAsPdf,
		slugifyFilename
	} from '$lib/mash';
	import {
		createFinishSnapshot,
		noteIdsForFinishScope,
		notesForFinishScope,
		type FinishDraft,
		type FinishExportKind,
		type FinishScope,
		type FinishSnapshot
	} from '$lib/finish-model';
	import { clearCanvasViewport } from '$lib/viewport';
	import { clearDismissedForCanvas } from '$lib/canvas-dismiss';
	import { findBacklinks, findOutgoingNotes } from '$lib/links';
	import { downloadSyncBundle } from '$lib/sync-file';
	import { readSyncHygiene, recordSyncExport, shouldRemindSyncBackup } from '$lib/sync-hygiene';
	import { loadSnapPref, saveSnapPref } from '$lib/canvas-geom';
	import { COLLAPSED_CARD, createCanvasSession } from '$lib/stores/canvas-session.svelte';
	import { createNoteLibrary, filterNotes, filterPeelNotes } from '$lib/stores/note-library.svelte';
	import {
		filterNotesByPeelScope,
		peelScopeCounts,
		peelScopeSubtitle,
		rankSearchIdsForPeel,
		sortNotesForPeel,
		type PeelScopeFilter
	} from '$lib/peel-hygiene';
	import {
		dismissTryAMash,
		isTryAMashDismissed,
		shouldOfferTryAMash,
		shouldStayOnDeskAfterMash,
		tryAMashAfterMashToast,
		tryAMashDrafts,
		tryAMashSuccessToast
	} from '$lib/try-a-mash';
	import { createPeelNav, windowPeelNotes } from '$lib/stores/peel-nav.svelte';
	import { createOpenSpaces } from '$lib/stores/spaces.svelte';
	import { theme } from '$lib/stores/theme.svelte';
	import { syncConflicts } from '$lib/stores/sync-conflicts.svelte';
	import { createEditorStage, type SnapZone } from '$lib/stores/editor-stage.svelte';
	import { createSessionManager } from '$lib/stores/sessions.svelte';
	import { sessionLifecycleLabel } from '$lib/session-lifecycle';
	import type { PeelConflictRow } from '$lib/components/PeelScanner.svelte';
	import { shouldShowCanvasEmptyState } from '$lib/canvas-empty-state';
	import { detectJsonImportKind, splitExternalImportFiles } from '$lib/external-file-drop';
	import {
		normalizePdfExcerpt,
		pdfClippingTitle,
		pdfRegionClippingBody,
		pdfRegionClippingTitle,
		type PdfClipPayload,
		type PdfClipping
	} from '$lib/pdf-clipping';
	import {
		docxClippingTitle,
		normalizeDocxExcerpt,
		type DocxClipPayload,
		type DocxClipping
	} from '$lib/docx-clipping';
	import {
		htmlClippingTitle,
		normalizeHtmlExcerpt,
		type HtmlClipPayload,
		type HtmlClipping
	} from '$lib/html-clipping';
	import {
		analyzePastedText,
		draftsFromPastedText,
		type PasteAnalysis,
		type PasteSplitMode
	} from '$lib/paste-cards';
	import {
		DESK_IMAGE_MAX_PER_ACTION,
		clipboardImageBlob,
		imageNoteBody,
		imageNoteSource,
		prepareDeskImage
	} from '$lib/desk-image';
	import { draftsFromGif, inspectGif, isGifFile, type GifExplodeMode } from '$lib/gif-explode';
	import GifExplodeDialog from '$lib/components/GifExplodeDialog.svelte';
	import { draftsFromUrlOnlyText, URL_SOURCE_MAX_PER_PASTE } from '$lib/url-source';
	import { keepSelectionToast, keepableNoteIds } from '$lib/keep-selection';
	import {
		splitNoteFragments,
		type ContentSplitMode,
		type SplitFragment
	} from '$lib/split-content';
	import {
		inspectStorage,
		PERSISTENCE_PROMPTED_KEY,
		requestPersistentStorage,
		type StorageHealth
	} from '$lib/storage-health';

	let actionToast = $state('');
	let srAnnouncement = $state('');
	let priorityAnnouncementUntil = 0;
	let deferredAnnouncementTimer: ReturnType<typeof setTimeout> | null = null;
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
	let sessionPanelOpen = $state(false);
	let sessionPanelView = $state<'desks' | 'finish'>('desks');
	let finishSnapshot = $state<FinishSnapshot | null>(null);
	let pasteAnalysis = $state<PasteAnalysis | null>(null);
	let pasteDialogOpen = $state(false);
	let gifExplodePending = $state<{
		blob: Blob;
		fileName: string;
		frameCount: number;
		origin?: { x: number; y: number };
		caption?: string;
	} | null>(null);
	const gifExplodeDialogOpen = $derived(Boolean(gifExplodePending));
	let spacesOverviewIgnoreUntil = 0;
	/** Sync from localStorage at init (ssr=false) so CanvasBoard never paints Free first. */
	let snapEnabled = $state(loadSnapPref());
	let searchDropdownOpen = $state(false);
	let searchHighlight = $state(0);
	let searchWrapEl = $state<HTMLDivElement | null>(null);
	let syncHygiene = $state(readSyncHygiene());
	let storageHealth = $state<StorageHealth | null>(null);
	let syncBackupReminded = false;

	function refreshSyncHygiene() {
		syncHygiene = readSyncHygiene();
	}

	async function exportSyncBundle() {
		await downloadSyncBundle(
			library.notes,
			'mash-sync-bundle.json',
			sessionManager.activeSession?.id
		);
		recordSyncExport();
		refreshSyncHygiene();
		flashToast('Exported sync bundle (notes + desk + result history)');
	}

	$effect(() => {
		if (!showPalette) return;
		paletteHighlight = 0;
		void tick().then(() => paletteInput?.focus());
	});

	$effect(() => {
		const query = paletteQuery;
		if (query === undefined) return;
		paletteHighlight = 0;
	});

	let importInputEl: HTMLInputElement | undefined = $state();
	let markdownImportInputEl: HTMLInputElement | undefined = $state();
	let syncInputEl: HTMLInputElement | undefined = $state();
	let pdfInputEl: HTMLInputElement | undefined = $state();
	let docxInputEl: HTMLInputElement | undefined = $state();
	let htmlInputEl: HTMLInputElement | undefined = $state();
	let imageInputEl: HTMLInputElement | undefined = $state();
	let pdfReaderFile: File | null = $state(null);
	let pdfReaderOpen = $state(false);
	let pdfReaderView = $state({ page: 1, zoom: 1 });
	let LazyPdfReader = $state<(typeof import('$lib/components/PdfReader.svelte'))['default'] | null>(
		null
	);
	let pdfReaderModuleLoading = $state(false);
	let pdfClippings = $state<PdfClipping[]>([]);
	let docxReaderFile: File | null = $state(null);
	let docxReaderOpen = $state(false);
	let LazyDocxReader = $state<
		(typeof import('$lib/components/DocxReader.svelte'))['default'] | null
	>(null);
	let docxReaderModuleLoading = $state(false);
	let docxClippings = $state<DocxClipping[]>([]);
	let htmlReaderFile: File | null = $state(null);
	let htmlReaderOpen = $state(false);
	let LazyHtmlReader = $state<
		(typeof import('$lib/components/HtmlReader.svelte'))['default'] | null
	>(null);
	let htmlReaderModuleLoading = $state(false);
	let htmlClippings = $state<HtmlClipping[]>([]);
	const documentReaderOpen = $derived(pdfReaderOpen || docxReaderOpen || htmlReaderOpen);

	function flashToast(msg: string, ms = 1600) {
		actionToast = msg;
		priorityAnnouncementUntil = Date.now() + 500;
		if (deferredAnnouncementTimer) {
			clearTimeout(deferredAnnouncementTimer);
			deferredAnnouncementTimer = null;
		}
		srAnnouncement = '';
		if (toastTimer) clearTimeout(toastTimer);
		toastTimer = setTimeout(() => {
			actionToast = '';
		}, ms);
	}

	function announce(message: string) {
		if (Date.now() < priorityAnnouncementUntil) {
			if (deferredAnnouncementTimer) clearTimeout(deferredAnnouncementTimer);
			deferredAnnouncementTimer = setTimeout(
				() => {
					deferredAnnouncementTimer = null;
					announce(message);
				},
				priorityAnnouncementUntil - Date.now() + 20
			);
			return;
		}
		srAnnouncement = '';
		queueMicrotask(() => {
			srAnnouncement = message;
		});
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
	const sessionManager = createSessionManager();
	let operationHistory = $state<Operation[]>([]);
	let operationHistorySeq = 0;

	async function refreshOperationHistory(sessionId = sessionManager.activeSession?.id) {
		const seq = ++operationHistorySeq;
		if (!sessionId) {
			operationHistory = [];
			return;
		}
		const operations = await listOperationRecords(sessionId);
		if (seq === operationHistorySeq) operationHistory = operations;
	}

	$effect(() => {
		const sessionId = sessionManager.activeSession?.id;
		void refreshOperationHistory(sessionId);
	});

	async function refreshStorageHealth(cleanupExpired = true): Promise<StorageHealth> {
		let health = await inspectStorage(
			typeof navigator !== 'undefined' ? navigator.storage : undefined
		);
		if (cleanupExpired && health.pressure === 'critical') {
			const removed = await sessionManager.purgePermanentlyExpired();
			if (removed > 0) {
				health = await inspectStorage(navigator.storage);
				flashToast(
					`Freed ${removed} expired scratch desk${removed === 1 ? '' : 's'} · kept work was untouched`
				);
			}
		}
		storageHealth = health;
		return health;
	}

	$effect(() => {
		if (sessionPanelOpen) void refreshStorageHealth();
	});

	async function offerPersistentStorageOnce() {
		if (typeof localStorage === 'undefined' || typeof navigator === 'undefined') return;
		if (localStorage.getItem(PERSISTENCE_PROMPTED_KEY) === '1') return;
		const health = await refreshStorageHealth(false);
		if (!health.supported || health.persisted === true || !navigator.storage?.persist) return;
		localStorage.setItem(PERSISTENCE_PROMPTED_KEY, '1');
		askConfirm({
			title: 'Help protect kept desks?',
			message:
				'Kept desks remain only on this device. MASH can ask your browser not to clear them during automatic storage cleanup. This does not upload or sync anything.',
			confirmLabel: 'Request protection',
			action: async () => {
				const granted = await requestPersistentStorage(navigator.storage);
				await refreshStorageHealth(false);
				flashToast(
					granted
						? 'Browser protection enabled for local MASH data'
						: 'Browser kept its normal storage policy · your desk is still kept locally'
				);
			}
		});
	}

	function activeNoteOwnership() {
		const active = sessionManager.activeSession;
		return {
			sessionId: active?.id,
			scope: active?.mode === 'kept' ? ('kept' as const) : ('session' as const),
			...(active?.mode === 'kept' ? { keptAt: Date.now() } : {})
		};
	}

	const library = createNoteLibrary({
		flashToast,
		askConfirm,
		getActiveCanvasId: () => canvasHolder.session?.activeCanvas?.id ?? null,
		getActiveSessionId: () => sessionManager.activeSession?.id ?? null,
		getActiveSessionMode: () => sessionManager.activeSession?.mode ?? 'scratch',
		shouldSeedWelcome: () => sessionManager.shouldSeedWelcome(),
		onMeaningfulActivity: () => void sessionManager.recordMeaningfulActivity(),
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
			const sessionId = sessionManager.activeSession?.id;
			const folderCanvas = sessionId
				? await db.canvases.where('[sessionId+folder]').equals([sessionId, folder]).first()
				: await db.canvases.where('folder').equals(folder).first();
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
			await refreshOperationHistory();
		},
		onSyncConflicts: (conflicts) => {
			syncConflicts.setFromImport(conflicts);
			const n = conflicts.length;
			flashToast(`${n} conflict${n === 1 ? '' : 's'} — review in Conflicts peel`, 3600);
			settingsOpen = false;
			peel.openPeel('conflicts');
		},
		onNoteEdited: (noteId) => {
			syncConflicts.dismissNote(noteId);
		}
	});

	let selectionAnnouncementsReady = false;
	let lastAnnouncedSelectionKey = '';
	$effect(() => {
		const ids = library.selectionIds;
		const key = ids
			.map((id) => `${id}:${library.notesById.get(id)?.title?.trim() || 'Untitled note'}`)
			.join('|');
		if (!selectionAnnouncementsReady) {
			selectionAnnouncementsReady = true;
			lastAnnouncedSelectionKey = key;
			return;
		}
		if (key === lastAnnouncedSelectionKey) return;
		lastAnnouncedSelectionKey = key;
		if (ids.length === 0) {
			announce('Selection cleared');
			return;
		}
		if (ids.length === 1) {
			const title = library.notesById.get(ids[0])?.title?.trim() || 'Untitled note';
			announce(`${title} selected`);
			return;
		}
		announce(`${ids.length} notes selected`);
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

	function openSessionPanel(view: 'desks' | 'finish' = 'desks') {
		if (view === 'finish' && sessionManager.activeSession) {
			finishSnapshot = createFinishSnapshot({
				sessionId: sessionManager.activeSession.id,
				canvasId: canvas.activeCanvas?.id ?? null,
				notes: library.notes,
				canvasItems: canvas.canvasItems,
				selectedNoteIds: library.selectionIds,
				operations: operationHistory
			});
		}
		sessionPanelView = view;
		sessionPanelOpen = true;
		spacesOverviewOpen = false;
		settingsOpen = false;
		peel.closePeel(true);
	}

	async function prepareSessionSwitch() {
		await library.flushPendingSaveAsync();
		library.clearSelection();
		editorStage.dismissAll();
		canvas.expandedNoteId = null;
		peel.clearFilter();
	}

	async function activateSession(id: string) {
		await prepareSessionSwitch();
		await sessionManager.switchTo(id);
		await library.loadNotes();
		await canvas.loadContextCanvas(peel.canvasKey);
		sessionPanelOpen = false;
		if (sessionManager.activeSession) {
			flashToast(
				`Opened ${sessionManager.activeSession.title}. ${sessionLifecycleLabel(sessionManager.activeSession, Date.now())}`
			);
		}
	}

	async function createScratchSession() {
		await prepareSessionSwitch();
		const created = await sessionManager.createScratch();
		await library.loadNotes();
		await canvas.loadContextCanvas(peel.canvasKey, created.id);
		sessionPanelOpen = false;
		flashToast('New scratch desk — clears after inactivity');
	}

	async function runFinishExport(kind: FinishExportKind, scope: FinishScope) {
		const snapshot = finishSnapshot;
		if (!snapshot) return { ok: false, message: 'This desk is not ready to export.' };
		await library.flushPendingSaveAsync();
		const notes = notesForFinishScope(snapshot, scope, library.notesById);
		if (notes.length === 0) return { ok: false, message: 'There are no cards in this takeaway.' };
		const countLabel = `${notes.length} card${notes.length === 1 ? '' : 's'}`;

		try {
			if (kind === 'copy-markdown') {
				let copied = false;
				try {
					copied = await copyText(combineNotes(notes));
				} catch {
					copied = false;
				}
				return copied
					? { ok: true, message: `Copied ${countLabel} as Markdown.` }
					: { ok: false, message: 'Clipboard unavailable. Download Markdown instead.' };
			}
			if (kind === 'download-markdown') {
				const deskName = slugifyFilename(sessionManager.activeSession?.title ?? 'mash-desk');
				exportNotesMarkdown(notes, `${deskName}-${scope}.md`);
				return { ok: true, message: `Downloaded ${countLabel} as Markdown.` };
			}
			if (kind === 'pdf') {
				const opened = printSequenceAsPdf(
					notes,
					`${sessionManager.activeSession?.title ?? 'MASH desk'} · ${countLabel}`
				);
				return opened
					? { ok: true, message: `Opened ${countLabel} for printing or PDF.` }
					: { ok: false, message: 'Could not prepare the printable PDF.' };
			}
			if (kind === 'board-image') {
				const { loadBoardImageExporter } = await import('$lib/lazy-board-image');
				const { downloadBoardImage } = await loadBoardImageExporter();
				const result = await downloadBoardImage({
					noteIds: notes.map((note) => note.id),
					notesById: library.notesById,
					items: canvas.canvasItems,
					edges: canvas.canvasEdges,
					theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
					filename: `${slugifyFilename(sessionManager.activeSession?.title ?? 'mash-desk')}-${scope}-board.png`
				});
				return {
					ok: true,
					message: `Downloaded ${result.cardCount} card${result.cardCount === 1 ? '' : 's'} as a ${result.width} × ${result.height} PNG${result.downscaled ? ' (safely downscaled)' : ''}.`
				};
			}

			await exportSyncBundle();
			return {
				ok: true,
				message: `Downloaded the whole desk with ${notes.length} card${notes.length === 1 ? '' : 's'} and result history.`
			};
		} catch (error) {
			console.error('Finish export failed', error);
			return { ok: false, message: 'That export did not finish. Your desk is unchanged.' };
		}
	}

	async function commitFinishNow(draft: FinishDraft) {
		const snapshot = finishSnapshot;
		const session = sessionManager.activeSession;
		if (!snapshot || !session || snapshot.sessionId !== session.id) {
			return { ok: false, message: 'This desk changed. Reopen Finish and try again.' };
		}
		const mutatesStorage = draft.keepTakeaway || draft.disposition !== 'leave';
		await library.flushPendingSaveAsync();
		if (mutatesStorage && library.writeError) {
			return {
				ok: false,
				message: 'Mash could not update local storage. Copy or download your work, then retry.'
			};
		}

		let promotedCount = 0;
		if (draft.keepTakeaway && draft.disposition !== 'keep-desk') {
			const noteIds = noteIdsForFinishScope(snapshot, draft.scope);
			const promoted = await sessionManager.keepTakeaway(noteIds);
			promotedCount = promoted.length;
			library.applyPromotedNotes(promoted);
		}

		if (draft.disposition === 'keep-desk') {
			const keptAt = Date.now();
			const kept = await sessionManager.keepActive(keptAt);
			if (!kept) return { ok: false, message: 'Mash could not keep this desk.' };
			library.notes = library.notes.map((note) => ({
				...note,
				scope: 'kept',
				keptAt: note.keptAt ?? keptAt
			}));
			sessionPanelOpen = false;
			flashToast(`Kept “${kept.title}” on this device`, 3600);
			await offerPersistentStorageOnce();
			return { ok: true, message: `Kept the entire desk on this device.` };
		}

		if (draft.disposition === 'clear') {
			const title = session.title;
			await prepareSessionSwitch();
			const created = await sessionManager.clearActive();
			await library.loadNotes();
			if (created) await canvas.loadContextCanvas(peel.canvasKey, created.id);
			sessionPanelOpen = false;
			const keptPart =
				promotedCount > 0 ? `Kept ${promotedCount} card${promotedCount === 1 ? '' : 's'} · ` : '';
			flashToast(`${keptPart}“${title}” moved to Recently cleared for 7 days`, 4600);
			return { ok: true, message: `${keptPart}${title} is recoverable for 7 days.` };
		}

		sessionPanelOpen = false;
		const lifecycle = sessionLifecycleLabel(session, Date.now());
		flashToast(
			promotedCount > 0
				? `Kept ${promotedCount} card${promotedCount === 1 ? '' : 's'} · ${lifecycle}`
				: lifecycle,
			3600
		);
		return {
			ok: true,
			message:
				promotedCount > 0
					? `Kept ${promotedCount} card${promotedCount === 1 ? '' : 's'}; the desk remains scratch.`
					: `The desk remains unchanged. ${lifecycle}.`
		};
	}

	async function runFinishCommit(draft: FinishDraft) {
		if (draft.disposition !== 'clear') return commitFinishNow(draft);
		const snapshot = finishSnapshot;
		const title = sessionManager.activeSession?.title ?? 'this desk';
		const takeawayCount = snapshot ? noteIdsForFinishScope(snapshot, draft.scope).length : 0;
		const keepMessage = draft.keepTakeaway
			? ` Keep ${takeawayCount} takeaway card${takeawayCount === 1 ? '' : 's'} on this device.`
			: '';
		askConfirm({
			title: 'Clear this desk?',
			message: `“${title}” will leave your active desks.${keepMessage} You can restore the desk from Recently cleared for 7 days.`,
			confirmLabel: draft.keepTakeaway ? 'Keep takeaway and clear' : 'Clear desk',
			danger: true,
			action: async () => {
				await commitFinishNow(draft);
			}
		});
		return { ok: true, message: 'Review the clear confirmation.' };
	}

	async function restoreSession(id: string) {
		await prepareSessionSwitch();
		const restored = await sessionManager.restore(id);
		if (!restored) return;
		await library.loadNotes();
		await canvas.loadContextCanvas(peel.canvasKey, restored.id);
		sessionPanelOpen = false;
		flashToast('Scratch desk restored');
	}

	function selectedCanvasItems() {
		const selected = new Set(library.selectionIds);
		return canvas.canvasItems.filter((item) => selected.has(item.noteId));
	}

	async function applyLayoutOperator(
		actionId: string,
		label: string,
		moves: Array<{ itemId: string; x: number; y: number }>
	) {
		const byId = new Map(canvas.canvasItems.map((item) => [item.id, item]));
		const before = moves
			.map((move) => byId.get(move.itemId))
			.filter((item): item is NonNullable<typeof item> => Boolean(item))
			.map((item) => ({ itemId: item.id, x: item.x, y: item.y }));
		await canvas.handleCanvasMoveEnd(moves, before, {
			label,
			actionId,
			affectedNoteIds: library.selectionIds
		});
		library.bulkMenu = null;
		flashToast(formatLayoutOperatorToast(label));
	}

	async function sortSelection(mode: 'title' | 'created') {
		const label = mode === 'title' ? 'Sort by title' : 'Sort by creation time';
		await applyLayoutOperator(
			`sort-selection-${mode}`,
			label,
			sortedSetMoves(selectedCanvasItems(), library.notesById, mode)
		);
	}

	async function shuffleSelection() {
		await applyLayoutOperator(
			'shuffle-selection',
			'Shuffle',
			shuffledSetMoves(selectedCanvasItems())
		);
	}

	async function stackSelection() {
		await applyLayoutOperator('stack-selection', 'Stack', stackedSetMoves(selectedCanvasItems()));
	}

	async function spreadSelection() {
		await applyLayoutOperator('spread-selection', 'Spread', spreadSetMoves(selectedCanvasItems()));
	}

	async function sequenceSelection() {
		const result = await canvas.sequenceCanvasSelection(library.selectionIds);
		library.bulkMenu = null;
		if (result.sequenced < 2) {
			flashToast('Could not sequence these cards');
			return;
		}
		const label =
			result.replacedLinks > 0
				? `Sequenced ${result.sequenced} · replaced ${result.replacedLinks} prior link${result.replacedLinks === 1 ? '' : 's'}`
				: `Sequenced ${result.sequenced} cards`;
		flashToast(formatLayoutOperatorToast(label));
	}

	async function deduplicateSelection() {
		const result = await canvas.deduplicateCanvasSelection(library.selectionIds, library.notesById);
		library.bulkMenu = null;
		if (result.removed === 0) {
			flashToast('No duplicate cards found');
			return;
		}
		library.selectionIds = result.keepNoteIds;
		library.selectedId = result.keepNoteIds[0] ?? null;
		flashToast(
			`Removed ${result.removed} duplicate card${result.removed === 1 ? '' : 's'} — notes remain in the library`
		);
	}

	const keepableSelectionIds = $derived(
		keepableNoteIds(library.selectionIds, library.notesById)
	);

	/** Promote selected scratch cards to durable kept notes without finishing the desk. */
	async function keepSelection() {
		await library.flushPendingSaveAsync();
		if (library.writeError) {
			flashToast('Mash could not update local storage. Retry after saves finish.');
			return;
		}
		const ids = keepableNoteIds(library.selectionIds, library.notesById);
		if (ids.length === 0) {
			flashToast(keepSelectionToast(0));
			return;
		}
		const promoted = await sessionManager.keepTakeaway(ids);
		library.applyPromotedNotes(promoted);
		void sessionManager.recordMeaningfulActivity();
		library.bulkMenu = null;
		if (promoted.length > 0) await offerPersistentStorageOnce();
		flashToast(keepSelectionToast(promoted.length));
	}

	function splitCandidate(
		mode: ContentSplitMode
	): { note: Note; fragments: SplitFragment[] } | null {
		const items = selectedCanvasItems();
		if (items.length !== 1 || library.selectionIds.length !== 1) return null;
		const note = library.notesById.get(items[0]!.noteId);
		if (!note) return null;
		const fragments = splitNoteFragments(note, mode);
		return fragments.length >= 2 ? { note, fragments } : null;
	}

	async function splitSelection(mode: ContentSplitMode) {
		const candidate = splitCandidate(mode);
		const sessionId = sessionManager.activeSession?.id;
		if (!candidate || !sessionId) {
			flashToast(`This card does not contain multiple ${mode}`);
			return;
		}
		const operation = await createOperationRecord({
			sessionId,
			type: `split-${mode}`,
			inputNoteIds: [candidate.note.id],
			outputNoteIds: [],
			payload: { mode }
		});
		const outputs: Note[] = [];
		try {
			for (const fragment of candidate.fragments) {
				outputs.push(
					await createNote({
						...activeNoteOwnership(),
						title: fragment.title,
						body: fragment.body,
						folder: candidate.note.folder,
						tags: [...new Set([...candidate.note.tags, 'split'])],
						links: extractWikilinks(fragment.body),
						mashedFrom: [candidate.note.id],
						operationId: operation.id,
						pinned: candidate.note.pinned
					})
				);
			}
			await db.operations.update(operation.id, { outputNoteIds: outputs.map((note) => note.id) });
			const applied = await canvas.splitCanvasItem(candidate.note.id, outputs, operation.id);
			if (!applied) throw new Error('Canvas split was not applied');
			library.adoptNotes(outputs);
			library.bulkMenu = null;
			await refreshOperationHistory();
			flashToast(formatContentOperatorToast(`Split by ${mode}`, 1, outputs.length));
		} catch (error) {
			console.error('Failed to split note', error);
			await replaceNoteSubset(
				outputs.map((note) => note.id),
				[]
			);
			await db.operations.delete(operation.id);
			flashToast('Could not split this card');
		}
	}

	async function changeRetentionDays(days: number) {
		await sessionManager.setRetentionDays(days);
		flashToast(`Scratch desks now clear after ${days} day${days === 1 ? '' : 's'} of inactivity`);
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
		getSessionId: () => sessionManager.activeSession?.id ?? null,
		onMeaningfulActivity: () => void sessionManager.recordMeaningfulActivity(),
		onOperationChanged: () => refreshOperationHistory(),
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
		applyNoteReceipt: (notesBefore, notesAfter, direction) =>
			library.applyNoteReceipt(notesBefore, notesAfter, direction),
		openNoteInStage: (noteId, zone) => {
			openInStage(noteId, zone ?? 'maximize');
		}
	});
	canvasHolder.session = canvas;

	async function ensurePdfReaderModule() {
		if (LazyPdfReader || pdfReaderModuleLoading) return;
		pdfReaderModuleLoading = true;
		try {
			const { loadPdfReader } = await import('$lib/lazy-pdf-reader');
			LazyPdfReader = await loadPdfReader();
		} catch (error) {
			console.error('Failed to load PDF tools', error);
			pdfReaderOpen = false;
			flashToast('PDF tools could not be loaded. Check your connection and try again.');
		} finally {
			pdfReaderModuleLoading = false;
		}
	}

	async function ensureDocxReaderModule() {
		if (LazyDocxReader || docxReaderModuleLoading) return;
		docxReaderModuleLoading = true;
		try {
			const { loadDocxReader } = await import('$lib/lazy-docx-reader');
			LazyDocxReader = await loadDocxReader();
		} catch (error) {
			console.error('Failed to load Word document tools', error);
			docxReaderOpen = false;
			flashToast('Couldn’t load Word document tools', 3600);
		} finally {
			docxReaderModuleLoading = false;
		}
	}

	async function ensureHtmlReaderModule() {
		if (LazyHtmlReader || htmlReaderModuleLoading) return;
		htmlReaderModuleLoading = true;
		try {
			const { loadHtmlReader } = await import('$lib/lazy-html-reader');
			LazyHtmlReader = await loadHtmlReader();
		} catch (error) {
			console.error('Failed to load HTML document tools', error);
			htmlReaderOpen = false;
			flashToast('Couldn’t load HTML document tools', 3600);
		} finally {
			htmlReaderModuleLoading = false;
		}
	}

	function openPdfReader(file: File) {
		pdfReaderFile = file;
		pdfReaderOpen = true;
		docxReaderOpen = false;
		htmlReaderOpen = false;
		pdfReaderView = { page: 1, zoom: 1 };
		pdfClippings = [];
		showPalette = false;
		settingsOpen = false;
		peel.closePeel(true);
		library.clearSelection();
		if (canvas.expandedNoteId) canvas.collapseSticky();
		if (editorStage.open) editorStage.dismissAll();
		void ensurePdfReaderModule();
	}

	function openDocxReader(file: File) {
		docxReaderFile = file;
		docxReaderOpen = true;
		pdfReaderOpen = false;
		htmlReaderOpen = false;
		docxClippings = [];
		showPalette = false;
		settingsOpen = false;
		peel.closePeel(true);
		library.clearSelection();
		if (canvas.expandedNoteId) canvas.collapseSticky();
		if (editorStage.open) editorStage.dismissAll();
		void ensureDocxReaderModule();
	}

	function openHtmlReader(file: File) {
		htmlReaderFile = file;
		htmlReaderOpen = true;
		pdfReaderOpen = false;
		docxReaderOpen = false;
		htmlClippings = [];
		showPalette = false;
		settingsOpen = false;
		peel.closePeel(true);
		library.clearSelection();
		if (canvas.expandedNoteId) canvas.collapseSticky();
		if (editorStage.open) editorStage.dismissAll();
		void ensureHtmlReaderModule();
	}

	function resumePdfReader() {
		if (!pdfReaderFile) return;
		pdfReaderOpen = true;
		docxReaderOpen = false;
		htmlReaderOpen = false;
		settingsOpen = false;
		peel.closePeel(true);
		library.clearSelection();
		if (canvas.expandedNoteId) canvas.collapseSticky();
		if (editorStage.open) editorStage.dismissAll();
		void ensurePdfReaderModule();
	}

	function resumeDocxReader() {
		if (!docxReaderFile) return;
		docxReaderOpen = true;
		pdfReaderOpen = false;
		htmlReaderOpen = false;
		settingsOpen = false;
		peel.closePeel(true);
		library.clearSelection();
		if (canvas.expandedNoteId) canvas.collapseSticky();
		if (editorStage.open) editorStage.dismissAll();
		void ensureDocxReaderModule();
	}

	function resumeHtmlReader() {
		if (!htmlReaderFile) return;
		htmlReaderOpen = true;
		pdfReaderOpen = false;
		docxReaderOpen = false;
		settingsOpen = false;
		peel.closePeel(true);
		library.clearSelection();
		if (canvas.expandedNoteId) canvas.collapseSticky();
		if (editorStage.open) editorStage.dismissAll();
		void ensureHtmlReaderModule();
	}

	function hidePdfReader() {
		pdfReaderOpen = false;
	}

	function hideDocxReader() {
		docxReaderOpen = false;
	}

	function hideHtmlReader() {
		htmlReaderOpen = false;
	}

	async function savePdfClipping(excerpt: PdfClipPayload) {
		if (!pdfReaderFile) return;
		if (excerpt.imageDataUrl) {
			const title = pdfRegionClippingTitle(pdfReaderFile.name, excerpt.page);
			const body = pdfRegionClippingBody(excerpt.imageDataUrl, pdfReaderFile.name, excerpt.page);
			const note = await createNote({
				...activeNoteOwnership(),
				title,
				body,
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
				{
					id: crypto.randomUUID(),
					noteId: note.id,
					text: title,
					page: excerpt.page,
					imageDataUrl: excerpt.imageDataUrl
				}
			];
			flashToast(`Saved region from page ${excerpt.page}`);
			return;
		}

		const text = normalizePdfExcerpt(excerpt.text ?? '');
		if (!text) return;
		const note = await createNote({
			...activeNoteOwnership(),
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

	async function saveDocxClipping(excerpt: DocxClipPayload) {
		if (!docxReaderFile) return;
		const text = normalizeDocxExcerpt(excerpt.text ?? '');
		if (!text) return;
		const note = await createNote({
			...activeNoteOwnership(),
			title: docxClippingTitle(text),
			body: text,
			folder: peel.canvasFolder,
			tags: ['docx-clipping'],
			links: [],
			source: {
				kind: 'docx',
				title: docxReaderFile.name
			}
		});
		addNoteToSearch(note);
		library.notes = [note, ...library.notes];
		docxClippings = [
			...docxClippings,
			{ id: crypto.randomUUID(), noteId: note.id, text }
		];
		flashToast('Saved excerpt from Word document');
	}

	async function saveHtmlClipping(excerpt: HtmlClipPayload) {
		if (!htmlReaderFile) return;
		const text = normalizeHtmlExcerpt(excerpt.text ?? '');
		if (!text) return;
		const note = await createNote({
			...activeNoteOwnership(),
			title: htmlClippingTitle(text),
			body: text,
			folder: peel.canvasFolder,
			tags: ['html-clipping'],
			links: [],
			source: {
				kind: 'html',
				title: htmlReaderFile.name
			}
		});
		addNoteToSearch(note);
		library.notes = [note, ...library.notes];
		htmlClippings = [
			...htmlClippings,
			{ id: crypto.randomUUID(), noteId: note.id, text }
		];
		flashToast('Saved excerpt from HTML document');
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

	async function openDocxClippingsOnCanvas(noteIds: string[]) {
		if (noteIds.length === 0) return;
		const spawn = canvas.canvasBoard?.getSpawnPoint(COLLAPSED_CARD, canvas.canvasItems.length) ?? {
			x: 80,
			y: 80
		};
		docxReaderOpen = false;
		await tick();
		await canvas.handleDropNotes(noteIds, spawn.x, spawn.y);
		flashToast(`Opened ${noteIds.length} clipping${noteIds.length === 1 ? '' : 's'} on canvas`);
	}

	async function openHtmlClippingsOnCanvas(noteIds: string[]) {
		if (noteIds.length === 0) return;
		const spawn = canvas.canvasBoard?.getSpawnPoint(COLLAPSED_CARD, canvas.canvasItems.length) ?? {
			x: 80,
			y: 80
		};
		htmlReaderOpen = false;
		await tick();
		await canvas.handleDropNotes(noteIds, spawn.x, spawn.y);
		flashToast(`Opened ${noteIds.length} clipping${noteIds.length === 1 ? '' : 's'} on canvas`);
	}

	async function placeNoteDraftsOnDesk(
		drafts: Array<{ title: string; body: string; source?: Note['source']; tags?: string[] }>,
		origin?: { x: number; y: number }
	): Promise<Note[]> {
		if (!canvas.activeCanvas) {
			flashToast('Desk is still getting ready');
			return [];
		}
		if (drafts.length === 0) return [];
		const spawn =
			origin ??
			canvas.canvasBoard?.getSpawnPoint(COLLAPSED_CARD, canvas.canvasItems.length) ?? {
				x: 80,
				y: 80
			};
		const columns = Math.min(3, Math.max(1, drafts.length));
		const createdNotes: Note[] = [];
		const placedIds: string[] = [];
		for (let index = 0; index < drafts.length; index++) {
			const draft = drafts[index]!;
			const note = await createNote({
				...activeNoteOwnership(),
				title: draft.title,
				body: draft.body,
				folder: peel.canvasFolder,
				tags: draft.tags ?? [],
				links: extractWikilinks(draft.body),
				...(draft.source ? { source: draft.source } : {})
			});
			addNoteToSearch(note);
			createdNotes.push(note);
			const item = await addNoteToCanvas(canvas.activeCanvas.id, note.id, {
				x: spawn.x + (index % columns) * (COLLAPSED_CARD.w + 24),
				y: spawn.y + Math.floor(index / columns) * (COLLAPSED_CARD.h + 24),
				w: COLLAPSED_CARD.w,
				h: COLLAPSED_CARD.h
			});
			placedIds.push(item.id);
		}
		library.notes = [...createdNotes, ...library.notes];
		await canvas.refreshCanvasItems();
		library.selectionIds = createdNotes.map((note) => note.id);
		library.selectedId = createdNotes[0]?.id ?? null;
		canvas.settlingIds = new Set(placedIds);
		setTimeout(() => {
			canvas.settlingIds = new Set();
		}, 320);
		canvas.canvasBoard?.ensureNoteVisible(createdNotes[0]!.id);
		void sessionManager.recordMeaningfulActivity();
		return createdNotes;
	}

	async function placeGifAsDrafts(
		blob: Blob,
		mode: GifExplodeMode,
		opts: { fileName: string; origin?: { x: number; y: number }; caption?: string }
	): Promise<number> {
		const result = await draftsFromGif(blob, mode, {
			fileName: opts.fileName,
			caption: opts.caption
		});
		if (!result.ok) {
			if (result.error === 'too-large') {
				flashToast('Image too large to import (max 20 MB)', 3200);
			} else {
				flashToast("Couldn't explode that GIF — try another file", 3200);
			}
			return 0;
		}
		const notes = await placeNoteDraftsOnDesk(result.drafts, opts.origin);
		if (notes.length === 0) return 0;
		const parts: string[] = [];
		if (mode === 'still') {
			parts.push('Added 1 image card');
		} else {
			parts.push(
				notes.length === 1
					? 'Exploded 1 frame'
					: `Exploded ${notes.length} frames`
			);
			if (result.sampled) {
				parts.push(`sampled from ${result.frameCount}`);
			}
		}
		flashToast(parts.join(' · '), 3600);
		return notes.length;
	}

	function queueGifExplodeChoice(file: File | Blob, fileName: string, frameCount: number, origin?: { x: number; y: number }, caption?: string) {
		gifExplodePending = {
			blob: file,
			fileName,
			frameCount,
			origin,
			caption
		};
	}

	async function handleGifExplodeChoice(mode: GifExplodeMode) {
		const pending = gifExplodePending;
		gifExplodePending = null;
		if (!pending) return;
		await placeGifAsDrafts(pending.blob, mode, {
			fileName: pending.fileName,
			origin: pending.origin,
			caption: pending.caption
		});
	}

	async function createVisualStickiesFromFiles(
		files: File[],
		origin?: { x: number; y: number },
		options?: { caption?: string; titleOverride?: string }
	): Promise<{ created: number; compacted: number; failed: number; skippedCap: number }> {
		const capped = files.slice(0, DESK_IMAGE_MAX_PER_ACTION);
		const skippedCap = Math.max(0, files.length - capped.length);
		const drafts: Array<{ title: string; body: string; source?: Note['source'] }> = [];
		let compacted = 0;
		let failed = 0;
		const animatedGifs: File[] = [];

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
					flashToast(`Image too large to import (max 20 MB): ${file.name}`, 3200);
				} else if (prepared.error === 'unsupported') {
					flashToast(`Can't import ${file.name} — try PNG, JPEG, WebP, or GIF`, 3200);
				}
				continue;
			}
			if (prepared.compacted) compacted++;
			const title = options?.titleOverride?.trim() || prepared.titleHint;
			const sourceTitle = file.name?.trim() || title;
			drafts.push({
				title,
				body: imageNoteBody(prepared.dataUrl, title, options?.caption ?? ''),
				source: imageNoteSource(sourceTitle)
			});
		}

		const notes = await placeNoteDraftsOnDesk(drafts, origin);
		let created = notes.length;

		if (animatedGifs.length === 1) {
			const gif = animatedGifs[0]!;
			const inspected = await inspectGif(gif);
			if (inspected.ok) {
				queueGifExplodeChoice(
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
			// Avoid dialog spam: still each, hint to drop one at a time for explode.
			for (const gif of animatedGifs) {
				const n = await placeGifAsDrafts(gif, 'still', {
					fileName: gif.name || 'animation.gif',
					origin,
					caption: options?.caption
				});
				created += n;
			}
			flashToast(
				`Imported ${animatedGifs.length} GIFs as stills — drop one GIF to explode frames`,
				4200
			);
		}

		return { created, compacted, failed, skippedCap };
	}

	async function handleDroppedFiles(files: File[], x: number, y: number) {
		const batch = splitExternalImportFiles(files);
		const supportedCount =
			batch.noteTextFiles.length +
			batch.jsonFiles.length +
			batch.pdfFiles.length +
			batch.docxFiles.length +
			batch.htmlFiles.length +
			batch.imageFiles.length;
		if (supportedCount === 0) {
			const names = batch.unsupportedFiles.map((f) => f.name).filter(Boolean);
			if (names.length === 1) {
				flashToast(
					`Can't import ${names[0]} — try PNG, JPEG, WebP, GIF, PDF, Word, HTML, or text`,
					3600
				);
			} else {
				flashToast('Drop a PDF, Word, HTML, image, text note, or Mash JSON file', 3000);
			}
			return;
		}

		flashToast(`Importing ${supportedCount} file${supportedCount === 1 ? '' : 's'}…`, 5000);
		const importedNoteIds: string[] = [];
		let importedFileCount = 0;
		let importedSyncCount = 0;
		let failedCount = 0;
		let waitingForConfirmation = false;
		let openedDocName = '';
		let imageCreated = 0;
		let imageCompacted = 0;

		if (batch.pdfFiles.length > 0) {
			openPdfReader(batch.pdfFiles[0]!);
			openedDocName = batch.pdfFiles[0]!.name;
			if (batch.pdfFiles.length > 1) failedCount += batch.pdfFiles.length - 1;
			if (batch.docxFiles.length > 0) failedCount += batch.docxFiles.length;
			if (batch.htmlFiles.length > 0) failedCount += batch.htmlFiles.length;
		} else if (batch.docxFiles.length > 0) {
			openDocxReader(batch.docxFiles[0]!);
			openedDocName = batch.docxFiles[0]!.name;
			if (batch.docxFiles.length > 1) failedCount += batch.docxFiles.length - 1;
			if (batch.htmlFiles.length > 0) failedCount += batch.htmlFiles.length;
		} else if (batch.htmlFiles.length > 0) {
			openHtmlReader(batch.htmlFiles[0]!);
			openedDocName = batch.htmlFiles[0]!.name;
			if (batch.htmlFiles.length > 1) failedCount += batch.htmlFiles.length - 1;
		}

		if (batch.imageFiles.length > 0) {
			const imageResult = await createVisualStickiesFromFiles(batch.imageFiles, { x, y });
			imageCreated = imageResult.created;
			imageCompacted = imageResult.compacted;
			failedCount += imageResult.failed;
			if (imageResult.skippedCap > 0) {
				flashToast(`Imported ${DESK_IMAGE_MAX_PER_ACTION} of ${batch.imageFiles.length} images`, 3600);
			}
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
		if (openedDocName) parts.push(`Opened ${openedDocName}`);
		if (imageCreated > 0) {
			parts.push(
				imageCreated === 1 ? 'Added 1 image card' : `Added ${imageCreated} image cards`
			);
		}
		if (imageCompacted > 0) {
			parts.push(
				imageCompacted === 1 ? 'Image resized for the desk' : `${imageCompacted} images resized for the desk`
			);
		}
		if (uniqueNoteIds.length > 0) {
			parts.push(
				`Imported ${uniqueNoteIds.length} note${uniqueNoteIds.length === 1 ? '' : 's'} from ${importedFileCount} file${importedFileCount === 1 ? '' : 's'}`
			);
		}
		if (importedSyncCount > 0) {
			parts.push(`Imported ${importedSyncCount} sync bundle${importedSyncCount === 1 ? '' : 's'}`);
		}
		if (skippedCount > 0) {
			parts.push(`Skipped ${skippedCount} unsupported or invalid`);
		}
		if (parts.length > 0) flashToast(parts.join(' · '), 3600);
		else if (!waitingForConfirmation) flashToast('No supported files imported', 3600);
	}

	function isEditablePasteTarget(target: EventTarget | null): boolean {
		if (!(target instanceof HTMLElement)) return false;
		return Boolean(target.closest('input, textarea, [contenteditable="true"], [role="textbox"]'));
	}

	function handleGlobalPaste(event: ClipboardEvent) {
		if (isEditablePasteTarget(event.target)) return;
		if (
			showPalette ||
			settingsOpen ||
			shortcutsOpen ||
			spacesOverviewOpen ||
			sessionPanelOpen ||
			pasteDialogOpen ||
			gifExplodeDialogOpen ||
			documentReaderOpen ||
			editorStage.open
		) {
			return;
		}
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
					const inspected = await inspectGif(imageBlob);
					if (inspected.ok && inspected.animated) {
						queueGifExplodeChoice(imageBlob, fileName, inspected.frameCount, undefined, caption);
						return;
					}
				}
				const prepared = await prepareDeskImage(imageBlob, {
					fileName,
					titleHint: 'Pasted image'
				});
				if (!prepared.ok) {
					if (prepared.error === 'too-large') {
						flashToast('Image too large to import (max 20 MB)', 3200);
					} else {
						flashToast("Can't import that image — try PNG, JPEG, WebP, or GIF", 3200);
					}
					return;
				}
				const title = prepared.titleHint || 'Pasted image';
				const notes = await placeNoteDraftsOnDesk([
					{
						title,
						body: imageNoteBody(prepared.dataUrl, title, caption),
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
					flashToast(bits.join(' · '));
				}
			})();
			return;
		}
		const urlDrafts = draftsFromUrlOnlyText(text);
		if (urlDrafts) {
			event.preventDefault();
			void (async () => {
				const notes = await placeNoteDraftsOnDesk(urlDrafts);
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
				flashToast(parts.join(' · '));
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
		pasteAnalysis = analysis;
		pasteDialogOpen = true;
	}

	async function createCardsFromPaste(analysis: PasteAnalysis, mode: PasteSplitMode) {
		const drafts = draftsFromPastedText(analysis.text, mode);
		if (drafts.length === 0) return;
		const createdNotes = await placeNoteDraftsOnDesk(drafts);
		pasteDialogOpen = false;
		pasteAnalysis = null;
		if (createdNotes.length > 0) {
			flashToast(
				createdNotes.length === 1 ? 'Pasted 1 card' : `Pasted ${createdNotes.length} cards`
			);
		}
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
		if (parts.length > 0) flashToast(parts.join(' · '), 3600);
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

	/** Ingredients tray: All / Desk / Kept — not a permanent library browser. */
	let peelScopeFilter = $state<PeelScopeFilter>('ingredients');
	let filteredNotes = $derived(filterNotes(library.notes, peel.currentFilter, ''));
	let showCanvasEmptyState = $derived(
		shouldShowCanvasEmptyState(
			canvas.canvasItems,
			library.notesById,
			peel.currentFilter.type === 'pinned'
		)
	);
	let tryAMashDismissed = $state(
		typeof localStorage !== 'undefined' ? isTryAMashDismissed(localStorage) : false
	);
	let showTryAMash = $derived(
		shouldOfferTryAMash({
			dismissed: tryAMashDismissed,
			emptyStateVisible: showCanvasEmptyState,
			isPinnedBoard: peel.currentFilter.type === 'pinned',
			// Root Desk only — folder/tag/linked boards stay quiet
			isRootDesk: peel.currentFilter.type === null
		})
	);

	function dismissTryAMashForever() {
		dismissTryAMash(localStorage);
		tryAMashDismissed = true;
	}

	let tryAMashBusy = $state(false);

	async function runTryAMash() {
		if (tryAMashBusy || tryAMashDismissed) return;
		tryAMashBusy = true;
		try {
			const notes = await placeNoteDraftsOnDesk(tryAMashDrafts());
			if (notes.length === 0) return;
			dismissTryAMashForever();
			flashToast(tryAMashSuccessToast(), 4200);
		} finally {
			tryAMashBusy = false;
		}
	}
	let peelScopeStats = $derived(peelScopeCounts(filteredNotes));
	let peelNotes = $derived(
		sortNotesForPeel(
			filterPeelNotes(
				filterNotesByPeelScope(filteredNotes, peelScopeFilter),
				peel.peelFilterText
			)
		)
	);
	let peelNotesSubtitle = $derived(
		peel.peelMode === 'notes' && peel.currentFilter.type === null
			? peelScopeSubtitle(peelScopeStats, peelScopeFilter)
			: undefined
	);
	/** Screenplay mode: any open folder/pinned board besides root Desk. */
	let screenplayActive = $derived(spaces.openKeys.length > 1);
	let screenplayChipTitle = $derived(screenplayActive ? 'Screenplay' : peel.canvasTitle);
	let canvasPlaceCount = $derived(
		canvas.canvasItems.filter((item) => library.notesById.has(item.noteId)).length
	);
	let headerSearchResults = $derived.by(() => {
		if (!peel.searchQuery.trim()) return [];
		const hits = searchNotes(peel.searchQuery).filter((result) =>
			library.notesById.has(result.id)
		);
		const rankedIds = rankSearchIdsForPeel(
			hits.map((h) => h.id),
			library.notesById
		);
		const byId = new Map(hits.map((h) => [h.id, h]));
		return rankedIds.map((id) => byId.get(id)!).filter(Boolean);
	});
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
		const query = peel.searchQuery;
		searchHighlight = 0;
		searchDropdownOpen = Boolean(query.trim());
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
	): Promise<boolean> {
		if (sourceNotes.length < 2) {
			flashToast('Pick at least two notes to mash');
			return false;
		}
		const sessionId = sessionManager.activeSession?.id;
		if (!canvas.activeCanvas || !sessionId) {
			flashToast('Canvas not ready');
			return false;
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
			const onBoard = canvas.canvasItems.filter((i) => sourceNotes.some((n) => n.id === i.noteId));
			if (onBoard.length > 0) {
				placeX = onBoard.reduce((s, i) => s + i.x, 0) / onBoard.length;
				placeY = onBoard.reduce((s, i) => s + i.y, 0) / onBoard.length;
			}
		}

		const sourceIds = sourceNotes.map((n) => n.id);
		const mergedTags = [...new Set(['mash', ...sourceNotes.flatMap((n) => n.tags)])];
		const operation = await createOperationRecord({
			sessionId,
			type: 'mash',
			inputNoteIds: sourceIds,
			outputNoteIds: [],
			payload: { sourceCount: sourceIds.length }
		});
		let mashed: Note | null = null;
		try {
			mashed = await createNote({
				...activeNoteOwnership(),
				title,
				body,
				folder: peel.canvasFolder,
				tags: mergedTags,
				links: extractWikilinks(body),
				mashedFrom: sourceIds,
				operationId: operation.id
			});
			await db.operations.update(operation.id, { outputNoteIds: [mashed.id] });
			const item = await canvas.mashCanvasItems(
				sourceIds,
				mashed,
				operation.id,
				{ x: placeX, y: placeY },
				opts?.removeItemIds
			);
			if (!item) throw new Error('Canvas Mash was not applied');
			library.adoptNotes([mashed]);
			canvas.settlingIds = new Set([item.id]);
			setTimeout(() => {
				canvas.settlingIds = new Set();
			}, 320);
			const demoCook = shouldStayOnDeskAfterMash(sourceNotes);
			// First-session demo stays on the desk so Mash → Unmash is visible.
			if (!demoCook) {
				openInStage(mashed.id, 'maximize');
			} else {
				library.selectionIds = [mashed.id];
				library.selectedId = mashed.id;
				canvas.canvasBoard?.ensureNoteVisible(mashed.id);
			}
			await refreshOperationHistory();
			flashToast(
				demoCook
					? tryAMashAfterMashToast()
					: formatContentOperatorToast('Mash', sourceIds.length, 1),
				demoCook ? 4800 : undefined
			);
			return true;
		} catch (error) {
			console.error('Failed to Mash notes', error);
			if (mashed) await replaceNoteSubset([mashed.id], []);
			await db.operations.delete(operation.id);
			flashToast('Could not Mash these cards');
			return false;
		}
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

	function selectionExportTitle(notes: Note[]): string {
		if (notes.length === 1) return notes[0]?.title.trim() || 'Untitled';
		return `Mash · ${notes.length} notes`;
	}

	function onMashButtonClick() {
		if (library.selectionIds.length < 2) {
			flashToast('Select at least 2 cards to mash');
			return;
		}
		void invokeOperatorAction('combine-selection');
	}

	function toggleMoreMenu() {
		library.bulkMenu = library.bulkMenu === 'more' ? null : 'more';
	}

	async function exportSelectionPdf() {
		const notes = library.selectedNotes;
		if (notes.length === 0) return;
		library.bulkMenu = null;
		try {
			const { exportSequencePdf } = await import('$lib/sequence-pdf');
			const title = selectionExportTitle(notes);
			const ok = await exportSequencePdf(notes, title);
			if (!ok) {
				flashToast('Could not export PDF');
				return;
			}
			flashToast(
				notes.length === 1 ? 'PDF downloaded' : `PDF downloaded · ${notes.length} notes`
			);
		} catch (cause) {
			console.error(cause);
			flashToast('Could not export PDF');
		}
	}

	function printSelection() {
		const notes = library.selectedNotes;
		if (notes.length === 0) return;
		library.bulkMenu = null;
		const opened = printSequenceAsPdf(notes, selectionExportTitle(notes));
		flashToast(
			opened
				? notes.length === 1
					? 'Opened print dialog'
					: `Opened print dialog · ${notes.length} notes`
				: 'Could not prepare print view'
		);
	}

	function downloadSelectionMarkdown() {
		const notes = library.selectedNotes;
		if (notes.length === 0) return;
		library.bulkMenu = null;
		library.exportSelectionMarkdown(notes);
	}

	/** Restore source notes with a reversible Unmash receipt. */
	async function unmashSelection() {
		if (!canvas.activeCanvas) return;
		const mashNotes = library.selectedNotes.filter(
			(n) => n.tags.includes('mash') && n.mashedFrom && n.mashedFrom.length > 0
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
			const result = await canvas.unmashCanvasItem(mash, sources);
			missingSources += result.missing;
			placed.push(...result.itemIds);
			if (result.restored > 0) {
				if (canvas.expandedNoteId === mash.id) canvas.expandedNoteId = null;
				const pane = editorStage.panes.find((candidate) => candidate.noteId === mash.id);
				if (pane) editorStage.dismissPane(pane.id);
			}
		}
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
					...activeNoteOwnership(),
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
		const midX = mashItems.reduce((s, i) => s + i.x, 0) / Math.max(1, mashItems.length);
		const midY = mashItems.reduce((s, i) => s + i.y, 0) / Math.max(1, mashItems.length);

		await mashNotesIntoBubble(mashNotes, {
			x: midX,
			y: midY,
			removeItemIds: mashItems.map((i) => i.id)
		});
	}

	async function handleNewNote() {
		const onPinned = peel.currentFilter.type === 'pinned';
		const note = await createNote({
			...activeNoteOwnership(),
			title: 'Untitled',
			body: '',
			folder: peel.currentFilter.type === 'folder' ? peel.currentFilter.value || '' : '',
			links: [],
			pinned: onPinned ? 1 : 0
		});
		addNoteToSearch(note);
		library.notes = [note, ...library.notes];
		void sessionManager.recordMeaningfulActivity();
		if (canvas.activeCanvas) {
			const spawn = canvas.canvasBoard?.getSpawnPoint(
				COLLAPSED_CARD,
				canvas.canvasItems.length
			) ?? {
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
				void invokeOperatorAction('combine-selection');
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
			if (docxReaderOpen) {
				hideDocxReader();
				return;
			}
			if (htmlReaderOpen) {
				hideHtmlReader();
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

	const basePaletteActions = createActionRegistry([
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
			label: 'Open Word document…',
			action: () => {
				showPalette = false;
				docxInputEl?.click();
			},
			shortcut: ''
		},
		{
			label: 'Open HTML document…',
			action: () => {
				showPalette = false;
				htmlInputEl?.click();
			},
			shortcut: ''
		},
		{
			label: 'Open image…',
			action: () => {
				showPalette = false;
				imageInputEl?.click();
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
				flashToast(
					`Exported ${library.notes.length} note${library.notes.length === 1 ? '' : 's'} as JSON`
				);
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
	]);

	const operatorActions = createActionRegistry([
		{
			id: 'combine-selection',
			label: 'Mash selected notes',
			shortcut: '⌘M',
			mutation: 'content',
			surfaces: ['palette', 'shortcut', 'context'],
			available: () => selectedCanvasItems().length >= 2,
			confirmation: 'required',
			undo: 'content',
			action: combineSelection
		},
		{
			id: 'unmash-selection',
			label: 'Unmash selected result',
			shortcut: '',
			mutation: 'content',
			surfaces: ['palette', 'context'],
			available: () => library.canUnmash,
			undo: 'content',
			action: unmashSelection
		},
		{
			id: 'split-selection-headings',
			label: 'Split selected card by headings',
			shortcut: '',
			mutation: 'content',
			surfaces: ['palette', 'selection'],
			available: () => Boolean(splitCandidate('headings')),
			undo: 'content',
			action: () => splitSelection('headings')
		},
		{
			id: 'split-selection-paragraphs',
			label: 'Split selected card by paragraphs',
			shortcut: '',
			mutation: 'content',
			surfaces: ['palette', 'selection'],
			available: () => Boolean(splitCandidate('paragraphs')),
			undo: 'content',
			action: () => splitSelection('paragraphs')
		},
		{
			id: 'split-selection-lines',
			label: 'Split selected card by lines',
			shortcut: '',
			mutation: 'content',
			surfaces: ['palette', 'selection'],
			available: () => Boolean(splitCandidate('lines')),
			undo: 'content',
			action: () => splitSelection('lines')
		},
		{
			id: 'export-selection-pdf',
			label: 'Export selected as PDF',
			shortcut: '',
			mutation: 'none',
			surfaces: ['palette'],
			available: () => library.selectionIds.length >= 1,
			action: () => void exportSelectionPdf()
		},
		{
			id: 'print-selection',
			label: 'Print selected notes',
			shortcut: '',
			mutation: 'none',
			surfaces: ['palette'],
			available: () => library.selectionIds.length >= 1,
			action: printSelection
		},
		{
			id: 'export-selection-markdown',
			label: 'Download selected as Markdown',
			shortcut: '',
			mutation: 'none',
			surfaces: ['palette'],
			available: () => library.selectionIds.length >= 1,
			action: downloadSelectionMarkdown
		},
		{
			id: 'stack-selection',
			label: 'Stack selected cards',
			shortcut: '',
			mutation: 'layout',
			surfaces: ['palette', 'selection'],
			available: () => selectedCanvasItems().length >= 2,
			undo: 'layout',
			action: stackSelection
		},
		{
			id: 'spread-selection',
			label: 'Spread selected cards',
			shortcut: '',
			mutation: 'layout',
			surfaces: ['palette', 'selection'],
			available: () => selectedCanvasItems().length >= 2,
			undo: 'layout',
			action: spreadSelection
		},
		{
			id: 'sequence-selection',
			label: 'Sequence selected in reading order',
			shortcut: '',
			mutation: 'layout',
			surfaces: ['palette', 'selection'],
			available: () => selectedCanvasItems().length >= 2,
			undo: 'layout',
			action: sequenceSelection
		},
		{
			id: 'sort-selection-title',
			label: 'Sort selected by title',
			shortcut: '',
			mutation: 'layout',
			surfaces: ['palette', 'selection'],
			available: () => selectedCanvasItems().length >= 2,
			undo: 'layout',
			action: () => sortSelection('title')
		},
		{
			id: 'sort-selection-created',
			label: 'Sort selected by creation time',
			shortcut: '',
			mutation: 'layout',
			surfaces: ['palette', 'selection'],
			available: () => selectedCanvasItems().length >= 2,
			undo: 'layout',
			action: () => sortSelection('created')
		},
		{
			id: 'shuffle-selection',
			label: 'Shuffle selected cards',
			shortcut: '',
			mutation: 'layout',
			surfaces: ['palette', 'selection'],
			available: () => selectedCanvasItems().length >= 2,
			undo: 'layout',
			action: shuffleSelection
		},
		{
			id: 'deduplicate-selection',
			label: 'Deduplicate selected cards',
			shortcut: '',
			mutation: 'content',
			surfaces: ['palette', 'selection'],
			available: () => selectedCanvasItems().length >= 2,
			undo: 'content',
			action: deduplicateSelection
		},
		{
			id: 'keep-selection',
			label: 'Keep selected on this device',
			shortcut: '',
			mutation: 'content',
			surfaces: ['palette', 'selection'],
			available: () => keepableNoteIds(library.selectionIds, library.notesById).length > 0,
			action: () => void keepSelection()
		}
	]);

	function invokeOperatorAction(id: string) {
		const action = operatorActions.find((candidate) => candidate.id === id);
		if (!action || !(action.available?.() ?? true)) return;
		return action.action();
	}

	const selectionKitchenActions = $derived(actionsForSurface(operatorActions, 'selection'));

	const kitchenMenuSections = $derived.by(() => {
		const actions = selectionKitchenActions;
		return KITCHEN_GROUPS.map((group) => ({
			...group,
			actions: actions.filter((action) => kitchenGroupForActionId(action.id) === group.id)
		})).filter((section) => section.actions.length > 0);
	});

	const latestKitchenReceipt = $derived.by(() => {
		const op = latestActiveOperation(operationHistory);
		return op ? operationReceiptView(op) : null;
	});

	const canUndoKitchenReceipt = $derived(
		Boolean(
			latestKitchenReceipt &&
				canvas.canvasUndoOperationId &&
				latestKitchenReceipt.id === canvas.canvasUndoOperationId
		)
	);

	let paletteActions = $derived.by(() => [
		...basePaletteActions,
		...actionsForSurface(operatorActions, 'palette')
	]);

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
		void (async () => {
			await sessionManager.bootstrap();
			await library.loadNotes();
			if (sessionManager.activeSession?.mode === 'scratch') return;
			if (syncBackupReminded) return;
			if (!shouldRemindSyncBackup(library.notes.length)) return;
			syncBackupReminded = true;
			flashToast('Tip: export a sync bundle to back up this browser', 4200);
		})();
		window.addEventListener('keydown', handleKeydown);
		window.addEventListener('paste', handleGlobalPaste);
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
			window.removeEventListener('paste', handleGlobalPaste);
			window.removeEventListener('pointerdown', onSearchPointerDown, true);
			window.removeEventListener('pagehide', library.flushPendingSave);
			document.removeEventListener('visibilitychange', library.handleVisibilityChange);
			delete window.__mashImportSync;
		};
	});
</script>

<div
	class="mash-app-shell mash-board-surface flex h-screen flex-col {snapEnabled ? 'is-snap-on' : ''}"
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
					role="combobox"
					aria-autocomplete="list"
					aria-expanded={searchDropdownOpen && Boolean(peel.searchQuery.trim())}
					aria-controls="mash-header-search-results"
					aria-activedescendant={searchDropdownOpen && headerSearchResults[searchHighlight]
						? `mash-search-result-${headerSearchResults[searchHighlight].id}`
						: undefined}
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

		<div class="flex items-center gap-1.5">
			{#if sessionManager.activeSession}
				<button
					type="button"
					class="mash-btn mash-focus inline-flex h-[38px] items-center rounded-[11px] px-3.5 text-xs font-semibold"
					onclick={() => openSessionPanel('finish')}
				>
					Finish
				</button>
			{/if}
			<div class="mash-header-utils">
				<button
					type="button"
					class="mash-reader-launch mash-focus"
					class:is-active={pdfReaderOpen}
					class:has-session={Boolean(pdfReaderFile) && !pdfReaderOpen}
					onclick={() => (pdfReaderFile ? resumePdfReader() : pdfInputEl?.click())}
					aria-label={pdfReaderFile ? 'Return to PDF reader' : 'Open PDF reader'}
					title={pdfReaderFile
						? `Return to ${pdfReaderFile.name}`
						: 'Open a PDF and capture excerpts'}
				>
					<BookOpen class="h-[18px] w-[18px]" strokeWidth={1.9} />
				</button>
				<button
					type="button"
					class="mash-theme-toggle mash-focus"
					onclick={() => theme.toggle()}
					aria-label={theme.mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
					title={theme.mode === 'dark'
						? 'Night kitchen — switch to day'
						: 'Day kitchen — switch to night'}
				>
					{#if theme.mode === 'dark'}
						<img
							src="/icons/mash-flame-night.png"
							srcset="/icons/mash-flame-night.png 1x, /icons/mash-flame-night@2x.png 2x"
							alt=""
							width="32"
							height="32"
							class="mash-theme-flame"
							draggable="false"
						/>
					{:else}
						<img
							src="/icons/mash-flame-day.png"
							srcset="/icons/mash-flame-day.png 1x, /icons/mash-flame-day@2x.png 2x"
							alt=""
							width="32"
							height="32"
							class="mash-theme-flame"
							draggable="false"
						/>
					{/if}
				</button>
			</div>
			<div class="hidden items-center gap-1 text-xs lg:flex" style="color: var(--mash-ink-muted);">
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
	{#if library.writeError}
		<div
			class="flex flex-wrap items-center gap-2 border-b px-4 py-2 text-xs"
			style="border-color: var(--mash-tray-edge); background: var(--mash-danger-wash); color: var(--mash-ink);"
			role="alert"
		>
			<span class="min-w-0 flex-1">{library.writeError}</span>
			<button
				type="button"
				class="mash-btn-ghost rounded-md px-2.5 py-1 text-[11px] font-semibold"
				onclick={() => void library.retryPendingWrites()}
			>
				Retry save
			</button>
			<button
				type="button"
				class="mash-btn-ghost rounded-md px-2.5 py-1 text-[11px] font-semibold"
				onclick={() => void library.copySelection(library.notes)}
			>
				Copy desk
			</button>
			<button
				type="button"
				class="mash-btn rounded-md px-2.5 py-1 text-[11px] font-semibold"
				onclick={() => exportNotesJson(library.notes, 'mash-emergency-export.json')}
			>
				Emergency export
			</button>
		</div>
	{/if}

	<!-- Full-bleed canvas stage -->
	<div class="relative flex min-h-0 flex-1">
		<div class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
			{#if !documentReaderOpen}
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
					<span class="mash-display font-medium" style="color: var(--mash-chrome-ink);"
						>{screenplayChipTitle}</span
					>
					<span class="mx-1.5 opacity-40">·</span>
					{canvasPlaceCount} on canvas
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
				{:else if docxReaderFile && !docxReaderOpen}
					<button
						type="button"
						class="mash-reader-return mash-focus"
						onclick={resumeDocxReader}
						title={`Return to ${docxReaderFile.name}`}
					>
						<BookOpen class="h-4 w-4 shrink-0" strokeWidth={2} />
						<span>Return to Word</span>
						<small>{docxReaderFile.name}</small>
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
					emptyMascot={peel.currentFilter.type === 'pinned'
						? {
								src: '/icons/mash-pinned-mascot.png',
								srcset: '/icons/mash-pinned-mascot.png 1x, /icons/mash-pinned-mascot@2x.png 2x',
								width: 160,
								height: 160,
								title: 'Pin notes here',
								copy: 'Drop favorites onto this board — or pin from any sticky.'
							}
						: undefined}
					showEmptyState={showCanvasEmptyState}
					showTryAMash={showTryAMash}
					tryAMash={runTryAMash}
					tryAMashBusy={tryAMashBusy}
					dismissTryAMash={dismissTryAMashForever}
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
					tags={library.uniqueTags}
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
				{#if pdfReaderFile && LazyPdfReader}
					{#key pdfReaderFile}
						<LazyPdfReader
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
				{:else if pdfReaderOpen && pdfReaderModuleLoading}
					<section class="mash-pdf-reader" aria-label="PDF reader">
						<div
							class="flex h-full items-center justify-center text-sm"
							style="color: var(--mash-ink-muted);"
						>
							Loading PDF tools…
						</div>
					</section>
				{/if}
				{#if docxReaderFile && LazyDocxReader}
					{#key docxReaderFile}
						<LazyDocxReader
							file={docxReaderFile}
							clippings={docxClippings}
							open={docxReaderOpen}
							onClose={hideDocxReader}
							onClip={saveDocxClipping}
							onOpenClippings={openDocxClippingsOnCanvas}
						/>
					{/key}
				{:else if docxReaderOpen && docxReaderModuleLoading}
					<section class="mash-pdf-reader" aria-label="Word document reader">
						<div
							class="flex h-full items-center justify-center text-sm"
							style="color: var(--mash-ink-muted);"
						>
							Loading Word document tools…
						</div>
					</section>
				{/if}
				{#if htmlReaderFile && LazyHtmlReader}
					{#key htmlReaderFile}
						<LazyHtmlReader
							file={htmlReaderFile}
							clippings={htmlClippings}
							open={htmlReaderOpen}
							onClose={hideHtmlReader}
							onClip={saveHtmlClipping}
							onOpenClippings={openHtmlClippingsOnCanvas}
						/>
					{/key}
				{:else if htmlReaderOpen && htmlReaderModuleLoading}
					<section class="mash-pdf-reader" aria-label="HTML document reader">
						<div
							class="flex h-full items-center justify-center text-sm"
							style="color: var(--mash-ink-muted);"
						>
							Loading HTML document tools…
						</div>
					</section>
				{/if}
				{#if !documentReaderOpen}
					<EditorStage
						stage={editorStage}
						notesById={library.notesById}
						canvasNotes={canvas.canvasItems
							.map((i) => library.notesById.get(i.noteId))
							.filter((n): n is Note => Boolean(n))}
						folders={library.uniqueFolders}
						tags={library.uniqueTags}
						onTitleChange={library.handleStickyTitleChange}
						onBodyChange={library.handleStickyBodyChange}
						onMetaChange={library.handleStickyMetaChange}
						onWikilink={(target) => void openWikilink(target)}
						onOpenSource={(noteId) => {
							library.selectNote(noteId, { keepSelection: true });
							editorStage.openBeside(noteId);
						}}
						onUndoOperation={() => canvas.undoCanvasLayout()}
						undoOperationId={canvas.canvasUndoOperationId}
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
				foldersOpen={peel.foldersFlyout}
				tagsOpen={peel.tagsFlyout}
				linkedOpen={peel.linkedFlyout}
				{settingsOpen}
				dockSelect={peel.handleDockAction}
				openDesks={() => openSessionPanel('desks')}
			/>
		</div>
		{#if settingsOpen}
			<div
				class="mash-peel-slot pointer-events-auto absolute top-1/2 left-[4.75rem] z-30 -translate-y-1/2"
			>
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
					onOpenDocx={() => {
						settingsOpen = false;
						docxInputEl?.click();
					}}
					onOpenHtml={() => {
						settingsOpen = false;
						htmlInputEl?.click();
					}}
					onOpenImage={() => {
						settingsOpen = false;
						imageInputEl?.click();
					}}
					conflictCount={syncConflicts.count}
					onOpenConflicts={() => {
						settingsOpen = false;
						peel.openPeel('conflicts');
					}}
				/>
			</div>
		{:else if peel.peelOpen}
			<div
				class="mash-peel-slot pointer-events-auto absolute top-1/2 left-[4.75rem] z-30 -translate-y-1/2"
			>
				<PeelScanner
					open={peel.peelOpen}
					pinned={peel.peelPinned}
					mode={peel.peelMode}
					title={peel.peelTitle}
					subtitle={peelNotesSubtitle}
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
					scopeFilter={peel.currentFilter.type === null ? peelScopeFilter : undefined}
					scopeCounts={peel.currentFilter.type === null ? peelScopeStats : undefined}
					onScopeFilter={
						peel.currentFilter.type === null
							? (scope) => {
									peelScopeFilter = scope;
								}
							: undefined
					}
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
					{conflictRows}
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
				style="left: {canvas.touchPlaceGhost.clientX - 40}px; top: {canvas.touchPlaceGhost.clientY -
					20}px; border-color: var(--mash-paper-chip-border); background: var(--mash-paper-chip);"
			>
				<div class="text-xs font-semibold" style="color: var(--mash-card-ink);">
					{ghostNote?.title ?? 'Note'}
				</div>
				<div class="mt-0.5 text-[10px]" style="color: var(--mash-card-muted);">Drop on canvas</div>
			</div>
		{/if}

		{#if (library.selectionIds.length > 0 || latestKitchenReceipt) && !documentReaderOpen}
			<div
				class="mash-selection-bar absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-2"
				class:mash-selection-bar--peel={peel.peelOpen || settingsOpen}
			>
				{#if latestKitchenReceipt}
					<OperatorReceiptStrip
						receipt={latestKitchenReceipt}
						canUndo={canUndoKitchenReceipt}
						onUndo={() => void canvas.undoCanvasLayout()}
					/>
				{/if}
				{#if library.selectionIds.length === 0}
					<!-- Receipt-only strip when nothing is selected -->
				{:else if library.bulkMenu === 'tag'}
					<div
						class="w-64 rounded-xl border p-3 shadow-xl"
						style="border-color: var(--mash-panel-border); background: var(--mash-panel); backdrop-filter: blur(10px);"
					>
						<div
							class="mb-2 text-[10px] font-medium tracking-wide uppercase"
							style="color: var(--mash-accent-bright);"
						>
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
							{#each library.uniqueTags as tag (tag)}
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
						<div
							class="mb-2 text-[10px] font-medium tracking-wide uppercase"
							style="color: var(--mash-accent-bright);"
						>
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
							{#each library.uniqueFolders as folder (folder)}
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
				{:else if library.bulkMenu === 'more'}
					<div
						class="grid w-64 grid-cols-1 gap-1 rounded-xl border p-2 shadow-xl"
						style="border-color: var(--mash-panel-border); background: var(--mash-panel); backdrop-filter: blur(10px);"
						aria-label="More selection actions"
						data-testid="selection-more-menu"
					>
						<button
							type="button"
							class="mash-btn-ghost rounded-lg px-3 py-2 text-left text-xs"
							onclick={() => (library.bulkMenu = 'tag')}
						>
							<strong class="flex items-center gap-1.5"><Tag class="h-3.5 w-3.5" /> Tag…</strong>
							<small style="color: var(--mash-ink-muted);">Add or apply tags</small>
						</button>
						<button
							type="button"
							class="mash-btn-ghost rounded-lg px-3 py-2 text-left text-xs"
							onclick={() => (library.bulkMenu = 'folder')}
						>
							<strong class="flex items-center gap-1.5"
								><Folder class="h-3.5 w-3.5" /> Folder…</strong
							>
							<small style="color: var(--mash-ink-muted);">Move to a folder</small>
						</button>
						<button
							type="button"
							class="mash-btn-ghost rounded-lg px-3 py-2 text-left text-xs"
							onclick={() => {
								library.bulkMenu = null;
								void library.copySelection();
							}}
						>
							<strong class="flex items-center gap-1.5"><Copy class="h-3.5 w-3.5" /> Copy</strong>
							<small style="color: var(--mash-ink-muted);">Copy as Markdown</small>
						</button>
						<button
							type="button"
							class="mash-btn-ghost rounded-lg px-3 py-2 text-left text-xs"
							onclick={downloadSelectionMarkdown}
						>
							<strong class="flex items-center gap-1.5"
								><Download class="h-3.5 w-3.5" /> Download Markdown</strong
							>
							<small style="color: var(--mash-ink-muted);">Save as a .md file</small>
						</button>
						<button
							type="button"
							class="mash-btn-ghost rounded-lg px-3 py-2 text-left text-xs"
							onclick={() => void exportSelectionPdf()}
						>
							<strong class="flex items-center gap-1.5"
								><FileDown class="h-3.5 w-3.5" /> Export PDF</strong
							>
							<small style="color: var(--mash-ink-muted);">Quick export · or use Finish</small>
						</button>
						<button
							type="button"
							class="mash-btn-ghost rounded-lg px-3 py-2 text-left text-xs"
							onclick={printSelection}
						>
							<strong class="flex items-center gap-1.5"
								><Printer class="h-3.5 w-3.5" /> Print</strong
							>
							<small style="color: var(--mash-ink-muted);">System print dialog</small>
						</button>
					</div>
				{:else if library.bulkMenu === 'operators'}
					<div
						class="mash-operator-kitchen flex w-[min(92vw,22rem)] flex-col gap-2 rounded-xl border p-2 shadow-xl sm:w-[28rem]"
						style="border-color: var(--mash-panel-border); background: var(--mash-panel); backdrop-filter: blur(10px);"
						aria-label="Operator kitchen — transform selected cards"
						data-testid="operator-kitchen"
					>
						{#each kitchenMenuSections as section (section.id)}
							<section class="min-w-0" aria-label={section.label}>
								<div class="mb-1 flex items-baseline justify-between gap-2 px-1">
									<span
										class="text-[10px] font-semibold tracking-wide uppercase"
										style="color: var(--mash-accent-bright);"
										>{section.label}</span
									>
									<span class="truncate text-[9px]" style="color: var(--mash-ink-muted);"
										>{section.hint}</span
									>
								</div>
								<div class="grid grid-cols-1 gap-1 sm:grid-cols-2">
									{#each section.actions as operator (operator.id)}
										<button
											type="button"
											class="mash-btn-ghost rounded-lg px-3 py-2 text-left text-xs"
											data-action-id={operator.id}
											onclick={() => {
												library.bulkMenu = null;
												void operator.action();
											}}
										>
											<strong class="block"
												>{kitchenActionTitle(operator.id, operator.label)}</strong
											>
											<small style="color: var(--mash-ink-muted);"
												>{kitchenActionSubtitle(operator.id)}</small
											>
										</button>
									{/each}
								</div>
							</section>
						{/each}
						{#if kitchenMenuSections.length === 0}
							<p class="px-2 py-3 text-center text-[11px]" style="color: var(--mash-ink-muted);">
								Select cards on the desk to open the kitchen toolkit.
							</p>
						{/if}
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

				{#if library.selectionIds.length > 0}
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
					{#if keepableSelectionIds.length > 0}
						<button
							type="button"
							data-testid="keep-selection"
							onclick={() => void keepSelection()}
							class="mash-btn-ghost flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs"
							title="Keep on this device — survives clearing this scratch desk"
							aria-label="Keep selected on this device"
						>
							<Bookmark class="h-3.5 w-3.5" />
							Keep
						</button>
					{/if}
					{#if library.selectionIds.length >= 2}
						<button
							type="button"
							onclick={onMashButtonClick}
							class="mash-btn flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold"
							title="Combine into one sticky — sources leave the desk until Unmash"
							data-testid="selection-mash"
						>
							<Layers class="h-3.5 w-3.5" />
							Mash
						</button>
					{/if}
					{#if kitchenMenuSections.length > 0}
						<button
							type="button"
							onclick={() =>
								(library.bulkMenu = library.bulkMenu === 'operators' ? null : 'operators')}
							class="mash-btn-ghost flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs {library.bulkMenu ===
							'operators'
								? 'border-[var(--mash-accent)] text-[var(--mash-accent-bright)]'
								: ''}"
							title="Operator kitchen — shape or arrange the selected set"
							data-testid="operator-kitchen-toggle"
						>
							<Layers class="h-3.5 w-3.5" />
							Transform
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
							onclick={() => void invokeOperatorAction('unmash-selection')}
							class="mash-btn-ghost flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs"
							title="Restore source notes and remove mash"
						>
							Unmash
						</button>
					{/if}
					<button
						type="button"
						onclick={toggleMoreMenu}
						class="mash-btn-ghost flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs {library.bulkMenu ===
							'more' ||
						library.bulkMenu === 'tag' ||
						library.bulkMenu === 'folder'
							? 'border-[var(--mash-accent)] text-[var(--mash-accent-bright)]'
							: ''}"
						title="Tag, folder, copy, and export"
						aria-label="More selection actions"
						aria-expanded={library.bulkMenu === 'more' ||
							library.bulkMenu === 'tag' ||
							library.bulkMenu === 'folder'}
						data-testid="selection-more-toggle"
					>
						<MoreHorizontal class="h-3.5 w-3.5" />
						More
					</button>
					<button
						type="button"
						onclick={() => void library.handleDelete()}
						class="mash-btn-ghost flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs hover:text-[var(--mash-danger)]"
						title="Delete selected"
						aria-label="Delete selected"
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
				{/if}
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
				use:focusTrap={{ initialFocus: 'input' }}
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
							.includes(paletteQuery.toLowerCase())) as action, i (action.label)}
						<button
							onclick={() => {
								showPalette = false;
								void action.action();
							}}
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
							.slice(0, 6) as note, j (note.id)}
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
		bind:this={docxInputEl}
		data-testid="docx-reader-input"
		type="file"
		accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
		class="hidden"
		onchange={(e) => {
			const input = e.currentTarget as HTMLInputElement;
			const file = input.files?.[0];
			input.value = '';
			if (file) openDocxReader(file);
		}}
	/>
	<input
		bind:this={htmlInputEl}
		data-testid="html-reader-input"
		type="file"
		accept=".html,.htm,text/html,application/xhtml+xml"
		class="hidden"
		onchange={(e) => {
			const input = e.currentTarget as HTMLInputElement;
			const file = input.files?.[0];
			input.value = '';
			if (file) openHtmlReader(file);
		}}
	/>
	<input
		bind:this={imageInputEl}
		data-testid="image-sticky-input"
		type="file"
		accept="image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif"
		multiple
		class="hidden"
		onchange={(e) => {
			const input = e.currentTarget as HTMLInputElement;
			// Snapshot files before clearing — FileList is live and empties with value=''.
			const files = input.files ? [...input.files] : [];
			input.value = '';
			void handleOpenImageFiles(files);
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
			role="status"
			aria-live="polite"
			aria-atomic="true"
			data-testid="action-status"
			class="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg border px-3 py-1.5 text-xs shadow-lg"
			style="border-color: var(--mash-tray-edge); background: var(--mash-panel); color: var(--mash-ink);"
		>
			{actionToast}
		</div>
	{/if}
	<div
		class="sr-only"
		role="status"
		aria-live="polite"
		aria-atomic="true"
		data-testid="sr-announcer"
	>
		{srAnnouncement}
	</div>

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
			sessionId={sessionManager.activeSession?.id}
			openKeys={spaces.openKeys}
			activeKey={peel.canvasKey}
			activeItems={canvas.canvasItems}
			onClose={hideSpacesOverview}
			onSwitch={switchSpace}
			onCloseSpace={(key) => spaces.closeSpace(key)}
		/>
	{/if}
	<SessionPanel
		open={sessionPanelOpen}
		initialView={sessionPanelView}
		activeSession={sessionManager.activeSession}
		activeSessions={sessionManager.activeSessions}
		recoveringSessions={sessionManager.recoveringSessions}
		retentionDays={sessionManager.retentionDays}
		{finishSnapshot}
		notesById={library.notesById}
		{storageHealth}
		onClose={() => (sessionPanelOpen = false)}
		onSwitch={activateSession}
		onNewScratch={createScratchSession}
		onFinishExport={runFinishExport}
		onFinishCommit={runFinishCommit}
		onRestore={restoreSession}
		onRetentionChange={changeRetentionDays}
		onRefreshStorage={async () => {
			await refreshStorageHealth();
		}}
	/>
	<PasteChoiceDialog
		open={pasteDialogOpen}
		analysis={pasteAnalysis}
		onChoose={(mode) => {
			if (pasteAnalysis) void createCardsFromPaste(pasteAnalysis, mode);
		}}
		onClose={() => {
			pasteDialogOpen = false;
			pasteAnalysis = null;
		}}
	/>
	<GifExplodeDialog
		open={gifExplodeDialogOpen}
		fileName={gifExplodePending?.fileName ?? ''}
		frameCount={gifExplodePending?.frameCount ?? 0}
		onChoose={(mode) => void handleGifExplodeChoice(mode)}
		onClose={() => {
			gifExplodePending = null;
		}}
	/>
</div>
