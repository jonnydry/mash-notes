<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { createNote, deleteNote, getActiveNotes, syncNoteUpdate } from '$lib/db';
	import { initSearchIndex, searchNotes, updateNoteInSearch, addNoteToSearch, removeNoteFromSearch } from '$lib/search';
	import type { Note } from '$lib/types';
	import { Plus, Search, Trash2, Pin } from 'lucide-svelte';
	import Editor from '$lib/components/Editor.svelte';
	import VirtualList from '$lib/components/VirtualList.svelte';

	let notes = $state<Note[]>([]);
	let selectedId = $state<string | null>(null);
	let searchQuery = $state('');
	let currentFilter = $state<{ type: 'folder' | 'tag' | 'pinned' | null; value?: string }>({ type: null });

	let selectedNote = $derived(notes.find(n => n.id === selectedId) ?? null);
	let filteredNotes = $derived.by(() => {
		let list = [...notes];

		// Match basic structural filters first (AND logic)
		list = list.filter(n => {
			if (currentFilter.type === 'pinned') return n.pinned === 1;
			if (currentFilter.type === 'folder' && currentFilter.value) {
				return n.folder === currentFilter.value || n.folder.startsWith(currentFilter.value + '/');
			}
			if (currentFilter.type === 'tag' && currentFilter.value) {
				return n.tags.includes(currentFilter.value);
			}
			return true;
		});

		// Apply text search on the already-filtered list
		if (searchQuery.trim()) {
			const results = searchNotes(searchQuery, {
				folder: currentFilter.type === 'folder' ? currentFilter.value : undefined,
				tags: currentFilter.type === 'tag' && currentFilter.value ? [currentFilter.value] : undefined
			});
			const idSet = new Set(results.map(r => r.id));
			list = list.filter(n => idSet.has(n.id));
		}

		// Final Sort: Pinned first, then most recent modified
		list.sort((a, b) => {
			if (a.pinned !== b.pinned) return b.pinned - a.pinned;
			return b.modified - a.modified;
		});
		return list;
	});

	let uniqueFolders = $derived([...new Set(notes.map(n => n.folder).filter(Boolean))].sort());
	let uniqueTags = $derived([...new Set(notes.flatMap(n => n.tags))].sort());

	let backlinks = $derived.by(() => {
		if (!selectedNote) return [];
		return notes.filter(n =>
			n.id !== selectedNote.id &&
			n.links?.some(l => l.toLowerCase() === selectedNote.title.toLowerCase())
		);
	});

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

	// Reset highlight when query changes
	$effect(() => {
		paletteQuery;
		paletteHighlight = 0;
	});
	// Local draft for editing without constant writes
	let draftTitle = $state('');
	let draftBody = $state('');
	let draftFolder = $state('');
	let draftTags = $state<string[]>([]);

	let autoSaveTimeout: ReturnType<typeof setTimeout> | null = null;
	let pendingSnap: { id: string; title: string; body: string; tags: string[]; folder: string; links: string[] } | null = null;

	function extractWikilinks(body: string): string[] {
		const links: string[] = [];
		const regex = /\[\[([^|]+)(?:\|([^\]]+))?\]\]/g;
		let match;
		while ((match = regex.exec(body)) !== null) {
			const title = match[1].trim();
			if (title && !links.includes(title)) {
				links.push(title);
			}
		}
		return links;
	}

	$effect(() => {
		if (selectedNote) {
			draftTitle = selectedNote.title;
			draftBody = selectedNote.body;
			draftFolder = selectedNote.folder;
			draftTags = [...selectedNote.tags];
		} else {
			draftTitle = '';
			draftBody = '';
			draftFolder = '';
			draftTags = [];
		}
	});

	async function loadNotes() {
		isLoading = true;
		try {
			// Hydrate search index from DB first
			await initSearchIndex();
			// Then load notes for UI
			let loaded = await getActiveNotes({ limit: 10000 });

			// Seed some starter notes on first use
			if (loaded.length === 0) {
				const seed1 = await createNote({
					title: 'Welcome to Mash',
					body: 'Quick notes. Fast search. Your ideas, mashed together.\n\nTry creating a few notes and using the sidebar filters.',
					tags: ['welcome'],
				});
				addNoteToSearch(seed1);
				const seed2 = await createNote({
					title: 'Project ideas',
					body: '- Build the thing\n- Talk to users\n- Ship fast',
					tags: ['project'],
					folder: 'Ideas',
				});
				addNoteToSearch(seed2);
				loaded = [seed1, seed2];
			}

			// Ensure links are populated for existing notes
			notes = loaded.map(n => ({
				...n,
				links: n.links?.length ? n.links : extractWikilinks(n.body)
			}));
		} catch (e) {
			console.error('Failed to load notes', e);
		}
		isLoading = false;
	}

	async function handleNewNote() {
		const note = await createNote({
			title: 'Untitled',
			body: '',
			folder: currentFilter.type === 'folder' ? (currentFilter.value || '') : '',
			links: [],
		});
		addNoteToSearch(note);
		notes = [note, ...notes];
		selectNote(note.id);
		// Focus title
		setTimeout(() => {
			const titleInput = document.getElementById('note-title') as HTMLInputElement;
			titleInput?.select();
		}, 50);
	}

	function selectNote(id: string) {
		// Flush any pending save from the previously selected note first
		if (selectedId && selectedId !== id) flushPendingSave();
		// Set drafts synchronously so Editor receives correct value same tick as noteId
		const note = notes.find(n => n.id === id);
		if (note) {
			draftTitle = note.title;
			draftBody = note.body;
			draftFolder = note.folder;
			draftTags = [...note.tags];
		}
		selectedId = id;
	}

	async function handleWikilinkClick(title: string) {
		let target = notes.find(n => n.title.toLowerCase() === title.toLowerCase());

		if (!target) {
			target = await createNote({
				title,
				body: '',
				folder: currentFilter.type === 'folder' ? currentFilter.value || '' : '',
			});
			addNoteToSearch(target);
			notes = [target, ...notes];
		}

		selectNote(target.id);
	}

	function applyDraftSave(snap: { id: string; title: string; body: string; tags: string[]; folder: string; links: string[] }): void {
		const changes: Partial<Note> = {
			title: snap.title,
			body: snap.body,
			tags: snap.tags,
			folder: snap.folder,
			links: snap.links,
		};
		syncNoteUpdate(snap.id, changes);

		const updatedSnap = { ...notes.find(n => n.id === snap.id)!, ...changes, modified: Date.now() };
		notes = notes.map(n => n.id === snap.id ? updatedSnap : n);
		updateNoteInSearch({ id: snap.id, ...changes }, updatedSnap);
	}

	function scheduleAutoSave() {
		if (!selectedId) return;
		if (autoSaveTimeout) clearTimeout(autoSaveTimeout);
		saveStatus = 'saving';

		// Store pending snap so flushPendingSave can issue it immediately
		pendingSnap = {
			id: selectedId!,
			title: draftTitle,
			body: draftBody,
			tags: [...draftTags],
			folder: draftFolder,
			links: extractWikilinks(draftBody),
		};

		autoSaveTimeout = setTimeout(() => {
			autoSaveTimeout = null;
			if (!pendingSnap) return;
			applyDraftSave(pendingSnap);
			pendingSnap = null;

			saveStatus = 'saved';
			setTimeout(() => {
				if (saveStatus === 'saved') saveStatus = '';
			}, 1200);
		}, 400);
	}

	function flushPendingSave(): void {
		if (autoSaveTimeout) {
			clearTimeout(autoSaveTimeout);
			autoSaveTimeout = null;
		}
		if (pendingSnap) {
			applyDraftSave(pendingSnap);
			pendingSnap = null;
		}
	}

	function handleTitleInput(e: Event) {
		draftTitle = (e.target as HTMLInputElement).value;
		scheduleAutoSave();
	}

	function addTag(tag: string) {
		const t = tag.trim();
		if (!t || draftTags.includes(t)) return;
		draftTags = [...draftTags, t];
		scheduleAutoSave();
	}

	function removeTag(tag: string) {
		draftTags = draftTags.filter(t => t !== tag);
		scheduleAutoSave();
	}

	async function handleDelete() {
		if (!selectedId || !confirm('Delete this note?')) return;
		await deleteNote(selectedId);
		removeNoteFromSearch(selectedId);
		notes = notes.filter(n => n.id !== selectedId);
		if (notes.length > 0) selectNote(notes[0].id); else selectedId = null;
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
	}

	function clearFilter() {
		currentFilter = { type: null };
		searchQuery = '';
	}

	function handleGlobalSearch(e: Event) {
		searchQuery = (e.target as HTMLInputElement).value;
		if (searchQuery) {
			currentFilter = { type: null };
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			showPalette = !showPalette;
			if (showPalette) paletteQuery = '';
		}
		if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
			e.preventDefault();
			handleNewNote();
		}
		if (e.key === '/' && document.activeElement?.tagName === 'BODY') {
			e.preventDefault();
			(document.getElementById('global-search') as HTMLInputElement)?.focus();
		}
		if (e.key === 'Escape' && showPalette) {
			showPalette = false;
		}
	}

	const paletteActions = [
		{ label: 'New note', action: handleNewNote, shortcut: '⌘N' },
		{ label: 'Toggle pin', action: () => {
			if (!selectedId) return;
			const np = selectedNote?.pinned === 1 ? 0 : 1;
			syncNoteUpdate(selectedId, { pinned: np });
			notes = notes.map(n => n.id === selectedId ? {...n, pinned: np as 0 | 1} : n);
			if (selectedNote) updateNoteInSearch({ id: selectedId, pinned: np }, { ...selectedNote, pinned: np as 0 | 1 });
			showPalette = false;
		}, shortcut: '' },
		{ label: 'Delete current note', action: () => { handleDelete(); showPalette = false; }, shortcut: '' },
		{ label: 'Clear filters & search', action: clearFilter, shortcut: '' },
		{ label: 'Export all as JSON', action: () => {
			const data = JSON.stringify(notes, null, 2);
			const blob = new Blob([data], { type: 'application/json' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = 'mash-notes-export.json';
			a.click();
			URL.revokeObjectURL(url);
			showPalette = false;
		}, shortcut: '' },
	];

	function handlePaletteKeydown(e: KeyboardEvent): void {
		const commands = paletteActions.filter(a =>
			a.label.toLowerCase().includes(paletteQuery.toLowerCase())
		);
		const noteJumps = paletteQuery.length > 1
			? notes.filter((n: Note) =>
				n.title.toLowerCase().includes(paletteQuery.toLowerCase()) ||
				n.body.toLowerCase().includes(paletteQuery.toLowerCase())
			).slice(0, 6)
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

<div class="flex h-screen flex-col bg-zinc-950 text-zinc-200">
	<!-- Header -->
	<header class="flex items-center justify-between border-b border-zinc-800 bg-zinc-950/95 px-4 py-2 backdrop-blur">
		<div class="flex items-center gap-3">
			<div class="flex items-center gap-2">
				<img src="/icons/mash-monochrome-white.svg" alt="Mash" class="h-7 w-7" />
				<span class="text-lg font-semibold tracking-tight">Mash</span>
			</div>
			<div class="text-xs text-zinc-500">quick notes</div>
		</div>

		<div class="flex flex-1 items-center justify-center px-4">
			<div class="relative w-full max-w-md">
				<Search class="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
				<input
					id="global-search"
					type="text"
					placeholder="Search notes... (press /)"
					bind:value={searchQuery}
					oninput={handleGlobalSearch}
					class="w-full rounded-lg border border-zinc-800 bg-zinc-900 py-1.5 pl-9 pr-4 text-sm placeholder-zinc-500 focus:border-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-600 focus-visible:border-zinc-600"
				/>
			</div>
		</div>

		<div class="flex items-center gap-2 text-xs text-zinc-500">
			<button
				onclick={handleNewNote}
				class="flex items-center gap-1.5 rounded-lg bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-950 transition hover:bg-white active:bg-zinc-200"
			>
				<Plus class="h-4 w-4" />
				New
			</button>
			<div class="hidden md:block">⌘K</div>
		</div>
	</header>

	<!-- Main content -->
	<div class="flex flex-1 overflow-hidden">
		<!-- Sidebar -->
		<div class="w-56 flex-shrink-0 border-r border-zinc-800 bg-zinc-950/50 overflow-y-auto p-3 text-sm">
			<div class="mb-4">
				<button
					onclick={() => clearFilter()}
					class="mb-1 flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-600 focus-visible:ring-inset"
					class:bg-zinc-900={currentFilter.type === null && !searchQuery}
				>
					All Notes
				</button>
				<button
					onclick={() => setFilter('pinned')}
					class="mb-1 flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-600 focus-visible:ring-inset"
					class:bg-zinc-900={currentFilter.type === 'pinned'}
				>
					<Pin class="h-3.5 w-3.5" /> Pinned
				</button>
			</div>

			<!-- Folders (hierarchical) -->
			<div class="mb-4">
				<div class="mb-1 px-2 text-xs font-medium uppercase tracking-widest text-zinc-500">Folders</div>
				{#each uniqueFolders as folder}
					{@const depth = (folder || '').split('/').length - 1}
					<button
						onclick={() => setFilter('folder', folder || '')}
						class="mb-px flex w-full items-center gap-2 truncate rounded px-2 py-1 text-left hover:bg-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-600 focus-visible:ring-inset"
						class:bg-zinc-900={currentFilter.type === 'folder' && currentFilter.value === (folder || '')}
						class:text-white={currentFilter.type === 'folder' && currentFilter.value === (folder || '')}
						style="padding-left: {depth * 12 + 8}px"
					>
						<span class="text-zinc-400">📁</span> {folder.split('/').pop() || 'Root'}
					</button>
				{/each}
				{#if uniqueFolders.length === 0}
					<div class="px-2 py-1 text-xs text-zinc-600">No folders yet</div>
				{/if}
			</div>

			<!-- Tags -->
			<div>
				<div class="mb-1 px-2 text-xs font-medium uppercase tracking-widest text-zinc-500">Tags</div>
				{#each uniqueTags as tag}
					<button
						onclick={() => setFilter('tag', tag)}
						class="mb-px flex w-full items-center gap-1.5 truncate rounded px-2 py-0.5 text-left text-sm hover:bg-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-600 focus-visible:ring-inset"
						class:bg-zinc-900={currentFilter.type === 'tag' && currentFilter.value === tag}
					>
						<span class="text-zinc-400">#</span>{tag}
					</button>
				{/each}
				{#if uniqueTags.length === 0}
					<div class="px-2 py-1 text-xs text-zinc-600">No tags yet</div>
				{/if}
			</div>
		</div>

		<!-- Notes List (virtualized for performance) -->
		<div class="w-72 flex-shrink-0 border-r border-zinc-800 bg-zinc-950/30 flex flex-col">
			<div class="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-500 flex-shrink-0 flex items-center justify-between">
				<span>{searchQuery ? `${filteredNotes.length} results` : `${filteredNotes.length} notes`}</span>
				<span class="text-zinc-400">
					{saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved' : ''}
				</span>
			</div>

			{#if isLoading}
				<div class="flex flex-1 flex-col items-center justify-center gap-2 text-zinc-600">
					<div class="h-5 w-5 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-400"></div>
					<span class="text-xs">Loading notes…</span>
				</div>
			{:else if filteredNotes.length === 0}
				<div class="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-zinc-500">
					<img src="/icons/mash-monochrome-white.svg" alt="" class="h-6 w-6 opacity-40" />
					<span class="text-sm">
						{searchQuery ? 'No matches for your search.' : 'Your notes will show up here.'}
					</span>
					{#if !searchQuery && currentFilter.type === null}
						<button
							onclick={handleNewNote}
							class="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:bg-zinc-700"
						>
							Create your first note
						</button>
					{/if}
				</div>
			{:else}
				<div class="flex-1 overflow-hidden">
					<VirtualList items={filteredNotes} itemHeight={78}>
						{#snippet children(note)}
							<button
							    onclick={() => selectNote(note.id)}
							    class="group flex w-full flex-col border-b border-zinc-800 px-3 py-2.5 text-left hover:bg-zinc-900/60 h-full transition-colors focus-visible:ring-2 focus-visible:ring-zinc-600 focus-visible:ring-inset {selectedId === note.id ? 'bg-zinc-900 border-l-2 border-l-zinc-500/70' : ''}"
							>
							    <div class="flex items-start justify-between gap-2">
							        <div class="flex-1 truncate font-medium text-sm pr-1 group-hover:text-white transition-colors {selectedId === note.id ? 'text-zinc-100' : ''}">
							            {note.title}
							        </div>
							        {#if note.pinned}
							            <Pin class="mt-0.5 h-3 w-3 flex-shrink-0 text-amber-400/80" />
							        {/if}
							    </div>

							    <div class="mt-1 line-clamp-2 text-[13px] leading-relaxed text-zinc-400 group-hover:text-zinc-300 transition-colors">
							        {note.body.slice(0, 100) || 'No content yet...'}
							    </div>

							    <div class="mt-auto pt-2 flex items-center justify-between text-[10px] font-medium text-zinc-500">
							        <div class="flex items-center gap-1.5 overflow-hidden whitespace-nowrap">
							            {#if note.folder}
							                <span class="opacity-70 truncate flex items-center gap-0.5">
							                    <span class="text-[8px]">📁</span> {note.folder}
							                </span>
							            {/if}
							        </div>

							        <div class="flex items-center gap-2 text-[9px]">
							            <span class="opacity-60 tabular-nums">
							                {new Date(note.modified).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
							            </span>
							            <div class="flex items-center gap-1 group-hover:opacity-100 transition-opacity">
							                {#each note.tags as tag}
							                    <span class="px-1 rounded bg-zinc-800 text-[9px] whitespace-nowrap border border-zinc-700/50 text-zinc-500 group-hover:text-zinc-300">
							                        #{tag}
							                    </span>
							                {/each}
							            </div>
							        </div>
							    </div>
							</button>
						{/snippet}
					</VirtualList>
				</div>
			{/if}
		</div>

		<!-- Editor -->
		<div class="flex flex-1 flex-col overflow-hidden">
			{#if selectedNote}
				<!-- Editor header -->
				<div class="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
					<div class="flex flex-1 items-center gap-3">
						<input
							id="note-title"
							type="text"
							value={draftTitle}
							oninput={handleTitleInput}
							class="flex-1 bg-transparent text-lg font-semibold outline-none placeholder-zinc-600 focus-visible:ring-2 focus-visible:ring-zinc-600 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
							placeholder="Untitled"
						/>

						<!-- Folder -->
						<input
							type="text"
							bind:value={draftFolder}
							placeholder="folder"
							class="w-28 rounded bg-zinc-900 px-2 py-0.5 text-xs placeholder-zinc-500 outline-none focus:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-zinc-600 focus-visible:ring-offset-1 focus-visible:ring-offset-zinc-950"
							oninput={() => {
								if (!selectedId) return;
								const updated = { ...selectedNote, folder: draftFolder };
								syncNoteUpdate(selectedId, { folder: draftFolder });
								notes = notes.map(n => n.id === selectedId ? updated : n);
								updateNoteInSearch({ id: selectedId, folder: draftFolder }, updated);
								scheduleAutoSave();
							}}
						/>

						<div class="flex items-center gap-1 text-xs">
							{#each draftTags as tag (tag)}
								<span
									class="flex items-center gap-1 rounded bg-zinc-900 px-2 py-0.5 text-zinc-400"
								>
									#{tag}
									<button onclick={() => removeTag(tag)} class="hover:text-white focus-visible:ring-1 focus-visible:ring-zinc-600 rounded">×</button>
								</span>
							{/each}
							<input
								type="text"
								placeholder="add tag"
								class="w-20 bg-transparent text-xs placeholder-zinc-600 outline-none focus-visible:ring-2 focus-visible:ring-zinc-600 focus-visible:ring-offset-1 focus-visible:ring-offset-zinc-950"
								onkeydown={(e) => {
									if (e.key === 'Enter') {
										const target = e.currentTarget as HTMLInputElement;
										addTag(target.value);
										target.value = '';
									}
								}}
							/>
						</div>

						{#if backlinks.length > 0}
							<div class="flex items-center gap-1 text-xs text-zinc-400 ml-2">
								← {backlinks.length} backlink{backlinks.length > 1 ? 's' : ''}
							</div>
						{/if}
					</div>

					<div class="flex items-center gap-3 text-xs">
						<span class="text-zinc-500">
							{saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved' : ''}
						</span>

						<button
							onclick={() => {
								if (!selectedId) return;
								const newPinned = (selectedNote?.pinned === 1 ? 0 : 1) as 0 | 1;
								const updated = { ...selectedNote, pinned: newPinned };
								syncNoteUpdate(selectedId, { pinned: newPinned });
								notes = notes.map(n => n.id === selectedId ? updated : n);
								updateNoteInSearch({ id: selectedId, pinned: newPinned }, updated);
							}}
							class="flex items-center gap-1 rounded px-2 py-1 text-zinc-400 hover:bg-zinc-900 {selectedNote?.pinned ? 'text-amber-400' : ''}"
							aria-label="Toggle pin"
						>
							<Pin class="h-3.5 w-3.5" />
						</button>

						<button
							onclick={handleDelete}
							class="flex items-center gap-1 rounded px-2 py-1 text-zinc-400 hover:bg-zinc-900 hover:text-red-400"
						>
							<Trash2 class="h-3.5 w-3.5" />
							<span class="hidden sm:inline">Delete</span>
						</button>
					</div>
				</div>

				<!-- Editor body -->
				<div class="flex-1 overflow-hidden border-l border-zinc-800">
					<Editor
						value={draftBody}
						noteId={selectedId ?? ''}
						onWikilinkClick={handleWikilinkClick}
						onChange={(val: string) => {
							draftBody = val;
							scheduleAutoSave();
						}}
					/>
				</div>

				<div class="border-t border-zinc-800 px-4 py-1.5 text-[10px] text-zinc-500">
					{selectedNote ? new Date(selectedNote.modified).toLocaleString() : ''} • {draftBody.length} chars
				</div>
			{:else}
				<div class="flex flex-1 items-center justify-center text-zinc-500">
					<div class="text-center">
						<img src="/icons/mash-monochrome-white.svg" alt="" class="mx-auto mb-3 h-8 w-8 opacity-40" />
						<div class="mb-1 text-xl">No note selected</div>
						<p class="text-sm text-zinc-500">Pick a note from the list or create a new one.</p>
						<button
							onclick={handleNewNote}
							class="mt-4 rounded-lg bg-zinc-800 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700"
						>
							Create new note
						</button>
					</div>
				</div>
			{/if}
		</div>
	</div>

	<!-- Simple Command Palette -->
	{#if showPalette}
		<div
			class="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] bg-black/70 backdrop-blur-sm"
			role="presentation"
			tabindex="-1"
			onclick={(e) => { if (e.target === e.currentTarget) showPalette = false; }}
			onkeydown={(e) => { if (e.key === 'Escape') showPalette = false; }}
		>
			<div
				role="dialog"
				aria-modal="true"
				tabindex="-1"
				aria-label="Command palette"
				class="relative z-10 w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl"
			>
				<div class="border-b border-zinc-800 p-3">
					<input
						bind:this={paletteInput}
						type="text"
						bind:value={paletteQuery}
						placeholder="Type a command..."
						class="w-full bg-transparent text-sm outline-none placeholder-zinc-500 focus-visible:ring-2 focus-visible:ring-zinc-600 focus-visible:border-zinc-600 rounded px-1"
						onkeydown={handlePaletteKeydown}
					/>
				</div>
				<div class="max-h-80 overflow-auto p-1 text-sm">
					{#each paletteActions.filter(a => a.label.toLowerCase().includes(paletteQuery.toLowerCase())) as action, i}
						<button
							onclick={action.action}
							class="flex w-full items-center justify-between rounded px-3 py-2 text-left hover:bg-zinc-800 {i === paletteHighlight ? 'bg-zinc-800 ring-1 ring-inset ring-zinc-600/50' : ''}"
						>
							<span>{action.label}</span>
							<span class="text-xs text-zinc-500">{action.shortcut}</span>
						</button>
					{/each}

					<!-- Quick note jump from palette -->
					{#if paletteQuery.length > 1}
						<div class="mt-1 border-t border-zinc-800 pt-1 text-[10px] text-zinc-500 px-3">Jump to note</div>
						{#each notes.filter((n: Note) => n.title.toLowerCase().includes(paletteQuery.toLowerCase()) || n.body.toLowerCase().includes(paletteQuery.toLowerCase())).slice(0, 6) as note, j}
							<button
								onclick={() => { selectNote(note.id); showPalette = false; }}
								class="flex w-full items-center justify-between rounded px-3 py-1.5 text-left hover:bg-zinc-800 text-xs {j + paletteActions.filter(a => a.label.toLowerCase().includes(paletteQuery.toLowerCase())).length === paletteHighlight ? 'bg-zinc-800 ring-1 ring-inset ring-zinc-600/50' : ''}"
							>
								<span class="truncate">{note.title}</span>
								<span class="text-zinc-500 text-[10px]">{note.folder}</span>
							</button>
						{/each}
					{/if}

					{#if paletteActions.filter(a => a.label.toLowerCase().includes(paletteQuery.toLowerCase())).length === 0 && paletteQuery.length <= 1}
						<div class="px-3 py-2 text-zinc-500 text-sm">No matching commands</div>
					{/if}
				</div>
				<div class="border-t border-zinc-800 p-2 text-[10px] text-zinc-400 text-center tracking-wide">
					↑↓ to navigate • Enter to run • Esc to close
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	/* App styles */
</style>