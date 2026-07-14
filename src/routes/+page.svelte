<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { createNote, db, deleteNote, listOperationRecords } from '$lib/db';
	import { addNoteToSearch, removeNoteFromSearch, searchNotes } from '$lib/search';
	import type { Note, Operation } from '$lib/types';
	import {
		Search,
		Command,
		Copy,
		Download,
		Layers,
		Combine,
		Sparkles,
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
		MoreHorizontal,
		IceCreamBowl
	} from 'lucide-svelte';
	import MashDock from '$lib/components/MashDock.svelte';
	import PeelScanner from '$lib/components/PeelScanner.svelte';
	import SearchResultsDropdown from '$lib/components/SearchResultsDropdown.svelte';
	import CanvasBoard from '$lib/components/CanvasBoard.svelte';
	import EditorStage from '$lib/components/EditorStage.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	// Settings / Shortcuts / Spaces / Session+Finish / Paste / GIF dialogs are
	// dynamic-imported below so they stay off the initial JS graph.
	import { focusTrap } from '$lib/focus-trap';
	import { actionsForSurface } from '$lib/action-registry';
	import {
		KITCHEN_GROUPS,
		kitchenActionSubtitle,
		kitchenActionTitle,
		kitchenGroupForActionId,
		latestActiveOperation,
		operationReceiptView
	} from '$lib/operator-kitchen';
	import OperatorReceiptStrip from '$lib/components/OperatorReceiptStrip.svelte';

	import { exportNotesJson, printSequenceAsPdf } from '$lib/mash';
	import { createFinishSnapshot, type FinishSnapshot } from '$lib/finish-model';
	import { clearCanvasViewport } from '$lib/viewport';
	import { clearDismissedForCanvas } from '$lib/canvas-dismiss';
	import { findBacklinks, findOutgoingNotes } from '$lib/links';
	import { downloadSyncBundle } from '$lib/sync-file';
	import { readSyncHygiene, recordSyncExport } from '$lib/sync-hygiene';
	import { loadSnapPref, saveSnapPref } from '$lib/canvas-geom';
	import {
		COLLAPSED_CARD,
		EXPANDED_CARD,
		createCanvasSession
	} from '$lib/stores/canvas-session.svelte';
	import {
		createNoteLibrary,
		filterNotes,
		filterPeelNotes,
		peelSearchText
	} from '$lib/stores/note-library.svelte';
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
		tryAMashDrafts,
		tryAMashSuccessToast
	} from '$lib/try-a-mash';
	import { createPeelNav, windowPeelNotes } from '$lib/stores/peel-nav.svelte';
	import { createOpenSpaces } from '$lib/stores/spaces.svelte';
	import { theme } from '$lib/stores/theme.svelte';
	import { syncConflicts } from '$lib/stores/sync-conflicts.svelte';
	import { createEditorStage, type SnapZone } from '$lib/stores/editor-stage.svelte';
	import { createSessionManager } from '$lib/stores/sessions.svelte';
	import { createDocumentReaders } from '$lib/stores/document-readers.svelte';
	import { createSelectionOperators } from '$lib/selection-operators';
	import {
		buildDocxClippingDraft,
		buildHtmlClippingDraft,
		buildPdfClippingDraft,
		withNoteId
	} from '$lib/document-clipping';
	import { createFinishSessionUi } from '$lib/finish-session-ui';
	import { buildBasePaletteActions, buildOperatorActions } from '$lib/command-palette';
	import { createContentOperators } from '$lib/content-operators';
	import { createAppKeydown } from '$lib/app-keyboard';
	import { createGlobalPasteHandler } from '$lib/global-paste';
	import { createDeskPlacement } from '$lib/desk-placement';
	import type { PeelConflictRow } from '$lib/components/PeelScanner.svelte';
	import { shouldShowCanvasEmptyState } from '$lib/canvas-empty-state';
	import {
		DROP_FORMAT_ERROR_HINT,
		DROP_FORMAT_HINT,
		FILE_ACCEPT,
		FILE_FORMAT_LIMITS
	} from '$lib/file-intake';
	import type { DelimitedAnalysis, DelimitedImportMode } from '$lib/delimited-import';
	import { type PdfClipPayload } from '$lib/pdf-clipping';
	import { type DocxClipPayload } from '$lib/docx-clipping';
	import { type HtmlClipPayload } from '$lib/html-clipping';
	import { type PasteAnalysis } from '$lib/paste-cards';
	import { DESK_IMAGE_MAX_PER_ACTION } from '$lib/desk-image';
	import type { GifExplodeMode } from '$lib/gif-explode';
	import { keepableNoteIds } from '$lib/keep-selection';
	import {
		inspectStorage,
		PERSISTENCE_PROMPTED_KEY,
		requestPersistentStorage,
		type StorageHealth
	} from '$lib/storage-health';
	import {
		deriveBackupHealth,
		readWorkspaceBackupRecord,
		recordWorkspaceBackup
	} from '$lib/backup-health';
	import type { WorkspaceBackup, WorkspaceRestorePlan } from '$lib/workspace-backup';

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
	let delimitedPending = $state<{
		analysis: DelimitedAnalysis;
		origin?: { x: number; y: number };
	} | null>(null);
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
	let workspaceBackupReminded = false;
	let workspaceBackupRecord = $state(readWorkspaceBackupRecord());
	let workspaceChangedAt = $state(0);
	let workspaceHasContent = $state(false);
	let workspaceBackupBusy = $state(false);
	let workspaceRestoreError = $state('');
	let workspaceRestorePending = $state<{
		backup: WorkspaceBackup;
		plan: WorkspaceRestorePlan;
	} | null>(null);
	const workspaceBackupHealth = $derived(
		deriveBackupHealth({
			hasContent: workspaceHasContent,
			workspaceChangedAt,
			record: workspaceBackupRecord,
			storagePressure: storageHealth?.pressure
		})
	);

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
		flashToast('Exported desk bundle (active desk + result history)');
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
	let delimitedInputEl: HTMLInputElement | undefined = $state();
	let workspaceRestoreInputEl: HTMLInputElement | undefined = $state();
	// documentReaders + selectionOps initialized after canvas (below)

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

	async function refreshWorkspaceBackupHealth() {
		try {
			const { inspectWorkspaceChangedAt } = await import('$lib/workspace-backup');
			const state = await inspectWorkspaceChangedAt();
			workspaceChangedAt = state.changedAt;
			workspaceHasContent = state.hasContent;
			workspaceBackupRecord = readWorkspaceBackupRecord();
		} catch (error) {
			console.error('Could not inspect workspace backup health', error);
		}
	}

	async function exportWorkspaceBackup() {
		if (workspaceBackupBusy) return;
		workspaceBackupBusy = true;
		try {
			await library.flushPendingSaveAsync();
			const { downloadWorkspaceBackup } = await import('$lib/workspace-backup');
			const record = await downloadWorkspaceBackup();
			recordWorkspaceBackup(record);
			workspaceBackupRecord = record;
			workspaceChangedAt = record.workspaceChangedAt;
			workspaceHasContent = record.counts.notes > 0 || record.counts.sessions > 1;
			flashToast(
				`Workspace backup created · ${record.counts.sessions} desk${record.counts.sessions === 1 ? '' : 's'} · ${record.counts.notes} card${record.counts.notes === 1 ? '' : 's'}`,
				4600
			);
		} catch (error) {
			console.error('Workspace backup failed', error);
			flashToast('Workspace backup could not be created. Your local work is unchanged.', 4600);
		} finally {
			workspaceBackupBusy = false;
		}
	}

	async function handleWorkspaceRestoreFile(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		try {
			const { WORKSPACE_BACKUP_MAX_CHARS } = await import('$lib/workspace-backup');
			if (file.size > WORKSPACE_BACKUP_MAX_CHARS) {
				flashToast('Workspace backup is too large to open safely.', 4200);
				return;
			}
			await previewWorkspaceRestoreText(await file.text());
		} catch (error) {
			console.error('Workspace backup inspection failed', error);
			flashToast('Couldn’t inspect this workspace backup.', 4200);
		}
	}

	async function previewWorkspaceRestoreText(text: string): Promise<boolean> {
		workspaceRestoreError = '';
		workspaceBackupBusy = true;
		try {
			const { inspectAndPlanWorkspaceRestore } = await import('$lib/workspace-backup');
			const inspected = await inspectAndPlanWorkspaceRestore(text);
			if (!inspected.ok || !inspected.plan) {
				flashToast(
					inspected.ok ? 'Couldn’t preview this workspace backup.' : inspected.error,
					4600
				);
				return false;
			}
			workspaceRestorePending = { backup: inspected.backup, plan: inspected.plan };
			settingsOpen = false;
			sessionPanelOpen = false;
			return true;
		} finally {
			workspaceBackupBusy = false;
		}
	}

	async function confirmWorkspaceRestore() {
		const pending = workspaceRestorePending;
		if (!pending || workspaceBackupBusy) return;
		workspaceBackupBusy = true;
		workspaceRestoreError = '';
		try {
			await library.flushPendingSaveAsync();
			const { applyWorkspaceRestore } = await import('$lib/workspace-backup');
			const receipt = await applyWorkspaceRestore(pending.backup);
			await sessionManager.bootstrap();
			const preferred = [...pending.backup.sessions]
				.filter((session) => session.status === 'active')
				.sort((a, b) => b.modified - a.modified)[0];
			if (preferred) await sessionManager.switchTo(preferred.id);
			await library.loadNotes();
			await canvas.loadContextCanvas('', preferred?.id);
			await refreshOperationHistory();
			workspaceRestorePending = null;
			await refreshWorkspaceBackupHealth();
			if (receipt.conflictsForReview.length > 0) {
				syncConflicts.setFromImport(receipt.conflictsForReview);
				peel.openPeel('conflicts');
			}
			flashToast(
				`Restored workspace · ${receipt.added} added · ${receipt.updated} updated${receipt.conflicts ? ` · ${receipt.conflicts} conflicts` : ''}`,
				5200
			);
		} catch (error) {
			console.error('Workspace restore failed', error);
			workspaceRestoreError =
				'Restore did not commit. Your previous durable workspace is still available.';
		} finally {
			workspaceBackupBusy = false;
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
			const removedItemIds = canvas.canvasItems.filter((i) => idSet.has(i.noteId)).map((i) => i.id);
			canvas.canvasItems = canvas.canvasItems.filter((i) => !idSet.has(i.noteId));
			if (removedItemIds.length > 0) {
				const removeSet = new Set(removedItemIds);
				canvas.canvasEdges = canvas.canvasEdges.filter(
					(e) => !removeSet.has(e.fromItemId) && !removeSet.has(e.toItemId)
				);
				canvas.pruneCanvasUndo(removedItemIds);
			}
		},
		onFolderDeleted: async (folder) => {
			const sessionId = sessionManager.activeSession?.id;
			const folderCanvas = sessionId
				? await db.canvases.where('[sessionId+folder]').equals([sessionId, folder]).first()
				: await db.canvases.where('folder').equals(folder).first();
			if (folderCanvas) {
				await db.canvasItems.where('canvasId').equals(folderCanvas.id).delete();
				await db.canvasEdges.where('canvasId').equals(folderCanvas.id).delete();
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

	/** Warm Session/Finish chunk before click (header hover). */
	function preloadSessionPanel() {
		void import('$lib/components/SessionPanel.svelte');
	}

	function openSessionPanel(view: 'desks' | 'finish' = 'desks') {
		if (view === 'desks') void refreshWorkspaceBackupHealth();
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

	$effect(() => {
		if (settingsOpen) void refreshWorkspaceBackupHealth();
	});

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

	const documentReaders = createDocumentReaders({
		flashToast,
		prepareForReader: () => {
			showPalette = false;
			settingsOpen = false;
			peel.closePeel(true);
			library.clearSelection();
			if (canvas.expandedNoteId) canvas.collapseSticky();
			if (editorStage.open) editorStage.dismissAll();
		}
	});

	const selectionOps = createSelectionOperators({
		getSelectionIds: () => library.selectionIds,
		setSelection: (ids, primary) => {
			library.selectionIds = ids;
			library.selectedId = primary;
		},
		getCanvasItems: () => canvas.canvasItems,
		getNotesById: () => library.notesById,
		handleCanvasMoveEnd: (moves, before, moveOpts) =>
			canvas.handleCanvasMoveEnd(moves, before, moveOpts),
		sequenceCanvasSelection: (ids) => canvas.sequenceCanvasSelection(ids),
		deduplicateCanvasSelection: (ids, map) => canvas.deduplicateCanvasSelection(ids, map),
		closeBulkMenu: () => {
			library.bulkMenu = null;
		},
		flashToast,
		flushPendingSaveAsync: () => library.flushPendingSaveAsync(),
		getWriteError: () => library.writeError,
		keepTakeaway: (ids) => sessionManager.keepTakeaway(ids),
		applyPromotedNotes: (notes) => library.applyPromotedNotes(notes),
		recordMeaningfulActivity: () => {
			void sessionManager.recordMeaningfulActivity();
		},
		offerPersistentStorageOnce: () => offerPersistentStorageOnce()
	});

	const {
		openPdfReader,
		openDocxReader,
		openHtmlReader,
		resumePdfReader,
		resumeDocxReader,
		hidePdfReader,
		hideDocxReader,
		hideHtmlReader
	} = documentReaders;

	const {
		selectedCanvasItems,
		sortSelection,
		shuffleSelection,
		stackSelection,
		spreadSelection,
		sequenceSelection,
		deduplicateSelection,
		keepSelection
	} = selectionOps;

	const keepableSelectionIds = $derived(keepableNoteIds(library.selectionIds, library.notesById));

	async function prepareSessionSwitch() {
		await library.flushPendingSaveAsync();
		library.clearSelection();
		editorStage.dismissAll();
		canvas.expandedNoteId = null;
		peel.clearFilter();
	}

	const finishSessionUi = createFinishSessionUi({
		getFinishSnapshot: () => finishSnapshot,
		setFinishSnapshot: (s) => {
			finishSnapshot = s;
		},
		getActiveSession: () => sessionManager.activeSession,
		getNotes: () => library.notes,
		getNotesById: () => library.notesById,
		getCanvasItems: () => canvas.canvasItems,
		getCanvasEdges: () => canvas.canvasEdges,
		getSelectionIds: () => library.selectionIds,
		getOperations: () => operationHistory,
		flushPendingSaveAsync: () => library.flushPendingSaveAsync(),
		getWriteError: () => library.writeError,
		exportSyncBundle: () => exportSyncBundle(),
		keepTakeaway: (ids) => sessionManager.keepTakeaway(ids),
		keepActive: (now) => sessionManager.keepActive(now),
		clearActive: () => sessionManager.clearActive(),
		switchTo: (id) => sessionManager.switchTo(id),
		restore: (id) => sessionManager.restore(id),
		createScratch: () => sessionManager.createScratch(),
		applyPromotedNotes: (notes) => library.applyPromotedNotes(notes),
		setNotes: (notes) => {
			library.notes = notes;
		},
		loadNotes: () => library.loadNotes(),
		loadContextCanvas: (key, sessionId) => canvas.loadContextCanvas(key, sessionId),
		getCanvasKey: () => peel.canvasKey,
		prepareSessionSwitch,
		setSessionPanelOpen: (open) => {
			sessionPanelOpen = open;
		},
		flashToast,
		askConfirm,
		offerPersistentStorageOnce: () => offerPersistentStorageOnce(),
		getTheme: () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark')
	});

	const {
		runFinishExport,
		runFinishCommit,
		activateSession,
		createScratchSession,
		restoreSession
	} = finishSessionUi;

	const contentOps = createContentOperators({
		flashToast,
		askConfirm,
		getActiveSessionId: () => sessionManager.activeSession?.id,
		getActiveCanvasId: () => canvas.activeCanvas?.id,
		getCanvasFolder: () => peel.canvasFolder,
		activeNoteOwnership,
		getCanvasItems: () => canvas.canvasItems,
		getNotes: () => library.notes,
		getNotesById: () => library.notesById,
		getSelectedNotes: () => library.selectedNotes,
		getSelectionIds: () => library.selectionIds,
		selectedCanvasItems,
		mashCanvasItems: (sourceIds, mashed, opId, place, removeIds) =>
			canvas.mashCanvasItems(sourceIds, mashed, opId, place, removeIds),
		unmashCanvasItem: (mash, sources) => canvas.unmashCanvasItem(mash, sources),
		splitCanvasItem: (sourceNoteId, outputs, opId) =>
			canvas.splitCanvasItem(sourceNoteId, outputs, opId),
		adoptNotes: (notes) => library.adoptNotes(notes),
		setSettlingIds: (ids) => {
			canvas.settlingIds = ids;
		},
		getExpandedNoteId: () => canvas.expandedNoteId,
		setExpandedNoteId: (id) => {
			canvas.expandedNoteId = id;
		},
		dismissPaneForNote: (noteId) => {
			const pane = editorStage.panes.find((p) => p.noteId === noteId);
			if (pane) editorStage.dismissPane(pane.id);
		},
		setSelection: (ids, primary) => {
			library.selectionIds = ids;
			library.selectedId = primary;
		},
		closeBulkMenu: () => {
			library.bulkMenu = null;
		},
		openInStage: (noteId, zone) => openInStage(noteId, zone ?? 'maximize'),
		ensureNoteVisible: (noteId) => {
			canvas.canvasBoard?.ensureNoteVisible(noteId);
		},
		refreshOperationHistory: () => refreshOperationHistory()
	});

	const { splitCandidate, splitSelection, combineSelection, unmashSelection, handleMashCards } =
		contentOps;

	function queueGifExplodeChoice(
		file: File | Blob,
		fileName: string,
		frameCount: number,
		origin?: { x: number; y: number },
		caption?: string
	) {
		gifExplodePending = { blob: file, fileName, frameCount, origin, caption };
	}

	const deskPlacement = createDeskPlacement({
		flashToast,
		getActiveCanvasId: () => canvas.activeCanvas?.id,
		getCanvasFolder: () => peel.canvasFolder,
		activeNoteOwnership,
		getCanvasItemCount: () => canvas.canvasItems.length,
		getSpawnPoint: (size, index) => canvas.canvasBoard?.getSpawnPoint(size, index),
		refreshCanvasItems: () => canvas.refreshCanvasItems(),
		adoptNotesToLibrary: (notes) => {
			for (const note of notes) addNoteToSearch(note);
			library.notes = [...notes, ...library.notes];
		},
		setSelection: (ids, primary) => {
			library.selectionIds = ids;
			library.selectedId = primary;
		},
		setSettlingIds: (ids) => {
			canvas.settlingIds = ids;
		},
		ensureNoteVisible: (noteId) => {
			canvas.canvasBoard?.ensureNoteVisible(noteId);
		},
		recordMeaningfulActivity: () => {
			void sessionManager.recordMeaningfulActivity();
		},
		queueGifExplodeChoice
	});

	const {
		placeNoteDraftsOnDesk,
		placeGifAsDrafts,
		createVisualStickiesFromFiles,
		handleOpenImageFiles
	} = deskPlacement;

	async function queueDelimitedFile(
		file: File,
		origin?: { x: number; y: number }
	): Promise<boolean> {
		if (file.size > FILE_FORMAT_LIMITS.delimitedBytes) {
			flashToast('This table is too large to import safely (max 2 MB).', 3600);
			return false;
		}
		try {
			const text = await file.text();
			const { parseDelimitedText } = await import('$lib/delimited-import');
			const result = parseDelimitedText(text, file.name);
			if (!result.ok) {
				flashToast(result.error, 3600);
				return false;
			}
			delimitedPending = { analysis: result.analysis, origin };
			return true;
		} catch (error) {
			console.error(error);
			flashToast('Couldn’t open this CSV/TSV table.', 3600);
			return false;
		}
	}

	async function importDelimitedChoice(mode: DelimitedImportMode, titleColumn: number) {
		const pending = delimitedPending;
		if (!pending) return;
		const { draftsFromDelimited } = await import('$lib/delimited-import');
		const result = draftsFromDelimited(pending.analysis, mode, titleColumn);
		if (typeof result === 'string') {
			flashToast(result, 4200);
			return;
		}
		delimitedPending = null;
		const notes = await placeNoteDraftsOnDesk(result, pending.origin);
		if (notes.length > 0) {
			flashToast(
				mode === 'table'
					? `Imported ${pending.analysis.rows.length} rows as one table card`
					: `Imported ${notes.length} table row${notes.length === 1 ? '' : 's'} as cards`,
				3600
			);
		}
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

	const pasteHandlers = createGlobalPasteHandler({
		flashToast,
		isPasteBlocked: () =>
			Boolean(
				showPalette ||
				settingsOpen ||
				shortcutsOpen ||
				spacesOverviewOpen ||
				sessionPanelOpen ||
				pasteDialogOpen ||
				Boolean(delimitedPending) ||
				Boolean(workspaceRestorePending) ||
				gifExplodeDialogOpen ||
				documentReaders.documentReaderOpen ||
				editorStage.open
			),
		placeNoteDraftsOnDesk: (drafts) => placeNoteDraftsOnDesk(drafts),
		queueGifExplodeChoice: (file, fileName, frameCount, origin, caption) => {
			queueGifExplodeChoice(file, fileName, frameCount, origin, caption);
		},
		openPasteDialog: (analysis) => {
			pasteAnalysis = analysis;
			pasteDialogOpen = true;
		},
		closePasteDialog: () => {
			pasteDialogOpen = false;
			pasteAnalysis = null;
		}
	});

	const { handleGlobalPaste, createCardsFromPaste } = pasteHandlers;

	const handleKeydown = createAppKeydown({
		canvasUndo: () => canvas.undoCanvasLayout(),
		canvasRedo: () => canvas.redoCanvasLayout(),
		togglePalette: () => {
			showPalette = !showPalette;
			if (showPalette) paletteQuery = '';
		},
		handleNewNote: () => handleNewNote(),
		startTypingNote: (initialBody) => handleNewNote('Untitled', { initialBody, focus: 'body' }),
		canStartTypingNote: () =>
			!(
				showPalette ||
				settingsOpen ||
				shortcutsOpen ||
				spacesOverviewOpen ||
				sessionPanelOpen ||
				pasteDialogOpen ||
				gifExplodeDialogOpen ||
				documentReaders.documentReaderOpen ||
				editorStage.open
			),
		invokeCombineSelection: () => invokeOperatorAction('combine-selection'),
		getSelectionCount: () => library.selectionIds.length,
		getSelectedId: () => library.selectedId,
		getSelectedNote: () => library.selectedNote,
		togglePinSelected: (noteId, pinned) => {
			void library.handleStickyMetaChange(noteId, { pinned });
		},
		openShortcuts: () => {
			shortcutsOpen = true;
		},
		showSpacesOverview,
		focusGlobalSearch: () => {
			(document.getElementById('global-search') as HTMLInputElement)?.focus();
		},
		onEscape: () => {
			if (documentReaders.pdfReaderOpen) {
				hidePdfReader();
				return true;
			}
			if (documentReaders.docxReaderOpen) {
				hideDocxReader();
				return true;
			}
			if (documentReaders.htmlReaderOpen) {
				hideHtmlReader();
				return true;
			}
			if (confirmDialog) {
				confirmDialog = null;
				return true;
			}
			if (spacesOverviewOpen) {
				hideSpacesOverview();
				return true;
			}
			if (shortcutsOpen) {
				shortcutsOpen = false;
				return true;
			}
			if (library.bulkMenu) {
				library.bulkMenu = null;
				return true;
			}
			if (showPalette) {
				showPalette = false;
				return true;
			}
			if (searchDropdownOpen || peel.searchQuery.trim()) {
				closeSearchDropdown(true);
				return true;
			}
			if (editorStage.open) {
				editorStage.dismissAll();
				return true;
			}
			if (canvas.expandedNoteId) {
				canvas.collapseSticky();
				return true;
			}
			if (settingsOpen) {
				settingsOpen = false;
				return true;
			}
			if (peel.peelOpen) {
				peel.closePeel(true);
				return true;
			}
			if (library.selectionIds.length > 0) {
				library.clearSelection();
				return true;
			}
			return false;
		}
	});

	async function adoptClipDraft(draft: Awaited<ReturnType<typeof buildPdfClippingDraft>>) {
		if (!draft) return;
		const note = await createNote({
			...activeNoteOwnership(),
			title: draft.title,
			body: draft.body,
			folder: peel.canvasFolder,
			tags: draft.tags,
			links: [],
			source: draft.source
		});
		addNoteToSearch(note);
		library.notes = [note, ...library.notes];
		return { note, clipping: withNoteId(draft.clipping, note.id), toast: draft.toast };
	}

	async function savePdfClipping(excerpt: PdfClipPayload) {
		const file = documentReaders.pdfReaderFile;
		if (!file) return;
		const draft = await buildPdfClippingDraft(file, excerpt);
		const adopted = await adoptClipDraft(draft);
		if (!adopted) return;
		documentReaders.pdfClippings = [
			...documentReaders.pdfClippings,
			adopted.clipping as import('$lib/pdf-clipping').PdfClipping
		];
		flashToast(adopted.toast);
	}

	async function saveDocxClipping(excerpt: DocxClipPayload) {
		const file = documentReaders.docxReaderFile;
		if (!file) return;
		const draft = buildDocxClippingDraft(file, excerpt);
		const adopted = await adoptClipDraft(draft);
		if (!adopted) return;
		documentReaders.docxClippings = [
			...documentReaders.docxClippings,
			adopted.clipping as import('$lib/docx-clipping').DocxClipping
		];
		flashToast(adopted.toast);
	}

	async function saveHtmlClipping(excerpt: HtmlClipPayload) {
		const file = documentReaders.htmlReaderFile;
		if (!file) return;
		const draft = buildHtmlClippingDraft(file, excerpt);
		const adopted = await adoptClipDraft(draft);
		if (!adopted) return;
		documentReaders.htmlClippings = [
			...documentReaders.htmlClippings,
			adopted.clipping as import('$lib/html-clipping').HtmlClipping
		];
		flashToast(adopted.toast);
	}

	async function openClippingsOnCanvas(noteIds: string[], close: () => void) {
		if (noteIds.length === 0) return;
		const spawn = canvas.canvasBoard?.getSpawnPoint(COLLAPSED_CARD, canvas.canvasItems.length) ?? {
			x: 80,
			y: 80
		};
		close();
		await tick();
		await canvas.handleDropNotes(noteIds, spawn.x, spawn.y);
		flashToast(`Opened ${noteIds.length} clipping${noteIds.length === 1 ? '' : 's'} on canvas`);
	}

	async function openPdfClippingsOnCanvas(noteIds: string[]) {
		await openClippingsOnCanvas(noteIds, () => {
			documentReaders.pdfReaderOpen = false;
		});
	}

	async function openDocxClippingsOnCanvas(noteIds: string[]) {
		await openClippingsOnCanvas(noteIds, () => {
			documentReaders.docxReaderOpen = false;
		});
	}

	async function openHtmlClippingsOnCanvas(noteIds: string[]) {
		await openClippingsOnCanvas(noteIds, () => {
			documentReaders.htmlReaderOpen = false;
		});
	}

	async function handleDroppedFiles(files: File[], x: number, y: number) {
		const { detectJsonImportKind, splitExternalImportFiles } =
			await import('$lib/external-file-drop');
		const batch = splitExternalImportFiles(files);
		const supportedCount =
			batch.noteTextFiles.length +
			batch.jsonFiles.length +
			batch.pdfFiles.length +
			batch.docxFiles.length +
			batch.htmlFiles.length +
			batch.imageFiles.length +
			batch.delimitedFiles.length;
		if (supportedCount === 0) {
			const names = batch.unsupportedFiles.map((f) => f.name).filter(Boolean);
			if (names.length === 1) {
				flashToast(`Can't import ${names[0]} — ${DROP_FORMAT_ERROR_HINT}`, 3600);
			} else {
				flashToast(`Drop ${DROP_FORMAT_HINT}`, 3000);
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
		let queuedTableName = '';

		if (batch.pdfFiles.length > 0) {
			if (openPdfReader(batch.pdfFiles[0]!)) openedDocName = batch.pdfFiles[0]!.name;
			else failedCount++;
			if (batch.pdfFiles.length > 1) failedCount += batch.pdfFiles.length - 1;
			if (batch.docxFiles.length > 0) failedCount += batch.docxFiles.length;
			if (batch.htmlFiles.length > 0) failedCount += batch.htmlFiles.length;
		} else if (batch.docxFiles.length > 0) {
			if (await openDocxReader(batch.docxFiles[0]!)) openedDocName = batch.docxFiles[0]!.name;
			else failedCount++;
			if (batch.docxFiles.length > 1) failedCount += batch.docxFiles.length - 1;
			if (batch.htmlFiles.length > 0) failedCount += batch.htmlFiles.length;
		} else if (batch.htmlFiles.length > 0) {
			if (openHtmlReader(batch.htmlFiles[0]!)) openedDocName = batch.htmlFiles[0]!.name;
			else failedCount++;
			if (batch.htmlFiles.length > 1) failedCount += batch.htmlFiles.length - 1;
		}

		if (batch.imageFiles.length > 0) {
			const imageResult = await createVisualStickiesFromFiles(batch.imageFiles, { x, y });
			imageCreated = imageResult.created;
			imageCompacted = imageResult.compacted;
			failedCount += imageResult.failed;
			if (imageResult.skippedCap > 0) {
				flashToast(
					`Imported ${DESK_IMAGE_MAX_PER_ACTION} of ${batch.imageFiles.length} images`,
					3600
				);
			}
		}

		if (batch.delimitedFiles.length > 0) {
			if (openedDocName) {
				failedCount += batch.delimitedFiles.length;
			} else {
				const tableFile = batch.delimitedFiles[0]!;
				if (await queueDelimitedFile(tableFile, { x, y })) queuedTableName = tableFile.name;
				else failedCount++;
				if (batch.delimitedFiles.length > 1) failedCount += batch.delimitedFiles.length - 1;
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
				if (file.size > FILE_FORMAT_LIMITS.workspaceBackupBytes) {
					failedCount++;
					continue;
				}
				const text = await file.text();
				const kind = detectJsonImportKind(text);
				if (kind !== 'workspace-backup' && file.size > FILE_FORMAT_LIMITS.deskBundleBytes) {
					failedCount++;
				} else if (kind === 'workspace-backup') {
					if (await previewWorkspaceRestoreText(text)) importedFileCount++;
					else failedCount++;
				} else if (kind === 'notes') {
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
		if (queuedTableName) parts.push(`Previewing ${queuedTableName}`);
		if (imageCreated > 0) {
			parts.push(imageCreated === 1 ? 'Added 1 image card' : `Added ${imageCreated} image cards`);
		}
		if (imageCompacted > 0) {
			parts.push(
				imageCompacted === 1
					? 'Image resized for the desk'
					: `${imageCompacted} images resized for the desk`
			);
		}
		if (uniqueNoteIds.length > 0) {
			parts.push(
				`Imported ${uniqueNoteIds.length} note${uniqueNoteIds.length === 1 ? '' : 's'} from ${importedFileCount} file${importedFileCount === 1 ? '' : 's'}`
			);
		}
		if (importedSyncCount > 0) {
			parts.push(`Imported ${importedSyncCount} desk bundle${importedSyncCount === 1 ? '' : 's'}`);
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
			filterPeelNotes(filterNotesByPeelScope(filteredNotes, peelScopeFilter), peel.peelFilterText)
		)
	);
	let peelNotesSubtitle = $derived(
		peel.peelMode === 'notes' && peel.currentFilter.type === null
			? peelScopeSubtitle(peelScopeStats, peelScopeFilter)
			: undefined
	);
	let screenplayChipTitle = $derived(peel.canvasTitle);
	let canvasPlaceCount = $derived(
		canvas.canvasItems.filter((item) => library.notesById.has(item.noteId)).length
	);
	let headerSearchResults = $derived.by(() => {
		if (!peel.searchQuery.trim()) return [];
		const hits = searchNotes(peel.searchQuery).filter((result) => library.notesById.has(result.id));
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

	async function handleNewNote(
		initialTitle = 'Untitled',
		opts: { initialBody?: string; focus?: 'title' | 'body' } = {}
	) {
		const onPinned = peel.currentFilter.type === 'pinned';
		const note = await createNote({
			...activeNoteOwnership(),
			title: initialTitle,
			body: opts.initialBody ?? '',
			folder: peel.currentFilter.type === 'folder' ? peel.currentFilter.value || '' : '',
			links: [],
			pinned: onPinned ? 1 : 0
		});
		addNoteToSearch(note);
		library.notes = [note, ...library.notes];
		void sessionManager.recordMeaningfulActivity();
		if (canvas.activeCanvas) {
			// Settle the current editor before placement so repeated New-note actions
			// cannot rehydrate its expanded dimensions during the canvas refresh.
			await canvas.collapseSticky();
			// Place via drop path (bumps load seq) and expand in-place — stage is for explicit Edit.
			const spawn = canvas.canvasBoard?.getSpawnPoint(EXPANDED_CARD, canvas.canvasItems.length) ?? {
				x: 80,
				y: 80
			};
			await canvas.handleDropNotes([note.id], spawn.x, spawn.y);
			library.selectNote(note.id);
			canvas.expandSticky(note.id, opts.focus ?? 'body');
			await tick();
			canvas.canvasBoard?.frameNoteForEditing?.(note.id);
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

	async function bowlSelection() {
		const bowlId = await canvas.createBowl(library.selectionIds);
		if (!bowlId) return;
		await tick();
		canvas.canvasBoard?.focusBowlName?.(bowlId);
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
			flashToast(notes.length === 1 ? 'PDF downloaded' : `PDF downloaded · ${notes.length} notes`);
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

	const paletteDeps = {
		closePalette: () => {
			showPalette = false;
		},
		handleNewNote,
		clickPdfInput: () => pdfInputEl?.click(),
		clickDocxInput: () => docxInputEl?.click(),
		clickHtmlInput: () => htmlInputEl?.click(),
		clickImageInput: () => imageInputEl?.click(),
		clickDelimitedInput: () => delimitedInputEl?.click(),
		clickWorkspaceRestoreInput: () => workspaceRestoreInputEl?.click(),
		clickImportInput: () => importInputEl?.click(),
		clickMarkdownImportInput: () => markdownImportInputEl?.click(),
		clickSyncInput: () => syncInputEl?.click(),
		showSpacesOverview,
		openSettings: () => {
			peel.closePeel(true);
			settingsOpen = true;
		},
		openShortcuts: () => {
			shortcutsOpen = true;
		},
		copySelection: () => library.copySelection(),
		exportSelectionMarkdown: () => library.exportSelectionMarkdown(),
		exportSelectionJson: () => library.exportSelectionJson(),
		exportSelectionPdf,
		printSelection,
		downloadSelectionMarkdown,
		exportAllJson: () => {
			exportNotesJson(library.notes, 'mash-notes-export.json');
		},
		exportSyncBundle: () => exportSyncBundle(),
		exportWorkspaceBackup: () => exportWorkspaceBackup(),
		getNotes: () => library.notes,
		getSelectionIds: () => library.selectionIds,
		getSelectedId: () => library.selectedId,
		getSelectedNote: () => library.selectedNote,
		getCanUnmash: () => library.canUnmash,
		getNotesById: () => library.notesById,
		selectedCanvasCount: () => selectedCanvasItems().length,
		splitCandidate,
		setBulkMenu: (menu: 'tag' | 'folder' | 'align' | 'operators' | 'mash' | 'more' | null) => {
			library.bulkMenu = menu;
		},
		handleDelete: () => library.handleDelete(),
		handleStickyMetaChange: (id: string, patch: { pinned: 0 | 1 }) =>
			library.handleStickyMetaChange(id, patch),
		clearFilter: () => peel.clearFilter(),
		combineSelection,
		unmashSelection,
		splitSelection,
		stackSelection,
		spreadSelection,
		sequenceSelection,
		sortSelection,
		shuffleSelection,
		deduplicateSelection,
		keepSelection,
		flashToast
	};

	const basePaletteActions = buildBasePaletteActions(paletteDeps);
	const operatorActions = buildOperatorActions(paletteDeps);

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

	type PaletteRow =
		| { kind: 'group'; label: string; id: string }
		| { kind: 'action'; action: (typeof paletteActions)[number]; flatIndex: number }
		| { kind: 'note'; note: Note; flatIndex: number };

	function paletteGroupFor(label: string): string {
		const l = label.toLowerCase();
		if (
			l.includes('import') ||
			l.includes('export') ||
			l.includes('sync') ||
			l.includes('print') ||
			l.includes('pdf') ||
			l.includes('markdown') ||
			l.includes('json') ||
			l.includes('word') ||
			l.includes('html') ||
			l.includes('image') ||
			l.includes('vault')
		) {
			return 'Import · Export';
		}
		if (
			l.includes('mash') ||
			l.includes('unmash') ||
			l.includes('split') ||
			l.includes('sort') ||
			l.includes('shuffle') ||
			l.includes('stack') ||
			l.includes('spread') ||
			l.includes('dedup') ||
			l.includes('sequence') ||
			l.includes('transform') ||
			l.includes('tag selected') ||
			l.includes('folder') ||
			l.includes('copy selected')
		) {
			return 'Transform';
		}
		if (
			l.includes('new note') ||
			l.includes('open ') ||
			l.startsWith('show ') ||
			l.includes('settings') ||
			l.includes('desks') ||
			l.includes('screenplay') ||
			l.includes('shortcut') ||
			l.includes('theme') ||
			l.includes('undo tip')
		) {
			return 'Create · Navigate';
		}
		return 'More';
	}

	let paletteCommandMatches = $derived(
		paletteActions.filter((a) => a.label.toLowerCase().includes(paletteQuery.toLowerCase()))
	);
	let paletteNoteJumps = $derived(
		paletteQuery.length > 1
			? library.notes
					.filter((n: Note) => peelSearchText(n).toLowerCase().includes(paletteQuery.toLowerCase()))
					.slice(0, 6)
			: []
	);
	let paletteRows = $derived.by((): PaletteRow[] => {
		const q = paletteQuery.toLowerCase();
		const matches = paletteActions.filter((a) => a.label.toLowerCase().includes(q));
		// Local aggregation only; this Map never escapes or participates in Svelte reactivity.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const groups = new Map<string, typeof matches>();
		for (const action of matches) {
			const g = paletteGroupFor(action.label);
			const list = groups.get(g) ?? [];
			list.push(action);
			groups.set(g, list);
		}
		const order = ['Create · Navigate', 'Transform', 'Import · Export', 'More'];
		const rows: PaletteRow[] = [];
		let flat = 0;
		for (const name of order) {
			const list = groups.get(name);
			if (!list?.length) continue;
			rows.push({ kind: 'group', label: name, id: name });
			for (const action of list) {
				rows.push({ kind: 'action', action, flatIndex: flat++ });
			}
		}
		if (paletteNoteJumps.length > 0) {
			rows.push({ kind: 'group', label: 'Jump to note', id: 'notes' });
			for (const note of paletteNoteJumps) {
				rows.push({ kind: 'note', note, flatIndex: flat++ });
			}
		}
		return rows;
	});
	let paletteFlatCount = $derived(paletteCommandMatches.length + paletteNoteJumps.length);

	function handlePaletteKeydown(e: KeyboardEvent): void {
		const commands = paletteCommandMatches;
		const noteJumps = paletteNoteJumps;
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
			await refreshWorkspaceBackupHealth();
			if (workspaceBackupReminded || !workspaceBackupHealth.needsBackup) return;
			workspaceBackupReminded = true;
			flashToast('Tip: back up your Mash workspace from Desks or Settings', 4200);
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
	<header class="mash-app-header flex items-center justify-between px-5 py-1.5">
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
					class="mash-type-caption mt-1 font-medium tracking-[0.14em] uppercase"
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
					class="mash-focus mash-header-search mash-type-body w-full rounded-lg border py-2 pr-14 pl-9 transition-colors"
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
					class="mash-type-micro pointer-events-none absolute top-1/2 right-2.5 hidden -translate-y-1/2 items-center gap-0.5 rounded border px-1.5 py-0.5 font-medium sm:flex"
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
					class="mash-btn mash-focus mash-type-caption inline-flex h-[38px] items-center rounded-[11px] px-3.5 font-semibold"
					onclick={() => openSessionPanel('finish')}
					onpointerenter={preloadSessionPanel}
					onfocus={preloadSessionPanel}
				>
					Finish
				</button>
			{/if}
			<div class="mash-header-utils">
				<button
					type="button"
					class="mash-reader-launch mash-focus"
					class:is-active={documentReaders.pdfReaderOpen}
					class:has-session={Boolean(documentReaders.pdfReaderFile) &&
						!documentReaders.pdfReaderOpen}
					onclick={() => (documentReaders.pdfReaderFile ? resumePdfReader() : pdfInputEl?.click())}
					aria-label={documentReaders.pdfReaderFile ? 'Return to PDF reader' : 'Open PDF reader'}
					title={documentReaders.pdfReaderFile
						? `Return to ${documentReaders.pdfReaderFile.name}`
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
			<div
				class="mash-type-caption hidden items-center gap-1 lg:flex"
				style="color: var(--mash-ink-muted);"
			>
				<kbd
					class="mash-type-micro flex items-center gap-0.5 rounded border px-1.5 py-0.5 font-medium"
					style="border-color: var(--mash-tray-edge);"
				>
					<Command class="h-2.5 w-2.5" />K
				</kbd>
			</div>
		</div>
	</header>

	{#if library.loadError}
		<div
			class="mash-type-caption flex items-center justify-between gap-3 border-b px-4 py-2"
			style="border-color: var(--mash-tray-edge); background: var(--mash-danger-wash); color: var(--mash-ink);"
		>
			<span>{library.loadError}</span>
			<button
				type="button"
				class="mash-btn mash-type-caption rounded-md px-2.5 py-1 font-semibold"
				onclick={() => void library.loadNotes()}
			>
				Retry
			</button>
		</div>
	{/if}
	{#if library.writeError}
		<div
			class="mash-type-caption flex flex-wrap items-center gap-2 border-b px-4 py-2"
			style="border-color: var(--mash-tray-edge); background: var(--mash-danger-wash); color: var(--mash-ink);"
			role="alert"
		>
			<span class="min-w-0 flex-1">{library.writeError}</span>
			<button
				type="button"
				class="mash-btn-ghost mash-type-caption rounded-md px-2.5 py-1 font-semibold"
				onclick={() => void library.retryPendingWrites()}
			>
				Retry save
			</button>
			<button
				type="button"
				class="mash-btn-ghost mash-type-caption rounded-md px-2.5 py-1 font-semibold"
				onclick={() => void library.copySelection(library.notes)}
			>
				Copy desk
			</button>
			<button
				type="button"
				class="mash-btn mash-type-caption rounded-md px-2.5 py-1 font-semibold"
				onclick={() => exportNotesJson(library.notes, 'mash-emergency-export.json')}
			>
				Emergency export
			</button>
		</div>
	{/if}

	<!-- Full-bleed canvas stage -->
	<div class="relative flex min-h-0 flex-1">
		<div class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
			{#if !documentReaders.documentReaderOpen}
				<div
					class="mash-canvas-title-chip is-spaces-trigger mash-type-caption absolute top-3 left-[4.75rem] z-10 rounded-full border px-3 py-1 backdrop-blur-sm"
					class:pointer-events-none={spacesOverviewOpen}
					style="border-color: var(--mash-chrome-chip-border); background: var(--mash-chrome-chip-soft); color: var(--mash-chrome-muted);"
					role="button"
					tabindex="0"
					aria-label="Open desks"
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
				{#if documentReaders.pdfReaderFile && !documentReaders.pdfReaderOpen}
					<button
						type="button"
						class="mash-reader-return mash-focus"
						onclick={resumePdfReader}
						title={`Return to ${documentReaders.pdfReaderFile.name}`}
					>
						<BookOpen class="h-4 w-4 shrink-0" strokeWidth={2} />
						<span>Return to PDF</span>
						<small>{documentReaders.pdfReaderFile.name}</small>
					</button>
				{:else if documentReaders.docxReaderFile && !documentReaders.docxReaderOpen}
					<button
						type="button"
						class="mash-reader-return mash-focus"
						onclick={resumeDocxReader}
						title={`Return to ${documentReaders.docxReaderFile.name}`}
					>
						<BookOpen class="h-4 w-4 shrink-0" strokeWidth={2} />
						<span>Return to Word</span>
						<small>{documentReaders.docxReaderFile.name}</small>
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
					bowls={canvas.canvasBowls}
					onSelectBowl={canvas.selectBowl}
					onRenameBowl={(bowlId, name) => canvas.renameBowl(bowlId, name)}
					onDissolveBowl={(bowlId) => canvas.dissolveBowl(bowlId)}
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
					{showTryAMash}
					tryAMash={runTryAMash}
					{tryAMashBusy}
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
				{#if documentReaders.pdfReaderFile && documentReaders.LazyPdfReader}
					{#key documentReaders.pdfReaderFile}
						{@const PdfReaderComp = documentReaders.LazyPdfReader}
						<PdfReaderComp
							file={documentReaders.pdfReaderFile}
							clippings={documentReaders.pdfClippings}
							open={documentReaders.pdfReaderOpen}
							initialPage={documentReaders.pdfReaderView.page}
							initialZoom={documentReaders.pdfReaderView.zoom}
							onClose={hidePdfReader}
							onClip={savePdfClipping}
							onOpenClippings={openPdfClippingsOnCanvas}
							onViewChange={(view: { page: number; zoom: number }) =>
								(documentReaders.pdfReaderView = view)}
						/>
					{/key}
				{:else if documentReaders.pdfReaderOpen}
					<section class="mash-pdf-reader" aria-label="PDF reader">
						<div
							class="mash-type-body flex h-full items-center justify-center"
							style="color: var(--mash-ink-muted);"
						>
							Loading PDF tools…
						</div>
					</section>
				{/if}
				{#if documentReaders.docxReaderFile && documentReaders.LazyDocxReader}
					{#key documentReaders.docxReaderFile}
						{@const DocxReaderComp = documentReaders.LazyDocxReader}
						<DocxReaderComp
							file={documentReaders.docxReaderFile}
							clippings={documentReaders.docxClippings}
							open={documentReaders.docxReaderOpen}
							onClose={hideDocxReader}
							onClip={saveDocxClipping}
							onOpenClippings={openDocxClippingsOnCanvas}
						/>
					{/key}
				{:else if documentReaders.docxReaderOpen}
					<section class="mash-pdf-reader" aria-label="Word document reader">
						<div
							class="mash-type-body flex h-full items-center justify-center"
							style="color: var(--mash-ink-muted);"
						>
							Loading Word document tools…
						</div>
					</section>
				{/if}
				{#if documentReaders.htmlReaderFile && documentReaders.LazyHtmlReader}
					{#key documentReaders.htmlReaderFile}
						{@const HtmlReaderComp = documentReaders.LazyHtmlReader}
						<HtmlReaderComp
							file={documentReaders.htmlReaderFile}
							clippings={documentReaders.htmlClippings}
							open={documentReaders.htmlReaderOpen}
							onClose={hideHtmlReader}
							onClip={saveHtmlClipping}
							onOpenClippings={openHtmlClippingsOnCanvas}
						/>
					{/key}
				{:else if documentReaders.htmlReaderOpen}
					<section class="mash-pdf-reader" aria-label="HTML document reader">
						<div
							class="mash-type-body flex h-full items-center justify-center"
							style="color: var(--mash-ink-muted);"
						>
							Loading HTML document tools…
						</div>
					</section>
				{/if}
				{#if !documentReaders.documentReaderOpen}
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
				{#await import('$lib/components/SettingsPanel.svelte') then mod}
					<mod.default
						{snapEnabled}
						lastExportAt={syncHygiene.lastExportAt}
						lastImportAt={syncHygiene.lastImportAt}
						workspaceBackupStatus={workspaceBackupHealth.label}
						{workspaceBackupBusy}
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
						onOpenDelimited={() => {
							settingsOpen = false;
							delimitedInputEl?.click();
						}}
						onBackupWorkspace={() => exportWorkspaceBackup()}
						onRestoreWorkspace={() => workspaceRestoreInputEl?.click()}
						conflictCount={syncConflicts.count}
						onOpenConflicts={() => {
							settingsOpen = false;
							peel.openPeel('conflicts');
						}}
					/>
				{/await}
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
					onScopeFilter={peel.currentFilter.type === null
						? (scope) => {
								peelScopeFilter = scope;
							}
						: undefined}
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
				<div class="mash-type-caption font-semibold" style="color: var(--mash-card-ink);">
					{ghostNote?.title ?? 'Note'}
				</div>
				<div class="mash-type-micro mt-0.5" style="color: var(--mash-card-muted);">
					Drop on canvas
				</div>
			</div>
		{/if}

		{#if (library.selectionIds.length > 0 || latestKitchenReceipt) && !documentReaders.documentReaderOpen}
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
							class="mash-type-micro mb-2 font-medium tracking-wide uppercase"
							style="color: var(--mash-accent-bright);"
						>
							Tag {library.selectionIds.length} note{library.selectionIds.length === 1 ? '' : 's'}
						</div>
						<input
							type="text"
							bind:value={library.bulkTagDraft}
							placeholder="new tag…"
							class="mash-focus mash-type-caption mb-2 w-full rounded-md border bg-transparent px-2 py-1.5 outline-none"
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
									class="mash-chip mash-chip-hover mash-type-micro rounded-full px-2 py-0.5"
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
							class="mash-type-micro mb-2 font-medium tracking-wide uppercase"
							style="color: var(--mash-accent-bright);"
						>
							Move {library.selectionIds.length} to folder
						</div>
						<input
							type="text"
							bind:value={library.bulkFolderDraft}
							placeholder="new or existing folder…"
							class="mash-focus mash-type-caption mb-2 w-full rounded-md border bg-transparent px-2 py-1.5 outline-none"
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
							<span class="mash-type-caption">No folder</span>
						</button>
						<div class="max-h-28 overflow-auto">
							{#each library.uniqueFolders as folder (folder)}
								<button
									type="button"
									class="mash-peel-meta-row"
									onclick={() => library.assignFolderToSelection(folder)}
								>
									<Folder class="h-3.5 w-3.5 shrink-0 opacity-60" />
									<span class="mash-type-caption truncate">{folder}</span>
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
							class="mash-btn-ghost mash-type-caption rounded-lg px-3 py-2 text-left"
							onclick={() => (library.bulkMenu = 'tag')}
						>
							<strong class="flex items-center gap-1.5"><Tag class="h-3.5 w-3.5" /> Tag…</strong>
							<small style="color: var(--mash-ink-muted);">Add or apply tags</small>
						</button>
						<button
							type="button"
							class="mash-btn-ghost mash-type-caption rounded-lg px-3 py-2 text-left"
							onclick={() => (library.bulkMenu = 'folder')}
						>
							<strong class="flex items-center gap-1.5"
								><Folder class="h-3.5 w-3.5" /> Folder…</strong
							>
							<small style="color: var(--mash-ink-muted);">Move to a folder</small>
						</button>
						<button
							type="button"
							class="mash-btn-ghost mash-type-caption rounded-lg px-3 py-2 text-left"
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
							class="mash-btn-ghost mash-type-caption rounded-lg px-3 py-2 text-left"
							onclick={downloadSelectionMarkdown}
						>
							<strong class="flex items-center gap-1.5"
								><Download class="h-3.5 w-3.5" /> Download Markdown</strong
							>
							<small style="color: var(--mash-ink-muted);">Save as a .md file</small>
						</button>
						<button
							type="button"
							class="mash-btn-ghost mash-type-caption rounded-lg px-3 py-2 text-left"
							onclick={() => void exportSelectionPdf()}
						>
							<strong class="flex items-center gap-1.5"
								><FileDown class="h-3.5 w-3.5" /> Export PDF</strong
							>
							<small style="color: var(--mash-ink-muted);">Quick export · or use Finish</small>
						</button>
						<button
							type="button"
							class="mash-btn-ghost mash-type-caption rounded-lg px-3 py-2 text-left"
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
										class="mash-type-micro font-semibold tracking-wide uppercase"
										style="color: var(--mash-accent-bright);">{section.label}</span
									>
									<span class="mash-type-micro truncate" style="color: var(--mash-ink-muted);"
										>{section.hint}</span
									>
								</div>
								<div class="grid grid-cols-1 gap-1 sm:grid-cols-2">
									{#each section.actions as operator (operator.id)}
										<button
											type="button"
											class="mash-btn-ghost mash-type-caption rounded-lg px-3 py-2 text-left"
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
							<p
								class="mash-type-caption px-2 py-3 text-center"
								style="color: var(--mash-ink-muted);"
							>
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
						class="mash-dock mash-selection-bar flex items-center gap-1 rounded-2xl border px-2 py-1.5 shadow-xl"
						style="border-color: var(--mash-panel-border); background: var(--mash-panel); backdrop-filter: blur(10px);"
					>
						<span
							class="mash-type-micro px-2 font-medium tracking-wide uppercase"
							style="color: var(--mash-accent-bright);"
						>
							{library.selectionIds.length} selected
						</span>
						{#if keepableSelectionIds.length > 0}
							<button
								type="button"
								data-testid="keep-selection"
								onclick={() => void keepSelection()}
								class="mash-btn-ghost mash-selection-primary mash-type-caption flex items-center gap-1 rounded-xl px-2.5 py-1.5"
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
								class="mash-btn mash-selection-primary mash-type-caption flex items-center gap-1.5 rounded-xl px-3 py-1.5 font-semibold"
								title="Combine into one sticky — sources leave the desk until Unmash"
								data-testid="selection-mash"
							>
								<Combine class="h-3.5 w-3.5" />
								Mash
							</button>
						{/if}
						{#if library.selectionIds.length >= 2}
							<button
								type="button"
								onclick={() => void bowlSelection()}
								class="mash-btn-ghost mash-selection-secondary mash-type-caption flex items-center gap-1 rounded-xl px-2.5 py-1.5"
								title="Group selected cards in a temporary bowl"
								data-testid="selection-bowl"
							>
								<IceCreamBowl class="h-3.5 w-3.5" />
								Bowl
							</button>
						{/if}
						{#if kitchenMenuSections.length > 0}
							<button
								type="button"
								onclick={() =>
									(library.bulkMenu = library.bulkMenu === 'operators' ? null : 'operators')}
								class="mash-btn-ghost mash-selection-secondary mash-type-caption flex items-center gap-1 rounded-xl px-2.5 py-1.5 {library.bulkMenu ===
								'operators'
									? 'border-[var(--mash-accent)] text-[var(--mash-accent-bright)]'
									: ''}"
								title="Operator kitchen — shape or arrange the selected set"
								data-testid="operator-kitchen-toggle"
							>
								<Sparkles class="h-3.5 w-3.5" />
								Transform
							</button>
						{/if}
						{#if library.selectionIds.length >= 2}
							<button
								type="button"
								onclick={() => (library.bulkMenu = library.bulkMenu === 'align' ? null : 'align')}
								class="mash-btn-ghost mash-selection-secondary mash-type-caption flex items-center gap-1 rounded-xl px-2.5 py-1.5 {library.bulkMenu ===
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
								class="mash-btn-ghost mash-type-caption flex items-center gap-1 rounded-xl px-2.5 py-1.5"
								title="Edit the first two selected notes side by side"
							>
								<Columns2 class="h-3.5 w-3.5" />
								Split
							</button>
						{:else if editorStage.open}
							<button
								type="button"
								onclick={openBesideSelection}
								class="mash-btn-ghost mash-type-caption flex items-center gap-1 rounded-xl px-2.5 py-1.5"
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
								class="mash-btn-ghost mash-type-caption flex items-center gap-1 rounded-xl px-2.5 py-1.5"
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
								class="mash-btn-ghost mash-type-caption flex items-center gap-1 rounded-xl px-2.5 py-1.5"
								title="Restore source notes and remove mash"
							>
								Unmash
							</button>
						{/if}
						<button
							type="button"
							onclick={toggleMoreMenu}
							class="mash-btn-ghost mash-type-caption flex items-center gap-1 rounded-xl px-2.5 py-1.5 {library.bulkMenu ===
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
							class="mash-btn-ghost mash-type-caption flex items-center gap-1 rounded-xl px-2.5 py-1.5 hover:text-[var(--mash-danger)]"
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
						class="mash-focus mash-type-body w-full rounded bg-transparent px-1 outline-none"
						style="color: var(--mash-ink);"
						role="combobox"
						aria-expanded="true"
						aria-controls="mash-palette-listbox"
						aria-activedescendant={paletteFlatCount > 0
							? `mash-palette-option-${paletteHighlight}`
							: undefined}
						aria-autocomplete="list"
						onkeydown={handlePaletteKeydown}
					/>
				</div>
				<div
					id="mash-palette-listbox"
					role="listbox"
					aria-label="Commands"
					class="mash-type-body max-h-80 overflow-auto p-1"
				>
					{#if paletteFlatCount === 0}
						<div
							class="mash-type-caption px-3 py-4 text-center"
							style="color: var(--mash-ink-muted);"
						>
							No commands match
						</div>
					{:else}
						{#each paletteRows as row (row.kind === 'group' ? `g-${row.id}` : row.kind === 'action' ? `a-${row.action.label}` : `n-${row.note.id}`)}
							{#if row.kind === 'group'}
								<div
									class="mash-type-micro mt-1 border-t px-3 pt-2 pb-0.5 font-medium tracking-wide uppercase first:mt-0 first:border-t-0"
									style="border-color: var(--mash-tray-edge); color: var(--mash-ink-muted);"
								>
									{row.label}
								</div>
							{:else if row.kind === 'action'}
								<button
									id="mash-palette-option-{row.flatIndex}"
									role="option"
									aria-selected={row.flatIndex === paletteHighlight}
									onclick={() => {
										showPalette = false;
										void row.action.action();
									}}
									class="mash-row-hover flex w-full items-center justify-between rounded px-3 py-2 text-left {row.flatIndex ===
									paletteHighlight
										? 'mash-row-active'
										: ''}"
								>
									<span>{row.action.label}</span>
									<span class="mash-type-caption" style="color: var(--mash-ink-muted);"
										>{row.action.shortcut}</span
									>
								</button>
							{:else}
								<button
									id="mash-palette-option-{row.flatIndex}"
									role="option"
									aria-selected={row.flatIndex === paletteHighlight}
									onclick={() => {
										void canvas.openStickyFromTray(row.note.id);
										showPalette = false;
									}}
									class="mash-row-hover mash-type-caption flex w-full items-center justify-between rounded px-3 py-1.5 text-left {row.flatIndex ===
									paletteHighlight
										? 'mash-row-active'
										: ''}"
								>
									<span class="truncate">{row.note.title}</span>
									<span class="mash-type-micro" style="color: var(--mash-ink-muted);"
										>{row.note.folder}</span
									>
								</button>
							{/if}
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
		accept={FILE_ACCEPT.json}
		class="hidden"
		onchange={(e) => void library.handleImportFile(e)}
	/>
	<input
		bind:this={pdfInputEl}
		data-testid="pdf-reader-input"
		type="file"
		accept={FILE_ACCEPT.pdf}
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
		accept={FILE_ACCEPT.docx}
		class="hidden"
		onchange={(e) => {
			const input = e.currentTarget as HTMLInputElement;
			const file = input.files?.[0];
			input.value = '';
			if (file) void openDocxReader(file);
		}}
	/>
	<input
		bind:this={htmlInputEl}
		data-testid="html-reader-input"
		type="file"
		accept={FILE_ACCEPT.html}
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
		accept={FILE_ACCEPT.images}
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
		bind:this={delimitedInputEl}
		data-testid="delimited-import-input"
		type="file"
		accept={FILE_ACCEPT.delimited}
		class="hidden"
		onchange={(e) => {
			const input = e.currentTarget as HTMLInputElement;
			const file = input.files?.[0];
			input.value = '';
			if (file) void queueDelimitedFile(file);
		}}
	/>
	<input
		bind:this={markdownImportInputEl}
		data-testid="markdown-import"
		type="file"
		accept={FILE_ACCEPT.markdownVault}
		multiple
		webkitdirectory
		class="hidden"
		onchange={(e) => void library.handleMarkdownImport(e)}
	/>
	<input
		bind:this={syncInputEl}
		data-testid="sync-import"
		type="file"
		accept={FILE_ACCEPT.json}
		class="hidden"
		onchange={async (e) => {
			await library.handleSyncFile(e);
			refreshSyncHygiene();
		}}
	/>
	<input
		bind:this={workspaceRestoreInputEl}
		data-testid="workspace-restore-input"
		type="file"
		accept={FILE_ACCEPT.json}
		class="hidden"
		onchange={handleWorkspaceRestoreFile}
	/>

	{#if actionToast}
		<div
			role="status"
			aria-live="polite"
			aria-atomic="true"
			data-testid="action-status"
			class="mash-type-caption pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg border px-3 py-1.5 shadow-lg"
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
		illustration={confirmDialog?.confirmLabel === 'Delete'
			? '/icons/New%20Icons/holding-trash-bag@2x.png'
			: undefined}
		onConfirm={() => void runConfirmDialog()}
		onCancel={() => (confirmDialog = null)}
	/>

	{#if shortcutsOpen}
		{#await import('$lib/components/ShortcutsModal.svelte') then mod}
			<mod.default open={shortcutsOpen} onClose={() => (shortcutsOpen = false)} />
		{/await}
	{/if}
	{#if spacesOverviewOpen}
		{#await import('$lib/components/SpacesOverview.svelte') then mod}
			<mod.default
				sessionId={sessionManager.activeSession?.id}
				openKeys={spaces.openKeys}
				activeKey={peel.canvasKey}
				activeItems={canvas.canvasItems}
				onClose={hideSpacesOverview}
				onSwitch={switchSpace}
				onCloseSpace={(key) => spaces.closeSpace(key)}
			/>
		{/await}
	{/if}
	{#if sessionPanelOpen}
		{#await import('$lib/components/SessionPanel.svelte') then mod}
			<mod.default
				open={sessionPanelOpen}
				initialView={sessionPanelView}
				activeSession={sessionManager.activeSession}
				activeSessions={sessionManager.activeSessions}
				recoveringSessions={sessionManager.recoveringSessions}
				retentionDays={sessionManager.retentionDays}
				{finishSnapshot}
				notesById={library.notesById}
				{storageHealth}
				workspaceBackupStatus={workspaceBackupHealth.label}
				{workspaceBackupBusy}
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
				onBackupWorkspace={() => exportWorkspaceBackup()}
			/>
		{/await}
	{/if}
	{#if pasteDialogOpen}
		{#await import('$lib/components/PasteChoiceDialog.svelte') then mod}
			<mod.default
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
		{/await}
	{/if}
	{#if gifExplodeDialogOpen}
		{#await import('$lib/components/GifExplodeDialog.svelte') then mod}
			<mod.default
				open={gifExplodeDialogOpen}
				fileName={gifExplodePending?.fileName ?? ''}
				frameCount={gifExplodePending?.frameCount ?? 0}
				onChoose={(mode) => void handleGifExplodeChoice(mode)}
				onClose={() => {
					gifExplodePending = null;
				}}
			/>
		{/await}
	{/if}
	{#if delimitedPending}
		{#await import('$lib/components/DelimitedImportDialog.svelte') then mod}
			<mod.default
				open={Boolean(delimitedPending)}
				analysis={delimitedPending.analysis}
				onChoose={(mode, titleColumn) => void importDelimitedChoice(mode, titleColumn)}
				onClose={() => {
					delimitedPending = null;
				}}
			/>
		{/await}
	{/if}
	{#if workspaceRestorePending}
		{#await import('$lib/components/WorkspaceRestoreDialog.svelte') then mod}
			<mod.default
				open={Boolean(workspaceRestorePending)}
				backup={workspaceRestorePending.backup}
				plan={workspaceRestorePending.plan}
				busy={workspaceBackupBusy}
				error={workspaceRestoreError}
				onConfirm={() => void confirmWorkspaceRestore()}
				onClose={() => {
					if (workspaceBackupBusy) return;
					workspaceRestorePending = null;
					workspaceRestoreError = '';
				}}
			/>
		{/await}
	{/if}
</div>
