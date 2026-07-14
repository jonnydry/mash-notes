/* eslint-disable svelte/prefer-svelte-reactivity -- Collections are derived snapshots or private indexes whose updates are signaled through surrounding state. */
/**
 * Note library — filter helpers + reactive selection / sticky-save store.
 */
import {
	createNote,
	db,
	deleteNote,
	getActiveNotes,
	KEPT_COLLECTION_SESSION_ID,
	replaceNoteSubset,
	syncNoteUpdateAsync
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
import { NOTES_IMPORT_MAX_CHARS, parseNotesJson } from '$lib/import-notes';
import { filesFromFileList, parseMarkdownVault } from '$lib/import-markdown';
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
	persistMergedSync,
	formatConflictSummary,
	SYNC_BUNDLE_MAX_CHARS
} from '$lib/sync-file';
import type { SyncConflict } from '$lib/sync-model';
import { isStaleSyncBundle, recordSyncImport } from '$lib/sync-hygiene';
import {
	ensureMashTeamWelcomeNote,
	isMashTeamWelcomeCandidate,
	isMashTeamWelcomeNote
} from '$lib/system-notes';

export function filterNotes(notes: Note[], currentFilter: NavFilter, searchQuery: string): Note[] {
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
			tags: currentFilter.type === 'tag' && currentFilter.value ? [currentFilter.value] : undefined
		});
		const idSet = new Set(results.map((r) => r.id));
		list = list.filter((n) => idSet.has(n.id));
	}

	list.sort((a, b) => {
		const aSystem = a.system === 'mash-team-welcome';
		const bSystem = b.system === 'mash-team-welcome';
		if (aSystem !== bSystem) return aSystem ? -1 : 1;
		if (a.pinned !== b.pinned) return b.pinned - a.pinned;
		return b.modified - a.modified;
	});
	return list;
}

/** Text used for peel quick-filter — never lowercases multi‑MB image bodies. */
export function peelSearchText(note: Note): string {
	const title = note.title;
	const folder = note.folder;
	const tags = note.tags.join(' ');
	const body = note.body;
	if (body.startsWith('![') && (body.includes('data:image') || body.includes('mash-blob:'))) {
		const close = body.indexOf(')');
		const altEnd = body.indexOf('](');
		const alt = altEnd > 2 ? body.slice(2, altEnd) : '';
		const caption = close >= 0 ? body.slice(close + 1, close + 1 + 400) : '';
		return `${title} ${folder} ${tags} ${alt} ${caption}`;
	}
	// Cap body scan so large notes stay responsive
	return `${title} ${folder} ${tags} ${body.slice(0, 4_000)}`;
}

export function filterPeelNotes(notes: Note[], peelFilterText: string): Note[] {
	const q = peelFilterText.trim().toLowerCase();
	if (!q) return notes;
	return notes.filter((n) => peelSearchText(n).toLowerCase().includes(q));
}

export function uniqueFoldersFrom(notes: Note[]): string[] {
	return [...new Set(notes.map((n) => n.folder).filter(Boolean))].sort();
}

export function uniqueTagsFrom(notes: Note[]): string[] {
	return [...new Set(notes.flatMap((n) => n.tags))].sort();
}

/** Reserved canvas.folder key for the Pinned desk (not a real note folder). */
export const PINNED_CANVAS_KEY = '__mash_pinned__';

export function isPinnedCanvasKey(key: string): boolean {
	return key === PINNED_CANVAS_KEY;
}

/** Dexie canvas key for the current nav filter (desk / folder / pinned). */
export function canvasKeyFromFilter(filter: NavFilter): string {
	if (filter.type === 'pinned') return PINNED_CANVAS_KEY;
	if (filter.type === 'folder' && filter.value !== undefined) return filter.value;
	return '';
}

/** Real note.folder for create/mash — never the reserved pinned canvas key. */
export function canvasFolderFromFilter(filter: NavFilter): string {
	return filter.type === 'folder' && filter.value !== undefined ? filter.value : '';
}

export function canvasTitleFromFilter(filter: NavFilter): string {
	if (filter.type === 'pinned') return 'Pinned';
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
	getActiveSessionId?: () => string | null;
	getActiveSessionMode?: () => 'scratch' | 'kept';
	shouldSeedWelcome?: () => boolean;
	onMeaningfulActivity?: () => void;
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
	/** Open Conflicts peel after sync (wired by page). */
	onSyncConflicts?: (conflicts: SyncConflict[]) => void;
	/** Clear pending conflicts for a note when the user edits it. */
	onNoteEdited?: (noteId: string) => void;
};

export function createNoteLibrary(opts: CreateNoteLibraryOpts) {
	let notes = $state<Note[]>([]);
	let selectedId = $state<string | null>(null);
	let selectionIds = $state<string[]>([]);
	let bulkMenu = $state<'tag' | 'folder' | 'align' | 'operators' | 'mash' | 'more' | null>(null);
	let bulkTagDraft = $state('');
	let bulkFolderDraft = $state('');
	let isLoading = $state(true);
	let loadError = $state('');
	let saveStatus = $state<'saved' | 'saving' | ''>('');
	let writeError = $state('');

	const stickySaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
	const stickyPendingPatches = new Map<string, Partial<Note>>();
	let stickySaveStatusClear: ReturnType<typeof setTimeout> | null = null;
	let notesLoadSeq = 0;

	/** Id→note map kept in sync on patch so sticky keystrokes do not rebuild O(n) maps. */
	let notesById = $state(new Map<string, Note>());

	function rebuildNotesById(list: Note[]) {
		notesById = new Map(list.map((n) => [n.id, n]));
	}

	function setNotes(list: Note[]) {
		notes = list;
		rebuildNotesById(list);
	}

	/** Replace one note without remapping the rest of the library array objects. */
	function patchNote(noteId: string, updated: Note) {
		const i = notes.findIndex((n) => n.id === noteId);
		if (i < 0) return;
		const next = notes.slice();
		next[i] = updated;
		notes = next;
		const map = new Map(notesById);
		map.set(noteId, updated);
		notesById = map;
	}

	const selectedNote = $derived(notesById.get(selectedId ?? '') ?? null);
	const selectionSet = $derived(new Set(selectionIds));
	const selectedNotes = $derived(notesFromSelection(notes, selectionIds));
	const uniqueFolders = $derived(uniqueFoldersFrom(notes));
	const uniqueTags = $derived(uniqueTagsFrom(notes));
	const canUnmash = $derived(
		selectedNotes.some((n) =>
			Boolean(n.tags.includes('mash') && n.mashedFrom && n.mashedFrom.length > 0)
		)
	);

	function plainNoteSnapshot(note: Note): Note {
		return {
			...note,
			tags: [...note.tags],
			...(note.links ? { links: [...note.links] } : {}),
			...(note.mashedFrom ? { mashedFrom: [...note.mashedFrom] } : {}),
			...(note.source ? { source: { ...note.source } } : {})
		};
	}

	function clearSelection() {
		selectionIds = [];
		bulkMenu = null;
	}

	/** Add already-persisted operation outputs to reactive library/search state. */
	function adoptNotes(nextNotes: Note[]) {
		if (nextNotes.length === 0) return;
		const ids = new Set(nextNotes.map((note) => note.id));
		for (const note of nextNotes) addNoteToSearch(note);
		setNotes([
			...nextNotes.map((note) => ({ ...note })),
			...notes.filter((note) => !ids.has(note.id))
		]);
	}

	/** Apply persisted scope/retention changes without disturbing selection or ordering. */
	function applyPromotedNotes(promoted: Note[]) {
		if (promoted.length === 0) return;
		const byId = new Map(promoted.map((note) => [note.id, note]));
		for (const note of promoted) updateNoteInSearch(note, note);
		setNotes(notes.map((note) => byId.get(note.id) ?? note));
	}

	/** Restore/remove generated notes as part of a canvas content receipt. */
	async function applyNoteReceipt(
		notesBefore: Note[] | undefined,
		notesAfter: Note[] | undefined,
		direction: 'before' | 'after'
	) {
		if (!notesBefore && !notesAfter) return;
		const affectedIds = [
			...new Set([...(notesBefore ?? []), ...(notesAfter ?? [])].map((note) => note.id))
		];
		const desired = (direction === 'before' ? (notesBefore ?? []) : (notesAfter ?? [])).map(
			plainNoteSnapshot
		);
		await replaceNoteSubset(affectedIds, desired);
		for (const id of affectedIds) removeNoteFromSearch(id);
		for (const note of desired) addNoteToSearch(note);
		const desiredIds = new Set(desired.map((note) => note.id));
		for (const id of affectedIds) {
			if (!desiredIds.has(id)) opts.clearExpandedIfNote?.(id);
		}
		const affected = new Set(affectedIds);
		setNotes([...desired, ...notes.filter((note) => !affected.has(note.id))]);
		selectionIds = selectionIds.filter((id) => !affected.has(id));
		if (selectedId && affected.has(selectedId)) selectedId = null;
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

	function reportWriteFailure(noteId: string, patch: Partial<Note>, error: unknown) {
		console.error('Mash note write failed', error);
		stickyPendingPatches.set(noteId, {
			...(stickyPendingPatches.get(noteId) ?? {}),
			...patch
		});
		saveStatus = '';
		writeError = 'Changes are still open in memory, but this browser could not save them locally.';
	}

	async function persistNotePatch(noteId: string, patch: Partial<Note>) {
		try {
			await syncNoteUpdateAsync(noteId, patch);
			writeError = '';
			markStickySaved();
		} catch (error) {
			reportWriteFailure(noteId, patch, error);
		}
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
				void persistNotePatch(noteId, pending);
				updateNoteInSearch({ id: noteId, ...pending }, latest);
			}, 400)
		);
	}

	function handleStickyTitleChange(noteId: string, title: string) {
		const note = notesById.get(noteId) ?? notes.find((n) => n.id === noteId);
		if (!note) return;
		if (isMashTeamWelcomeNote(note)) return;
		const updated = { ...note, title, modified: Date.now() };
		patchNote(noteId, updated);
		opts.onNoteEdited?.(noteId);
		opts.onMeaningfulActivity?.();
		scheduleStickyPersist(noteId, { title }, updated);
	}

	function handleStickyBodyChange(noteId: string, body: string) {
		const note = notesById.get(noteId) ?? notes.find((n) => n.id === noteId);
		if (!note) return;
		if (isMashTeamWelcomeNote(note)) return;
		// Image bodies have no wikilinks — skip body matchAll.
		const links =
			body.startsWith('![') && (body.includes('data:image') || body.includes('mash-blob:'))
				? (note.links ?? [])
				: extractWikilinks(body);
		const updated = { ...note, body, links, modified: Date.now() };
		patchNote(noteId, updated);
		opts.onNoteEdited?.(noteId);
		opts.onMeaningfulActivity?.();
		scheduleStickyPersist(noteId, { body, links }, updated);
	}

	function handleStickyMetaChange(
		noteId: string,
		patch: {
			folder?: string;
			tags?: string[];
			pinned?: 0 | 1;
			textAlign?: 'left' | 'center' | 'right';
		}
	) {
		const note = notesById.get(noteId) ?? notes.find((n) => n.id === noteId);
		if (!note) return;
		if (isMashTeamWelcomeNote(note)) return;
		const updated = { ...note, ...patch, modified: Date.now() };
		patchNote(noteId, updated);
		opts.onNoteEdited?.(noteId);
		opts.onMeaningfulActivity?.();
		scheduleStickyPersist(noteId, patch, updated);
	}

	function flushPendingSave(): void {
		void flushPendingSaveAsync();
	}

	async function flushPendingSaveAsync(): Promise<void> {
		const pendingIds = [...new Set([...stickySaveTimers.keys(), ...stickyPendingPatches.keys()])];
		let failed = false;
		for (const noteId of pendingIds) {
			const timer = stickySaveTimers.get(noteId);
			if (timer) clearTimeout(timer);
			stickySaveTimers.delete(noteId);
			const pending = stickyPendingPatches.get(noteId);
			stickyPendingPatches.delete(noteId);
			const note = notes.find((n) => n.id === noteId);
			if (!note) continue;
			const patch: Partial<Note> = pending ?? {
				title: note.title,
				body: note.body,
				folder: note.folder,
				tags: note.tags,
				pinned: note.pinned,
				links: note.links,
				textAlign: note.textAlign,
				source: note.source
			};
			try {
				await syncNoteUpdateAsync(noteId, patch);
			} catch (error) {
				failed = true;
				reportWriteFailure(noteId, patch, error);
			}
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
		if (!failed) {
			writeError = '';
			markStickySaved();
		}
	}

	async function retryPendingWrites() {
		markStickySaving();
		await flushPendingSaveAsync();
	}

	function handleVisibilityChange(): void {
		if (document.visibilityState === 'hidden') flushPendingSave();
	}

	async function loadNotes() {
		const seq = ++notesLoadSeq;
		const expectedSessionId = opts.getActiveSessionId?.() ?? undefined;
		isLoading = true;
		loadError = '';
		try {
			// One-shot: move legacy data-URL image bodies into noteBlobs, then
			// reclaim any orphans left by prior rotate/purge gaps.
			try {
				const { migrateDataUrlBodiesToBlobs, gcOrphanNoteBlobs } = await import('$lib/note-blobs');
				await migrateDataUrlBodiesToBlobs();
				await gcOrphanNoteBlobs();
			} catch (e) {
				console.error('Image blob migration failed', e);
			}
			if (seq !== notesLoadSeq) return;
			await initSearchIndex();
			if (seq !== notesLoadSeq) return;
			const sessionId = expectedSessionId;
			const onKeptCollection = sessionId === KEPT_COLLECTION_SESSION_ID;
			const sessionMode = opts.getActiveSessionMode?.();
			let loaded = await getActiveNotes({
				limit: 10000,
				sessionId,
				keptCollection: onKeptCollection,
				// Scratch desks see their ingredients plus the kept pantry.
				includeKeptPantry: Boolean(sessionId && !onKeptCollection && sessionMode !== 'kept')
			});
			if (seq !== notesLoadSeq) return;
			if ((opts.getActiveSessionId?.() ?? undefined) !== expectedSessionId) return;
			const wasEmpty =
				loaded.filter((n) => n.scope !== 'kept' || n.sessionId === sessionId).length === 0;
			const teamNote = await ensureMashTeamWelcomeNote();
			if (seq !== notesLoadSeq) return;
			updateNoteInSearch(teamNote, teamNote);
			loaded = [teamNote, ...loaded.filter((note) => !isMashTeamWelcomeCandidate(note))];

			if (wasEmpty && (opts.shouldSeedWelcome?.() ?? true)) {
				const scope = opts.getActiveSessionMode?.() === 'kept' ? 'kept' : 'session';
				const seed2 = await createNote({
					title: 'Project ideas',
					body: '- Build the thing\n- Talk to users\n- Ship fast',
					tags: ['project'],
					folder: 'Ideas',
					sessionId,
					scope
				});
				if (seq !== notesLoadSeq) return;
				addNoteToSearch(seed2);
				const seed3 = await createNote({
					title: 'Meeting scraps',
					body: 'Decide on the export format.\nFollow up with design on the workbench.',
					tags: ['meeting'],
					folder: 'Ideas',
					sessionId,
					scope
				});
				if (seq !== notesLoadSeq) return;
				addNoteToSearch(seed3);
				loaded = [teamNote, seed2, seed3];
			}

			if (seq !== notesLoadSeq) return;
			if ((opts.getActiveSessionId?.() ?? undefined) !== expectedSessionId) return;
			setNotes(
				loaded.map((n) => ({
					...n,
					links: n.links?.length
						? n.links
						: n.body.startsWith('![') &&
							  (n.body.includes('data:image') || n.body.includes('mash-blob:'))
							? []
							: extractWikilinks(n.body)
				}))
			);
		} catch (e) {
			if (seq !== notesLoadSeq) return;
			console.error('Failed to load notes', e);
			loadError = 'Couldn’t load notes. Check storage permissions and retry.';
			opts.flashToast(loadError);
		}
		if (seq === notesLoadSeq) isLoading = false;
	}

	async function importSyncText(
		text: string,
		importOpts?: { force?: boolean }
	): Promise<{
		ok: boolean;
		message: string;
		added?: number;
		updated?: number;
	}> {
		try {
			if (text.length > SYNC_BUNDLE_MAX_CHARS) {
				const message = 'Sync file too large';
				opts.flashToast(message);
				return { ok: false, message };
			}
			const parsed = parseSyncBundle(text);
			if (!parsed.ok) {
				opts.flashToast(parsed.error);
				return { ok: false, message: parsed.error };
			}

			if (!importOpts?.force && isStaleSyncBundle(parsed.bundle.exportedAt)) {
				opts.askConfirm({
					title: 'Older desk bundle?',
					message:
						'This file is older than your last export on this device. Importing may overwrite newer notes with older ones.\n\nImport anyway?',
					confirmLabel: 'Import anyway',
					danger: false,
					action: async () => {
						await importSyncText(text, { force: true });
					}
				});
				return { ok: false, message: 'Waiting for stale-import confirmation' };
			}

			await flushPendingSaveAsync();

			const { notes: mergedNotes, summary } = mergeSyncBundle(notes, parsed.bundle);
			const sessionId = opts.getActiveSessionId?.() ?? undefined;
			const defaultScope: NonNullable<Note['scope']> =
				opts.getActiveSessionMode?.() === 'kept' ? 'kept' : 'session';
			const localById = new Map(notes.map((n) => [n.id, n]));
			// Dexie can't structured-clone Svelte $state proxies — always put plain objects.
			// Preserve kept pantry ownership: do not demote durable kept notes onto this scratch.
			const plainNotes = mergedNotes.map((n) => {
				const local = localById.get(n.id);
				const isKept =
					n.scope === 'kept' ||
					local?.scope === 'kept' ||
					Boolean(n.keptAt) ||
					Boolean(local?.keptAt);
				return {
					...n,
					sessionId: isKept
						? (n.sessionId ?? local?.sessionId ?? sessionId)
						: (sessionId ?? n.sessionId),
					scope: isKept ? 'kept' : (n.scope ?? defaultScope),
					keptAt: isKept ? (n.keptAt ?? local?.keptAt) : n.keptAt,
					tags: [...n.tags],
					...(n.links ? { links: [...n.links] } : {}),
					...(n.mashedFrom ? { mashedFrom: [...n.mashedFrom] } : {})
				};
			});
			const knownNoteIds = new Set(plainNotes.map((n) => n.id));

			const persisted = await persistMergedSync(
				plainNotes,
				parsed.bundle.desk,
				knownNoteIds,
				sessionId,
				parsed.bundle.operations ?? [],
				parsed.bundle.blobs ?? []
			);
			// Older bundles may still carry data-URL images — migrate after import.
			try {
				const { migrateDataUrlBodiesToBlobs, gcOrphanNoteBlobs } = await import('$lib/note-blobs');
				await migrateDataUrlBodiesToBlobs();
				await gcOrphanNoteBlobs();
			} catch {
				/* non-fatal */
			}
			if (persisted.desk) summary.desk = persisted.desk;

			const teamNote = await ensureMashTeamWelcomeNote();
			const effectiveNotes = [
				teamNote,
				...plainNotes.filter((note) => !isMashTeamWelcomeCandidate(note))
			];
			setNotes(effectiveNotes.filter((n) => n.deletedAt == null));
			for (const n of effectiveNotes) {
				removeNoteFromSearch(n.id);
				if (n.deletedAt == null) addNoteToSearch(n);
			}

			let deskPart = '';
			if (persisted.desk) {
				deskPart = ` · desk ${persisted.desk.itemsUpserted} placements`;
				await opts.onDeskSynced?.();
			}

			recordSyncImport(parsed.bundle.exportedAt);

			const conflictFields = [...new Set(summary.conflicts.map((c) => `${c.noteId}:${c.field}`))];
			const removedPart = summary.removed > 0 ? ` · ${summary.removed} removed` : '';
			const operationPart =
				persisted.operationsUpserted > 0
					? ` · ${persisted.operationsUpserted} result receipt${persisted.operationsUpserted === 1 ? '' : 's'}`
					: '';
			const message =
				`Sync: ${summary.added} added · ${summary.updated} updated` +
				removedPart +
				deskPart +
				operationPart +
				(conflictFields.length ? ` · ${conflictFields.length} conflicts` : '');
			opts.flashToast(message, 3200);

			if (summary.conflicts.length > 0) {
				if (opts.onSyncConflicts) {
					opts.onSyncConflicts(summary.conflicts);
				} else {
					await resolveBodyConflicts(summary.conflicts, mergedNotes);
				}
			}
			return {
				ok: true,
				message,
				added: summary.added,
				updated: summary.updated
			};
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			const message = `Sync import failed: ${detail}`;
			opts.flashToast(message);
			return { ok: false, message };
		}
	}

	async function handleSyncFile(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		try {
			if (file.size > SYNC_BUNDLE_MAX_CHARS) {
				opts.flashToast('Sync file too large');
				return;
			}
			const text = await file.text();
			await importSyncText(text);
		} catch {
			opts.flashToast('Sync import failed');
		}
	}

	/**
	 * Fallback when page does not wire Conflicts peel: one-shot dialog for first body conflict.
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
				await restoreConflictLocal(first.noteId, 'body', localBody);
			}
		});
	}

	async function restoreConflictLocal(
		noteId: string,
		field: SyncConflict['field'],
		localValue: unknown
	): Promise<boolean> {
		const target = notes.find((n) => n.id === noteId);
		if (!target) return false;
		if (isMashTeamWelcomeNote(target)) {
			opts.flashToast('The Mash team welcome is maintained in-house');
			return false;
		}

		let updated: Note;
		if (field === 'body' && typeof localValue === 'string') {
			updated = {
				...target,
				body: localValue,
				links: extractWikilinks(localValue),
				modified: Date.now()
			};
		} else if (field === 'title' && typeof localValue === 'string') {
			updated = { ...target, title: localValue, modified: Date.now() };
		} else if (field === 'folder' && typeof localValue === 'string') {
			updated = { ...target, folder: localValue, modified: Date.now() };
		} else if (field === 'tags' && Array.isArray(localValue)) {
			updated = {
				...target,
				tags: localValue.filter((t): t is string => typeof t === 'string'),
				modified: Date.now()
			};
		} else if (field === 'pinned' && (localValue === 0 || localValue === 1)) {
			updated = { ...target, pinned: localValue, modified: Date.now() };
		} else if (field === 'links' && Array.isArray(localValue)) {
			updated = {
				...target,
				links: localValue.filter((t): t is string => typeof t === 'string'),
				modified: Date.now()
			};
		} else if (field === 'mashedFrom' && Array.isArray(localValue)) {
			updated = {
				...target,
				mashedFrom: localValue.filter((t): t is string => typeof t === 'string'),
				modified: Date.now()
			};
		} else if (
			field === 'textAlign' &&
			(localValue === 'left' || localValue === 'center' || localValue === 'right')
		) {
			updated = { ...target, textAlign: localValue, modified: Date.now() };
		} else if (
			field === 'source' &&
			typeof localValue === 'object' &&
			localValue !== null &&
			((localValue as { kind?: unknown }).kind === 'pdf' ||
				(localValue as { kind?: unknown }).kind === 'docx' ||
				(localValue as { kind?: unknown }).kind === 'image' ||
				(localValue as { kind?: unknown }).kind === 'url' ||
				(localValue as { kind?: unknown }).kind === 'html' ||
				(localValue as { kind?: unknown }).kind === 'table')
		) {
			updated = { ...target, source: localValue as Note['source'], modified: Date.now() };
		} else {
			return false;
		}

		const plain: Note = {
			...updated,
			tags: [...updated.tags],
			...(updated.links ? { links: [...updated.links] } : {}),
			...(updated.mashedFrom ? { mashedFrom: [...updated.mashedFrom] } : {})
		};
		await db.notes.put(plain);
		patchNote(plain.id, plain);
		updateNoteInSearch(plain, plain);
		opts.flashToast(`Restored local ${field} on “${plain.title}”`);
		return true;
	}

	async function importNotesText(
		text: string,
		importOpts?: { silent?: boolean }
	): Promise<{ ok: boolean; message: string; notes?: Note[] }> {
		try {
			if (text.length > NOTES_IMPORT_MAX_CHARS) {
				const message = 'Import file too large';
				if (!importOpts?.silent) opts.flashToast(message);
				return { ok: false, message };
			}
			const result = parseNotesJson(text);
			if (!result.ok) {
				if (!importOpts?.silent) opts.flashToast(result.error);
				return { ok: false, message: result.error };
			}
			let added = 0;
			for (const note of result.notes) {
				const scopedNote: Note = {
					...note,
					sessionId: opts.getActiveSessionId?.() ?? note.sessionId,
					scope: opts.getActiveSessionMode?.() === 'kept' ? 'kept' : 'session'
				};
				const existing = notes.find((n) => n.id === scopedNote.id);
				if (existing) {
					const merged = {
						...existing,
						...scopedNote,
						id: existing.id,
						modified: Math.max(existing.modified, scopedNote.modified)
					};
					await db.notes.put(merged);
					patchNote(existing.id, merged);
					updateNoteInSearch(merged, merged);
				} else {
					await db.notes.put(scopedNote);
					addNoteToSearch(scopedNote);
					setNotes([scopedNote, ...notes]);
					added++;
				}
			}
			const teamNote = await ensureMashTeamWelcomeNote();
			setNotes([teamNote, ...notes.filter((note) => !isMashTeamWelcomeCandidate(note))]);
			updateNoteInSearch(teamNote, teamNote);
			const message =
				added === result.notes.length
					? `Imported ${added} notes`
					: `Imported ${result.notes.length} notes (${added} new)`;
			if (!importOpts?.silent) opts.flashToast(message);
			opts.onMeaningfulActivity?.();
			return { ok: true, message, notes: result.notes };
		} catch (err) {
			console.error(err);
			const message = 'Import failed';
			if (!importOpts?.silent) opts.flashToast(message);
			return { ok: false, message };
		}
	}

	async function handleImportFile(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		if (file.size > NOTES_IMPORT_MAX_CHARS) {
			opts.flashToast('Import file too large');
			return;
		}
		await importNotesText(await file.text());
	}

	/**
	 * Import an Obsidian vault folder or Bear markdown export (multi-file / directory).
	 * Always creates new notes (new UUIDs) — does not merge by path.
	 */
	async function importMarkdownFiles(
		list: FileList | File[],
		importOpts?: { allowPlainText?: boolean; silent?: boolean }
	): Promise<{ ok: boolean; message: string; notes?: Note[] }> {
		if (list.length === 0) return { ok: false, message: 'No files selected' };
		try {
			if (!importOpts?.silent) opts.flashToast('Importing markdown…');
			const files = await filesFromFileList(list, {
				allowPlainText: importOpts?.allowPlainText
			});
			const result = parseMarkdownVault(files);
			if (!result.ok) {
				if (!importOpts?.silent) opts.flashToast(result.error);
				return { ok: false, message: result.error };
			}

			const CHUNK = 100;
			for (let i = 0; i < result.notes.length; i += CHUNK) {
				const chunk = result.notes.slice(i, i + CHUNK).map((note) => ({
					...note,
					sessionId: opts.getActiveSessionId?.() ?? note.sessionId,
					scope: opts.getActiveSessionMode?.() === 'kept' ? ('kept' as const) : ('session' as const)
				}));
				await db.notes.bulkPut(chunk);
				for (const note of chunk) addNoteToSearch(note);
				setNotes([...chunk, ...notes]);
				// Yield so the UI can paint progress toasts / stay responsive.
				await new Promise((r) => setTimeout(r, 0));
			}

			const skipHint = result.skipped > 0 ? ` (skipped ${result.skipped} non-markdown)` : '';
			const message = `Imported ${result.notes.length} markdown notes${skipHint}`;
			if (!importOpts?.silent) opts.flashToast(message);
			opts.onMeaningfulActivity?.();
			return { ok: true, message, notes: result.notes };
		} catch (err) {
			console.error(err);
			const message =
				err instanceof Error &&
				/^(Too many notes|Note .+ is too large|Markdown import is too large)/.test(err.message)
					? err.message
					: 'Markdown import failed';
			if (!importOpts?.silent) opts.flashToast(message);
			return { ok: false, message };
		}
	}

	async function handleMarkdownImport(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const list = input.files;
		input.value = '';
		if (!list || list.length === 0) return;
		await importMarkdownFiles(list);
	}

	async function handleDelete() {
		const ids = (
			selectionIds.length > 0 ? [...selectionIds] : selectedId ? [selectedId] : []
		).filter((id) => {
			const note = notes.find((n) => n.id === id);
			return !note || !isMashTeamWelcomeNote(note);
		});
		if (ids.length === 0) {
			opts.flashToast('The Mash team welcome is maintained in-house');
			return;
		}
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
				setNotes(notes.filter((n) => !idSet.has(n.id)));
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
		const note = notesById.get(id) ?? notes.find((n) => n.id === id);
		if (!note) return;
		const updated = { ...note, ...patch, modified: Date.now() };
		patchNote(id, updated);
		void persistNotePatch(id, patch);
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
		const matching = notes.filter((n) => n.folder === folder || n.folder.startsWith(folder + '/'));
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
			setNotes(v);
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
		set bulkMenu(v: 'tag' | 'folder' | 'align' | 'operators' | 'mash' | 'more' | null) {
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
		get writeError() {
			return writeError;
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
		adoptNotes,
		applyPromotedNotes,
		applyNoteReceipt,
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
		flushPendingSaveAsync,
		retryPendingWrites,
		handleVisibilityChange,
		handleImportFile,
		importNotesText,
		handleMarkdownImport,
		importMarkdownFiles,
		handleSyncFile,
		importSyncText,
		restoreConflictLocal
	};
}
