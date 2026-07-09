/**
 * Note library — filter helpers + reactive selection / sticky-save store.
 */
import {
	createNote,
	db,
	deleteNote,
	getActiveNotes,
	syncNoteUpdate
} from '$lib/db';
import {
	initSearchIndex,
	updateNoteInSearch,
	addNoteToSearch,
	removeNoteFromSearch,
	searchNotes
} from '$lib/search';
import type { Note } from '$lib/types';
import type { NavFilter } from '$lib/note-ui';
import { extractWikilinks } from '$lib/markdown';
import { parseNotesJson } from '$lib/import-notes';
import {
	combineNotes,
	copyText,
	exportNotesJson,
	exportNotesMarkdown,
	notesFromSelection
} from '$lib/mash';
import {
	parseSyncBundle,
	mergeSyncBundle,
	applyDeskSnapshot,
	formatConflictSummary
} from '$lib/sync-file';
import type { SyncConflict } from '$lib/sync-model';

export function filterNotes(
	notes: Note[],
	currentFilter: NavFilter,
	searchQuery: string
): Note[] {
	let list = [...notes];

	list = list.filter((n) => {
		if (currentFilter.type === 'pinned') return n.pinned === 1;
		if (currentFilter.type === 'folder' && currentFilter.value) {
			return n.folder === currentFilter.value || n.folder.startsWith(currentFilter.value + '/');
		}
		if (currentFilter.type === 'tag' && currentFilter.value) {
			return n.tags.includes(currentFilter.value);
		}
		return true;
	});

	if (searchQuery.trim()) {
		const results = searchNotes(searchQuery, {
			folder: currentFilter.type === 'folder' ? currentFilter.value : undefined,
			tags:
				currentFilter.type === 'tag' && currentFilter.value ? [currentFilter.value] : undefined
		});
		const idSet = new Set(results.map((r) => r.id));
		list = list.filter((n) => idSet.has(n.id));
	}

	list.sort((a, b) => {
		if (a.pinned !== b.pinned) return b.pinned - a.pinned;
		return b.modified - a.modified;
	});
	return list;
}

export function filterPeelNotes(notes: Note[], peelFilterText: string): Note[] {
	const q = peelFilterText.trim().toLowerCase();
	if (!q) return notes;
	return notes.filter(
		(n) =>
			n.title.toLowerCase().includes(q) ||
			n.body.toLowerCase().includes(q) ||
			n.folder.toLowerCase().includes(q) ||
			n.tags.some((t) => t.toLowerCase().includes(q))
	);
}

export function uniqueFoldersFrom(notes: Note[]): string[] {
	return [...new Set(notes.map((n) => n.folder).filter(Boolean))].sort();
}

export function uniqueTagsFrom(notes: Note[]): string[] {
	return [...new Set(notes.flatMap((n) => n.tags))].sort();
}

export function canvasFolderFromFilter(filter: NavFilter): string {
	return filter.type === 'folder' && filter.value !== undefined ? filter.value : '';
}

export function canvasTitleFromFilter(filter: NavFilter): string {
	if (filter.type === 'folder' && filter.value) return filter.value;
	return 'Desk';
}

export type CreateNoteLibraryOpts = {
	flashToast: (msg: string, ms?: number) => void;
	askConfirm: (opts: {
		title: string;
		message: string;
		confirmLabel?: string;
		danger?: boolean;
		action: () => void | Promise<void>;
	}) => void;
	getActiveCanvasId: () => string | null;
	onFolderDeleted: (folder: string) => Promise<void>;
	clearExpandedIfNote?: (noteId: string) => void;
	/** Ordered note ids for shift-click range selection (filtered peel list). */
	getFilteredNoteIds: () => string[];
	/** Sync page canvas items after notes are deleted from the library. */
	onNotesDeleted?: (ids: string[]) => void;
	/** Clear peel filter when it matches a removed tag. */
	onTagDeleted?: (tag: string) => void;
	/** Called after sync applies desk layout so the open canvas reloads. */
	onDeskSynced?: () => void | Promise<void>;
};

export function createNoteLibrary(opts: CreateNoteLibraryOpts) {
	let notes = $state<Note[]>([]);
	let selectedId = $state<string | null>(null);
	let selectionIds = $state<string[]>([]);
	let bulkMenu = $state<'tag' | 'folder' | 'align' | null>(null);
	let bulkTagDraft = $state('');
	let bulkFolderDraft = $state('');
	let isLoading = $state(true);
	let loadError = $state('');
	let saveStatus = $state<'saved' | 'saving' | ''>('');

	const stickySaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
	const stickyPendingPatches = new Map<string, Partial<Note>>();
	let stickySaveStatusClear: ReturnType<typeof setTimeout> | null = null;

	const selectedNote = $derived(notes.find((n) => n.id === selectedId) ?? null);
	const selectionSet = $derived(new Set(selectionIds));
	const selectedNotes = $derived(notesFromSelection(notes, selectionIds));
	const notesById = $derived(new Map(notes.map((n) => [n.id, n])));
	const uniqueFolders = $derived(uniqueFoldersFrom(notes));
	const uniqueTags = $derived(uniqueTagsFrom(notes));
	const canUnmash = $derived(
		selectedNotes.some((n) => Boolean(n.mashedFrom && n.mashedFrom.length > 0))
	);

	function clearSelection() {
		selectionIds = [];
		bulkMenu = null;
	}

	function toggleSelection(id: string, selOpts?: { additive?: boolean; range?: boolean }) {
		const additive = selOpts?.additive ?? false;
		const range = selOpts?.range ?? false;

		if (range && selectedId) {
			const ids = opts.getFilteredNoteIds();
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

	function selectNote(id: string, selOpts?: { keepSelection?: boolean }) {
		if (selectedId && selectedId !== id) flushPendingSave();
		selectedId = id;
		if (!selOpts?.keepSelection) {
			selectionIds = [id];
		}
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

	async function copySelection(sourceNotes: Note[] = selectedNotes) {
		if (sourceNotes.length === 0) {
			opts.flashToast('Select notes to copy');
			return;
		}
		const ok = await copyText(combineNotes(sourceNotes));
		opts.flashToast(
			ok
				? `Copied ${sourceNotes.length} note${sourceNotes.length > 1 ? 's' : ''}`
				: 'Clipboard unavailable'
		);
	}

	function exportSelectionMarkdown(sourceNotes: Note[] = selectedNotes) {
		if (sourceNotes.length === 0) {
			opts.flashToast('Select notes to export');
			return;
		}
		exportNotesMarkdown(sourceNotes);
		opts.flashToast(`Exported ${sourceNotes.length} as Markdown`);
	}

	function exportSelectionJson(sourceNotes: Note[] = selectedNotes) {
		if (sourceNotes.length === 0) {
			opts.flashToast('Select notes to export');
			return;
		}
		exportNotesJson(sourceNotes);
		opts.flashToast(`Exported ${sourceNotes.length} as JSON`);
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

	function scheduleStickyPersist(noteId: string, patch: Partial<Note>, updated: Note) {
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

	function handleVisibilityChange(): void {
		if (document.visibilityState === 'hidden') flushPendingSave();
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
					body: 'Mash is where notes go to become useful.\n\nDrag notes from the peel onto the desk. Select a few, then Mash, Copy, or Export.\n\nTry a [[Project ideas]] link in preview mode — missing links ask before creating.',
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
			opts.flashToast(loadError);
		}
		isLoading = false;
	}

	async function handleSyncFile(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		try {
			const text = await file.text();
			if (text.length > 8_000_000) {
				opts.flashToast('Sync file too large');
				return;
			}
			const parsed = parseSyncBundle(text);
			if (!parsed.ok) {
				opts.flashToast(parsed.error);
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

			let deskPart = '';
			if (parsed.bundle.desk) {
				try {
					const deskSummary = await applyDeskSnapshot(
						parsed.bundle.desk,
						new Set(mergedNotes.map((n) => n.id))
					);
					summary.desk = deskSummary;
					deskPart = ` · desk ${deskSummary.itemsUpserted} placements`;
					await opts.onDeskSynced?.();
				} catch {
					deskPart = ' · desk apply failed';
				}
			}

			const conflictFields = [
				...new Set(summary.conflicts.map((c) => `${c.noteId}:${c.field}`))
			];
			opts.flashToast(
				`Sync: ${summary.added} added · ${summary.updated} updated` +
					deskPart +
					(conflictFields.length ? ` · ${conflictFields.length} conflicts` : ''),
				3200
			);

			if (summary.conflicts.length > 0) {
				await resolveBodyConflicts(summary.conflicts, mergedNotes);
			}
		} catch {
			opts.flashToast('Sync import failed');
		}
	}

	/**
	 * For body conflicts where LWW kept remote: offer restoring local body.
	 * Cancel / dismiss keeps remote (already applied). Confirm restores local.
	 */
	function resolveBodyConflicts(conflicts: SyncConflict[], mergedNotes: Note[]) {
		const bodyConflicts = conflicts.filter((c) => c.field === 'body' && c.chosen === 'remote');
		if (bodyConflicts.length === 0) {
			if (conflicts.length > 0) {
				opts.askConfirm({
					title: 'Sync conflicts (LWW)',
					message:
						'Some fields differed on both devices. Last-writer-wins kept one side:\n\n' +
						formatConflictSummary(conflicts),
					confirmLabel: 'OK',
					danger: false,
					action: () => {}
				});
			}
			return;
		}

		const first = bodyConflicts[0];
		const note = mergedNotes.find((n) => n.id === first.noteId);
		const title = note?.title ?? first.noteId.slice(0, 8);
		const localBody = typeof first.local === 'string' ? first.local : '';

		opts.askConfirm({
			title: 'Keep remote body?',
			message:
				`“${title}” had conflicting body text. Sync kept the remote version.\n\n` +
				`Choose Restore local to put your previous text back, or Cancel to keep remote.\n\n` +
				formatConflictSummary(conflicts, 4),
			confirmLabel: 'Restore local',
			danger: false,
			action: async () => {
				const target = notes.find((n) => n.id === first.noteId);
				if (!target) return;
				const updated = {
					...target,
					body: localBody,
					links: extractWikilinks(localBody),
					modified: Date.now()
				};
				await db.notes.put(updated);
				notes = notes.map((n) => (n.id === updated.id ? updated : n));
				updateNoteInSearch(updated, updated);
				opts.flashToast(`Restored local body on “${title}”`);
			}
		});
	}

	async function handleImportFile(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		try {
			const text = await file.text();
			if (text.length > 8_000_000) {
				opts.flashToast('Import file too large');
				return;
			}
			const result = parseNotesJson(text);
			if (!result.ok) {
				opts.flashToast(result.error);
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
			opts.flashToast(
				added === result.notes.length
					? `Imported ${added} notes`
					: `Imported ${result.notes.length} notes (${added} new)`
			);
		} catch (err) {
			console.error(err);
			opts.flashToast('Import failed');
		}
	}

	async function handleDelete() {
		const ids = selectionIds.length > 0 ? [...selectionIds] : selectedId ? [selectedId] : [];
		if (ids.length === 0) return;
		opts.askConfirm({
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
					opts.clearExpandedIfNote?.(id);
				}
				const idSet = new Set(ids);
				notes = notes.filter((n) => !idSet.has(n.id));
				opts.onNotesDeleted?.(ids);
				selectionIds = [];
				selectedId = notes[0]?.id ?? null;
				if (selectedId) selectNote(selectedId);
				bulkMenu = null;
				opts.flashToast(ids.length === 1 ? 'Note deleted' : `${ids.length} notes deleted`);
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
		opts.flashToast(`Tagged ${selectionIds.length} with #${t}`);
	}

	function assignFolderToSelection(folder: string) {
		const f = folder.trim();
		if (selectionIds.length === 0) return;
		for (const id of selectionIds) {
			applyNotePatch(id, { folder: f });
		}
		bulkFolderDraft = '';
		bulkMenu = null;
		opts.flashToast(
			f ? `Moved ${selectionIds.length} to ${f}` : `Cleared folder on ${selectionIds.length}`
		);
	}

	async function deleteFolder(folder: string) {
		const matching = notes.filter(
			(n) => n.folder === folder || n.folder.startsWith(folder + '/')
		);
		opts.askConfirm({
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
				await opts.onFolderDeleted(folder);
				opts.flashToast(`Folder “${folder}” removed`);
			}
		});
	}

	async function deleteTag(tag: string) {
		const matching = notes.filter((n) => n.tags.includes(tag));
		opts.askConfirm({
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
				opts.onTagDeleted?.(tag);
				opts.flashToast(`Tag #${tag} removed`);
			}
		});
	}

	return {
		get notes() {
			return notes;
		},
		set notes(v: Note[]) {
			notes = v;
		},
		get selectedId() {
			return selectedId;
		},
		set selectedId(v: string | null) {
			selectedId = v;
		},
		get selectionIds() {
			return selectionIds;
		},
		set selectionIds(v: string[]) {
			selectionIds = v;
		},
		get bulkMenu() {
			return bulkMenu;
		},
		set bulkMenu(v: 'tag' | 'folder' | 'align' | null) {
			bulkMenu = v;
		},
		get bulkTagDraft() {
			return bulkTagDraft;
		},
		set bulkTagDraft(v: string) {
			bulkTagDraft = v;
		},
		get bulkFolderDraft() {
			return bulkFolderDraft;
		},
		set bulkFolderDraft(v: string) {
			bulkFolderDraft = v;
		},
		get isLoading() {
			return isLoading;
		},
		set isLoading(v: boolean) {
			isLoading = v;
		},
		get loadError() {
			return loadError;
		},
		set loadError(v: string) {
			loadError = v;
		},
		get saveStatus() {
			return saveStatus;
		},
		set saveStatus(v: 'saved' | 'saving' | '') {
			saveStatus = v;
		},
		get selectedNote() {
			return selectedNote;
		},
		get selectionSet() {
			return selectionSet;
		},
		get selectedNotes() {
			return selectedNotes;
		},
		get notesById() {
			return notesById;
		},
		get uniqueFolders() {
			return uniqueFolders;
		},
		get uniqueTags() {
			return uniqueTags;
		},
		get canUnmash() {
			return canUnmash;
		},
		clearSelection,
		toggleSelection,
		handleNoteClick,
		selectNote,
		loadNotes,
		applyNotePatch,
		tagSelection,
		assignFolderToSelection,
		handleDelete,
		deleteFolder,
		deleteTag,
		copySelection,
		exportSelectionMarkdown,
		exportSelectionJson,
		handleStickyTitleChange,
		handleStickyBodyChange,
		handleStickyMetaChange,
		scheduleStickyPersist,
		markStickySaving,
		markStickySaved,
		flushPendingSave,
		handleVisibilityChange,
		handleImportFile,
		handleSyncFile
	};
}
