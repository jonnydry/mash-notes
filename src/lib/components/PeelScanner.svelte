<script lang="ts">
	import type { Note } from '$lib/types';
	import VirtualList from '$lib/components/VirtualList.svelte';
	import { formatNoteTimestamp, notePreview } from '$lib/format';
	import { buildFolderTree, flattenFolderTree } from '$lib/folder-tree';
	import {
		GripVertical,
		Pin,
		X,
		Lock,
		LockOpen,
		Folder,
		Hash,
		Trash2,
		Link2,
		ArrowUpRight,
		ArrowDownLeft
	} from 'lucide-svelte';

	export type PeelMode = 'notes' | 'folders' | 'tags' | 'linked';

	interface Props {
		open: boolean;
		pinned?: boolean;
		mode?: PeelMode;
		title: string;
		notes: Note[];
		/** Linked mode: notes this note links to */
		outgoingNotes?: Note[];
		/** Linked mode: notes that link here */
		backlinkNotes?: Note[];
		linkedFocusTitle?: string;
		folders?: string[];
		tags?: string[];
		selectedIds: Set<string>;
		draggingId?: string | null;
		saveStatus?: 'saved' | 'saving' | '';
		filterText?: string;
		isLoading?: boolean;
		onClose: () => void;
		onTogglePin: () => void;
		onFilterText: (value: string) => void;
		onNoteClick: (id: string, e: MouseEvent) => void;
		onNoteOpen: (id: string) => void;
		onDragStart: (e: DragEvent, id: string) => void;
		onDragEnd: () => void;
		onPickFolder?: (folder: string) => void;
		onPickTag?: (tag: string) => void;
		onDeleteFolder?: (folder: string) => void;
		onDeleteTag?: (tag: string) => void;
		onNewNote?: () => void;
		onSelectAllNotes?: () => void;
		/** Touch long-press place (optional) */
		onTouchPlaceStart?: (noteId: string, clientX: number, clientY: number) => void;
	}

	let {
		open,
		pinned = false,
		mode = 'notes',
		title,
		notes,
		outgoingNotes = [],
		backlinkNotes = [],
		linkedFocusTitle = '',
		folders = [],
		tags = [],
		selectedIds,
		draggingId = null,
		saveStatus = '',
		filterText = '',
		isLoading = false,
		onClose,
		onTogglePin,
		onFilterText,
		onNoteClick,
		onNoteOpen,
		onDragStart,
		onDragEnd,
		onPickFolder,
		onPickTag,
		onDeleteFolder,
		onDeleteTag,
		onNewNote,
		onSelectAllNotes,
		onTouchPlaceStart
	}: Props = $props();

	let filterInput: HTMLInputElement | undefined = $state();
	let folderRows = $derived(flattenFolderTree(buildFolderTree(folders)));

	$effect(() => {
		if (open && mode === 'notes') {
			requestAnimationFrame(() => filterInput?.focus());
		}
	});

	function onRowKeydown(e: KeyboardEvent, noteId: string) {
		if (e.key === 'Enter') {
			e.preventDefault();
			onNoteOpen(noteId);
			return;
		}
		if (e.key === ' ') {
			e.preventDefault();
			onNoteClick(noteId, e as unknown as MouseEvent);
			return;
		}
		if ((e.key === 'a' || e.key === 'A') && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			onSelectAllNotes?.();
			return;
		}
	}

	const LONG_PRESS_MS = 420;
	const LONG_PRESS_MOVE_PX = 10;
	let longPressTimer = 0;
	let longPressOrigin: { x: number; y: number; noteId: string } | null = null;

	function onHandlePointerDown(e: PointerEvent, noteId: string) {
		if (!onTouchPlaceStart) return;
		if (e.pointerType === 'mouse') return;
		longPressOrigin = { x: e.clientX, y: e.clientY, noteId };
		longPressTimer = window.setTimeout(() => {
			if (!longPressOrigin || longPressOrigin.noteId !== noteId) return;
			onTouchPlaceStart(noteId, longPressOrigin.x, longPressOrigin.y);
			longPressOrigin = null;
			longPressTimer = 0;
		}, LONG_PRESS_MS);
	}

	function onHandlePointerMove(e: PointerEvent) {
		if (!longPressOrigin || !longPressTimer) return;
		const dx = e.clientX - longPressOrigin.x;
		const dy = e.clientY - longPressOrigin.y;
		if (dx * dx + dy * dy > LONG_PRESS_MOVE_PX * LONG_PRESS_MOVE_PX) {
			clearLongPress();
		}
	}

	function clearLongPress() {
		if (longPressTimer) {
			clearTimeout(longPressTimer);
			longPressTimer = 0;
		}
		longPressOrigin = null;
	}
</script>

{#if open}
	<aside class="mash-peel" aria-label="Note scanner">
		<div class="mash-peel-header">
			<div class="min-w-0 flex-1">
				<div class="truncate text-xs font-semibold tracking-tight" style="color: var(--mash-ink);">
					{title}
				</div>
				{#if mode === 'notes'}
					<div class="text-[10px]" style="color: var(--mash-ink-muted);">
						{notes.length} note{notes.length === 1 ? '' : 's'}
						{#if saveStatus}
							· {saveStatus === 'saving' ? 'Saving' : 'Saved'}
						{/if}
					</div>
				{:else if mode === 'linked'}
					<div class="text-[10px]" style="color: var(--mash-ink-muted);">
						{linkedFocusTitle || 'Links'}
					</div>
				{/if}
			</div>
			<button
				type="button"
				class="mash-peel-icon-btn"
				onclick={onTogglePin}
				aria-label={pinned ? 'Unpin scanner' : 'Pin scanner open'}
				title={pinned ? 'Unpin' : 'Keep open'}
			>
				{#if pinned}
					<Lock class="h-3.5 w-3.5" />
				{:else}
					<LockOpen class="h-3.5 w-3.5" />
				{/if}
			</button>
			<button type="button" class="mash-peel-icon-btn" onclick={onClose} aria-label="Close scanner">
				<X class="h-3.5 w-3.5" />
			</button>
		</div>

		{#if mode === 'notes'}
			<div class="mash-peel-filter">
				<input
					bind:this={filterInput}
					id="peel-filter"
					type="text"
					value={filterText}
					placeholder="Filter in list…"
					class="mash-focus w-full rounded-md border bg-transparent px-2.5 py-1.5 text-xs outline-none"
					style="border-color: var(--mash-tray-edge); color: var(--mash-ink);"
					oninput={(e) => onFilterText((e.currentTarget as HTMLInputElement).value)}
				/>
			</div>
		{/if}

		<div class="mash-peel-body">
			{#if mode === 'folders'}
				<div class="mash-peel-body-scroll" onwheel={(e) => e.stopPropagation()}>
				{#if folderRows.length === 0}
					<div class="mash-peel-empty">No folders yet</div>
				{:else}
					{#each folderRows as { node, depth }}
						<div class="mash-peel-meta-row group" style="padding-left: {10 + depth * 12}px;">
							<button
								type="button"
								class="flex min-w-0 flex-1 items-center gap-2 text-left"
								onclick={() => onPickFolder?.(node.path)}
							>
								<Folder class="h-3.5 w-3.5 shrink-0 opacity-60" />
								<span class="truncate">{node.name}</span>
							</button>
							<button
								type="button"
								class="mash-peel-icon-btn opacity-40 group-hover:opacity-100 focus-visible:opacity-100"
								aria-label="Delete folder {node.path}"
								onclick={() => onDeleteFolder?.(node.path)}
							>
								<Trash2 class="h-3.5 w-3.5" />
							</button>
						</div>
					{/each}
				{/if}
				</div>
			{:else if mode === 'tags'}
				<div class="mash-peel-body-scroll" onwheel={(e) => e.stopPropagation()}>
				{#if tags.length === 0}
					<div class="mash-peel-empty">No tags yet</div>
				{:else}
					{#each tags as tag}
						<div class="mash-peel-meta-row group">
							<button
								type="button"
								class="flex min-w-0 flex-1 items-center gap-2 text-left"
								onclick={() => onPickTag?.(tag)}
							>
								<Hash class="h-3.5 w-3.5 shrink-0 opacity-60" />
								<span class="truncate">{tag}</span>
							</button>
							<button
								type="button"
								class="mash-peel-icon-btn opacity-40 group-hover:opacity-100 focus-visible:opacity-100"
								aria-label="Delete tag {tag}"
								onclick={() => onDeleteTag?.(tag)}
							>
								<Trash2 class="h-3.5 w-3.5" />
							</button>
						</div>
					{/each}
				{/if}
				</div>
			{:else if mode === 'linked'}
				<div class="mash-peel-body-scroll" onwheel={(e) => e.stopPropagation()}>
				{#if !linkedFocusTitle}
					<div class="mash-peel-empty">Select a note to see links</div>
				{:else}
					<div class="px-2.5 py-1.5 text-[10px] font-medium tracking-wide uppercase" style="color: var(--mash-accent-bright);">
						<span class="inline-flex items-center gap-1"><ArrowUpRight class="h-3 w-3" /> Outgoing</span>
					</div>
					{#if outgoingNotes.length === 0}
						<div class="mash-peel-empty py-2">No outgoing links</div>
					{:else}
						{#each outgoingNotes as note}
							<button
								type="button"
								class="mash-peel-meta-row w-full text-left"
								onclick={() => onNoteOpen(note.id)}
							>
								<Link2 class="h-3.5 w-3.5 shrink-0 opacity-60" />
								<span class="truncate text-[12px]">{note.title}</span>
							</button>
						{/each}
					{/if}
					<div class="mt-2 px-2.5 py-1.5 text-[10px] font-medium tracking-wide uppercase" style="color: var(--mash-accent-bright);">
						<span class="inline-flex items-center gap-1"><ArrowDownLeft class="h-3 w-3" /> Backlinks</span>
					</div>
					{#if backlinkNotes.length === 0}
						<div class="mash-peel-empty py-2">No backlinks</div>
					{:else}
						{#each backlinkNotes as note}
							<button
								type="button"
								class="mash-peel-meta-row w-full text-left"
								onclick={() => onNoteOpen(note.id)}
							>
								<Link2 class="h-3.5 w-3.5 shrink-0 opacity-60" />
								<span class="truncate text-[12px]">{note.title}</span>
							</button>
						{/each}
					{/if}
				{/if}
				</div>
			{:else if isLoading}
				<div class="mash-peel-empty">Loading…</div>
			{:else if notes.length === 0}
				<div class="mash-peel-empty">
					<p>Nothing to scan</p>
					{#if onNewNote}
						<button type="button" class="mash-btn mt-3 rounded-lg px-3 py-1.5 text-xs font-semibold" onclick={onNewNote}>
							Start a note
						</button>
					{/if}
				</div>
			{:else}
				<VirtualList items={notes} itemHeight={80}>
					{#snippet children(note)}
						{@const isSelected = selectedIds.has(note.id)}
						<div
							class="mash-tray-chip group flex h-full w-full border-b px-2.5 py-2 text-left
								{draggingId === note.id ? 'is-dragging' : ''}
								{isSelected
								? 'mash-row-active border-l-2 border-l-[var(--mash-accent)]'
								: 'mash-row-hover border-l-2 border-l-transparent'}"
							style="border-color: var(--mash-tray-edge);"
							role="option"
							aria-selected={isSelected}
						>
							<button
								type="button"
								class="mash-peel-drag-handle"
								draggable="true"
								aria-label="Drag {note.title} to canvas"
								title="Drag to canvas"
								ondragstart={(e) => onDragStart(e, note.id)}
								ondragend={onDragEnd}
								onpointerdown={(e) => onHandlePointerDown(e, note.id)}
								onpointermove={onHandlePointerMove}
								onpointerup={clearLongPress}
								onpointercancel={clearLongPress}
								onpointerleave={clearLongPress}
								onclick={(e) => e.stopPropagation()}
							>
								<GripVertical class="h-3.5 w-3.5" />
							</button>
							<button
								type="button"
								class="min-w-0 flex-1 text-left"
								aria-pressed={isSelected}
								onclick={(e) => onNoteClick(note.id, e)}
								ondblclick={() => onNoteOpen(note.id)}
								onkeydown={(e) => onRowKeydown(e, note.id)}
							>
								<div class="flex items-center justify-between gap-2">
									<span
										class="truncate text-sm font-medium"
										style="color: {isSelected ? 'var(--mash-ink)' : 'var(--mash-ink-muted)'};"
									>
										{note.title}
									</span>
									{#if note.pinned}
										<Pin class="h-3 w-3 shrink-0 text-[var(--mash-accent-bright)]" />
									{/if}
								</div>
								<div
									class="mt-0.5 line-clamp-2 text-[11px] leading-snug"
									style="color: var(--mash-ink-muted);"
								>
									{notePreview(note.body, 72)}
								</div>
								<div
									class="mt-1 flex items-center justify-between text-[9px] tabular-nums"
									style="color: var(--mash-ink-muted);"
								>
									<span class="truncate">{note.folder || '—'}</span>
									<span>{formatNoteTimestamp(note.modified)}</span>
								</div>
							</button>
						</div>
					{/snippet}
				</VirtualList>
			{/if}
		</div>

		{#if mode === 'notes'}
			<div class="mash-peel-footer">
				Drag handle · long-press to place · Enter expand · Space select
			</div>
		{:else if mode === 'linked'}
			<div class="mash-peel-footer">Open a linked note on the canvas</div>
		{/if}
	</aside>
{/if}
