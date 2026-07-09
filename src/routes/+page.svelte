<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { addNoteToCanvas, createNote, db, deleteNote, removeCanvasItem } from '$lib/db';
	import { addNoteToSearch, removeNoteFromSearch } from '$lib/search';
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
		LayoutGrid
	} from 'lucide-svelte';
	import MashDock from '$lib/components/MashDock.svelte';
	import PeelScanner from '$lib/components/PeelScanner.svelte';
	import CanvasBoard from '$lib/components/CanvasBoard.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
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
	let syncInputEl: HTMLInputElement | undefined = $state();

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

	const library = createNoteLibrary({
		flashToast,
		askConfirm,
		getActiveCanvasId: () => canvasHolder.session?.activeCanvas?.id ?? null,
		getFilteredNoteIds: () => filteredNotes.map((n) => n.id),
		clearExpandedIfNote: (noteId) => {
			if (canvas.expandedNoteId === noteId) canvas.expandedNoteId = null;
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
		},
		onTagDeleted: (tag) => {
			if (peel.currentFilter.type === 'tag' && peel.currentFilter.value === tag) {
				peel.clearFilter();
			}
		},
		onDeskSynced: async () => {
			await canvas.loadContextCanvas(peel.canvasFolder);
		}
	});

	const peel = createPeelNav({
		clearSelection: () => library.clearSelection(),
		newNote: () => void handleNewNote(),
		getExpandedNoteId: () => canvasHolder.session?.expandedNoteId ?? null,
		getSelectedId: () => library.selectedId,
		getFirstNoteId: () => library.notes[0]?.id ?? null
	});

	const canvas = createCanvasSession({
		flashToast,
		getNotes: () => library.notes,
		getNotesById: () => library.notesById,
		getCanvasFolder: () => peel.canvasFolder,
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
		}
	});
	canvasHolder.session = canvas;

	let filteredNotes = $derived(
		filterNotes(library.notes, peel.currentFilter, peel.searchQuery)
	);
	let peelNotes = $derived(filterPeelNotes(filteredNotes, peel.peelFilterText));
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
		canvas.clearCanvasUndo();

		const item = await addNoteToCanvas(canvas.activeCanvas.id, mashed.id, {
			x: placeX,
			y: placeY,
			w: EXPANDED_CARD.w,
			h: EXPANDED_CARD.h
		});
		await canvas.refreshCanvasItems();
		library.selectionIds = [mashed.id];
		library.selectedId = mashed.id;
		canvas.expandedNoteId = mashed.id;
		canvas.settlingIds = new Set([item.id]);
		setTimeout(() => {
			canvas.settlingIds = new Set();
		}, 320);
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
					x: baseX + i * 28,
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

		// If the dragged card is part of a multi-selection that includes the target,
		// mash the whole selection. Otherwise mash just the two overlapped cards.
		const pairNoteIds = new Set([source.noteId, target.noteId]);
		const selectionIncludesPair =
			library.selectionSet.has(source.noteId) &&
			library.selectionSet.has(target.noteId) &&
			library.selectionIds.length >= 2;

		const mashNoteIds = selectionIncludesPair
			? [...new Set(library.selectionIds)]
			: [...pairNoteIds];

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
		const note = await createNote({
			title: 'Untitled',
			body: '',
			folder: peel.currentFilter.type === 'folder' ? peel.currentFilter.value || '' : '',
			links: []
		});
		addNoteToSearch(note);
		library.notes = [note, ...library.notes];
		if (canvas.activeCanvas) {
			const spawn =
				canvas.canvasBoard?.getSpawnPoint(EXPANDED_CARD, canvas.canvasItems.length) ?? {
					x: 80,
					y: 80
				};
			const item = await addNoteToCanvas(canvas.activeCanvas.id, note.id, {
				x: spawn.x,
				y: spawn.y,
				w: EXPANDED_CARD.w,
				h: EXPANDED_CARD.h
			});
			await canvas.refreshCanvasItems();
			library.selectNote(note.id);
			canvas.expandFocus = 'title';
			canvas.expandedNoteId = note.id;
			canvas.bumpNeighborsAround(item.id, EXPANDED_CARD);
			canvas.settlingIds = new Set([item.id, ...canvas.settlingIds]);
			setTimeout(() => {
				canvas.settlingIds = new Set();
			}, 320);
			return;
		}
		library.selectNote(note.id);
		canvas.expandFocus = 'title';
		canvas.expandedNoteId = note.id;
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
				if (e.shiftKey) canvas.redoCanvasLayout();
				else canvas.undoCanvasLayout();
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
			if (library.bulkMenu) {
				library.bulkMenu = null;
				return;
			}
			if (showPalette) {
				showPalette = false;
				return;
			}
			if (canvas.expandedNoteId) {
				canvas.collapseSticky();
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
				void downloadSyncBundle(library.notes).then(() => {
					flashToast('Exported sync bundle (notes + desk)');
				});
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
		void library.loadNotes();
		window.addEventListener('keydown', handleKeydown);
		window.addEventListener('pagehide', library.flushPendingSave);
		document.addEventListener('visibilitychange', library.handleVisibilityChange);
		return () => {
			window.removeEventListener('keydown', handleKeydown);
			window.removeEventListener('pagehide', library.flushPendingSave);
			document.removeEventListener('visibilitychange', library.handleVisibilityChange);
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
					bind:value={peel.searchQuery}
					oninput={peel.handleGlobalSearch}
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

	{#if library.loadError}
		<div
			class="flex items-center justify-between gap-3 border-b px-4 py-2 text-xs"
			style="border-color: var(--mash-tray-edge); background: rgba(196,92,74,0.15); color: var(--mash-ink);"
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
			<div
				class="mash-canvas-title-chip pointer-events-none absolute top-3 left-[4.75rem] z-10 rounded-full border px-3 py-1 text-[10px] backdrop-blur-sm"
				style="border-color: rgba(80,60,30,0.18); background: rgba(247,241,230,0.72); color: var(--mash-card-muted);"
			>
				<span class="mash-display font-medium" style="color: var(--mash-card-ink);">{peel.canvasTitle}</span>
				<span class="mx-1.5 opacity-40">·</span>
				{canvas.canvasItems.length} on canvas
			</div>

			<div class="relative min-h-0 flex-1 overflow-hidden">
				<CanvasBoard
					bind:this={canvas.canvasBoard}
					items={canvas.canvasItems}
					notesById={library.notesById}
					selectedIds={library.selectionSet}
					expandedNoteId={canvas.expandedNoteId}
					expandFocus={canvas.expandFocus}
					settlingIds={canvas.settlingIds}
					canvasId={canvas.activeCanvas?.id ?? null}
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
					onTitleChange={library.handleStickyTitleChange}
					onBodyChange={library.handleStickyBodyChange}
					onMetaChange={library.handleStickyMetaChange}
					onWikilink={(target) => void openWikilink(target)}
					onOpenLinks={peel.openLinkedPeel}
					folders={library.uniqueFolders}
					onDropNotes={canvas.handleDropNotes}
					onMashCards={handleMashCards}
					onBlankPointerDown={() => peel.closePeel()}
					canUndo={canvas.canCanvasUndo}
					canRedo={canvas.canCanvasRedo}
					onUndo={canvas.undoCanvasLayout}
					onRedo={canvas.redoCanvasLayout}
				/>
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
				dockSelect={peel.handleDockAction}
			/>
		</div>
		{#if peel.peelOpen}
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
				/>
			</div>
		{/if}

		{#if canvas.touchPlaceGhost}
			{@const ghostNote = library.notesById.get(canvas.touchPlaceGhost.noteId)}
			<div
				class="pointer-events-none fixed z-50 w-[180px] rounded-xl border px-3 py-2 shadow-xl"
				style="left: {canvas.touchPlaceGhost.clientX - 40}px; top: {canvas.touchPlaceGhost.clientY - 20}px; border-color: rgba(80,60,30,0.25); background: rgba(247,241,230,0.95);"
			>
				<div class="text-xs font-semibold" style="color: var(--mash-card-ink);">
					{ghostNote?.title ?? 'Note'}
				</div>
				<div class="mt-0.5 text-[10px]" style="color: var(--mash-card-muted);">Drop on canvas</div>
			</div>
		{/if}

		{#if library.selectionIds.length > 0}
			<div
				class="mash-selection-bar absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-2"
				class:mash-selection-bar--peel={peel.peelOpen}
			>
				{#if library.bulkMenu === 'tag'}
					<div
						class="w-64 rounded-xl border p-3 shadow-xl"
						style="border-color: rgba(80,60,30,0.2); background: rgba(28, 24, 18, 0.95); backdrop-filter: blur(10px);"
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
									class="mash-chip rounded-full px-2 py-0.5 text-[10px] hover:bg-white/10"
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
						style="border-color: rgba(80,60,30,0.2); background: rgba(28, 24, 18, 0.95); backdrop-filter: blur(10px);"
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
						style="border-color: rgba(80,60,30,0.2); background: rgba(28, 24, 18, 0.95); backdrop-filter: blur(10px);"
						role="toolbar"
						aria-label="Align selected"
					>
						<button
							type="button"
							class="mash-align-btn"
							onclick={() => canvas.canvasBoard?.applyAlign('left')}
							title="Align left"
							aria-label="Align left"
						>
							<AlignLeft class="h-3.5 w-3.5" />
						</button>
						<button
							type="button"
							class="mash-align-btn"
							onclick={() => canvas.canvasBoard?.applyAlign('center')}
							title="Align center"
							aria-label="Align center"
						>
							<AlignCenter class="h-3.5 w-3.5" />
						</button>
						<button
							type="button"
							class="mash-align-btn"
							onclick={() => canvas.canvasBoard?.applyAlign('right')}
							title="Align right"
							aria-label="Align right"
						>
							<AlignRight class="h-3.5 w-3.5" />
						</button>
						<button
							type="button"
							class="mash-align-btn"
							onclick={() => canvas.canvasBoard?.applyAlign('top')}
							title="Align top"
							aria-label="Align top"
						>
							<AlignStartVertical class="h-3.5 w-3.5" />
						</button>
						<button
							type="button"
							class="mash-align-btn"
							onclick={() => canvas.canvasBoard?.applyAlign('middle')}
							title="Align middle"
							aria-label="Align middle"
						>
							<AlignCenterVertical class="h-3.5 w-3.5" />
						</button>
						<button
							type="button"
							class="mash-align-btn"
							onclick={() => canvas.canvasBoard?.applyAlign('bottom')}
							title="Align bottom"
							aria-label="Align bottom"
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
					style="border-color: rgba(80,60,30,0.2); background: rgba(28, 24, 18, 0.92); backdrop-filter: blur(10px);"
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
							title="Align selected"
						>
							<AlignLeft class="h-3.5 w-3.5" />
							Align
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
		data-testid="notes-import"
		type="file"
		accept="application/json,.json"
		class="hidden"
		onchange={(e) => void library.handleImportFile(e)}
	/>
	<input
		bind:this={syncInputEl}
		data-testid="sync-import"
		type="file"
		accept="application/json,.json"
		class="hidden"
		onchange={(e) => void library.handleSyncFile(e)}
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
