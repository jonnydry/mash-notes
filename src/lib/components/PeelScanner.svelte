<script lang="ts">
	import type { Note } from '$lib/types';
	import VirtualList from '$lib/components/VirtualList.svelte';
	import { formatNoteTimestamp, notePreview } from '$lib/format';
	import { buildFolderTree, flattenFolderTree } from '$lib/folder-tree';
	import { isPermanentMashWelcomeNote, MASH_SPOON_LOGO } from '$lib/canvas-empty-state';
	import type { PeelScopeFilter } from '$lib/peel-hygiene';
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
		ArrowDownLeft,
		Diff
	} from 'lucide-svelte';

	export type PeelMode = 'notes' | 'folders' | 'tags' | 'linked' | 'conflicts';

	export type PeelConflictRow = {
		id: string;
		noteId: string;
		noteTitle: string;
		field: string;
		chosen: 'local' | 'remote';
		canRestoreLocal: boolean;
	};

	interface Props {
		open: boolean;
		pinned?: boolean;
		mode?: PeelMode;
		title: string;
		/** Override default “N notes” subtitle (ingredients counts, etc.). */
		subtitle?: string;
		notes: Note[];
		/** Linked mode: notes this note links to */
		outgoingNotes?: Note[];
		/** Linked mode: notes that link here */
		backlinkNotes?: Note[];
		linkedFocusTitle?: string;
		folders?: string[];
		tags?: string[];
		conflictRows?: PeelConflictRow[];
		selectedIds: Set<string>;
		draggingId?: string | null;
		saveStatus?: 'saved' | 'saving' | '';
		filterText?: string;
		isLoading?: boolean;
		/** Ingredients tray scope chips (notes mode only). */
		scopeFilter?: PeelScopeFilter;
		scopeCounts?: { desk: number; kept: number; total: number };
		onScopeFilter?: (scope: PeelScopeFilter) => void;
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
		onConflictKeepRemote?: (conflictId: string) => void;
		onConflictRestoreLocal?: (conflictId: string) => void;
		onConflictOpenNote?: (noteId: string) => void;
	}

	let {
		open,
		pinned = false,
		mode = 'notes',
		title,
		subtitle,
		notes,
		outgoingNotes = [],
		backlinkNotes = [],
		linkedFocusTitle = '',
		folders = [],
		tags = [],
		conflictRows = [],
		selectedIds,
		draggingId = null,
		saveStatus = '',
		filterText = '',
		isLoading = false,
		scopeFilter = 'ingredients',
		scopeCounts,
		onScopeFilter,
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
		onTouchPlaceStart,
		onConflictKeepRemote,
		onConflictRestoreLocal,
		onConflictOpenNote
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
	<aside class="mash-peel" aria-label="Ingredients">
		<div class="mash-peel-header">
			<div class="min-w-0 flex-1">
				<div class="mash-peel-title truncate">{title}</div>
				{#if mode === 'notes'}
					<div class="mash-peel-subtitle">
						{subtitle ?? `${notes.length} note${notes.length === 1 ? '' : 's'}`}
						{#if saveStatus}
							· {saveStatus === 'saving' ? 'Saving' : 'Saved'}
						{/if}
					</div>
				{:else if mode === 'linked'}
					<div class="mash-peel-subtitle">
						{linkedFocusTitle || 'Links'}
					</div>
				{:else if mode === 'conflicts'}
					<div class="mash-peel-subtitle">
						{conflictRows.length} pending
					</div>
				{/if}
			</div>
			<button
				type="button"
				class="mash-peel-icon-btn"
				onclick={onTogglePin}
				aria-label={pinned ? 'Unpin ingredients' : 'Keep ingredients open'}
				title={pinned ? 'Unpin' : 'Keep open'}
			>
				{#if pinned}
					<Lock class="h-3.5 w-3.5" />
				{:else}
					<LockOpen class="h-3.5 w-3.5" />
				{/if}
			</button>
			<button
				type="button"
				class="mash-peel-icon-btn"
				onclick={onClose}
				aria-label="Close ingredients"
			>
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
					placeholder="Filter ingredients…"
					class="mash-focus mash-type-caption w-full rounded-md border bg-transparent px-2.5 py-1.5 outline-none"
					style="border-color: var(--mash-tray-edge); color: var(--mash-ink);"
					oninput={(e) => onFilterText((e.currentTarget as HTMLInputElement).value)}
				/>
			</div>
			{#if onScopeFilter && scopeCounts}
				<div
					class="mash-peel-scope flex items-center gap-1 px-3 pt-1.5 pb-2"
					role="group"
					aria-label="Ingredient scope"
					data-testid="peel-scope-filter"
				>
					<button
						type="button"
						class="mash-chip mash-chip-hover mash-type-micro rounded-full px-2 py-0.5 font-semibold"
						class:is-active={scopeFilter === 'ingredients'}
						data-testid="peel-scope-ingredients"
						onclick={() => onScopeFilter('ingredients')}
					>
						All
					</button>
					<button
						type="button"
						class="mash-chip mash-chip-hover mash-type-micro rounded-full px-2 py-0.5 font-semibold"
						class:is-active={scopeFilter === 'desk'}
						data-testid="peel-scope-desk"
						onclick={() => onScopeFilter('desk')}
					>
						Desk
						{#if scopeCounts.desk > 0}
							<span class="opacity-70">{scopeCounts.desk}</span>
						{/if}
					</button>
					<button
						type="button"
						class="mash-chip mash-chip-hover mash-type-micro rounded-full px-2 py-0.5 font-semibold"
						class:is-active={scopeFilter === 'kept'}
						data-testid="peel-scope-kept"
						onclick={() => onScopeFilter('kept')}
					>
						Kept
						{#if scopeCounts.kept > 0}
							<span class="opacity-70">{scopeCounts.kept}</span>
						{/if}
					</button>
				</div>
			{/if}
		{/if}

		<div class="mash-peel-body">
			{#if mode === 'folders'}
				<div class="mash-peel-body-scroll" onwheel={(e) => e.stopPropagation()}>
					{#if folderRows.length === 0}
						<div class="mash-peel-empty">No folders yet</div>
					{:else}
						{#each folderRows as { node, depth } (node.path)}
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
						{#each tags as tag (tag)}
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
						<div
							class="mash-type-micro px-2.5 py-1.5 font-medium tracking-wide uppercase"
							style="color: var(--mash-accent-bright);"
						>
							<span class="inline-flex items-center gap-1"
								><ArrowUpRight class="h-3 w-3" /> Outgoing</span
							>
						</div>
						{#if outgoingNotes.length === 0}
							<div class="mash-peel-empty py-2">No outgoing links</div>
						{:else}
							{#each outgoingNotes as note (note.id)}
								<button
									type="button"
									class="mash-peel-meta-row w-full text-left"
									onclick={() => onNoteOpen(note.id)}
								>
									<Link2 class="h-3.5 w-3.5 shrink-0 opacity-60" />
									<span class="mash-type-caption truncate">{note.title}</span>
								</button>
							{/each}
						{/if}
						<div
							class="mash-type-micro mt-2 px-2.5 py-1.5 font-medium tracking-wide uppercase"
							style="color: var(--mash-accent-bright);"
						>
							<span class="inline-flex items-center gap-1"
								><ArrowDownLeft class="h-3 w-3" /> Backlinks</span
							>
						</div>
						{#if backlinkNotes.length === 0}
							<div class="mash-peel-empty py-2">No backlinks</div>
						{:else}
							{#each backlinkNotes as note (note.id)}
								<button
									type="button"
									class="mash-peel-meta-row w-full text-left"
									onclick={() => onNoteOpen(note.id)}
								>
									<Link2 class="h-3.5 w-3.5 shrink-0 opacity-60" />
									<span class="mash-type-caption truncate">{note.title}</span>
								</button>
							{/each}
						{/if}
					{/if}
				</div>
			{:else if mode === 'conflicts'}
				<div
					class="mash-peel-body-scroll"
					onwheel={(e) => e.stopPropagation()}
					data-testid="sync-conflicts-peel"
				>
					{#if conflictRows.length === 0}
						<div class="mash-peel-empty">No pending conflicts</div>
					{:else}
						{#each conflictRows as row (row.id)}
							<div class="mash-peel-conflict-row" data-testid="sync-conflict-row">
								<div class="flex min-w-0 items-start gap-2">
									<Diff class="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-60" />
									<div class="min-w-0 flex-1">
										<div
											class="mash-type-caption truncate font-medium"
											style="color: var(--mash-ink);"
										>
											{row.noteTitle}
										</div>
										<div class="mash-type-micro" style="color: var(--mash-ink-muted);">
											{row.field} · kept {row.chosen}
										</div>
									</div>
								</div>
								<div class="mash-peel-conflict-actions">
									<button
										type="button"
										class="mash-peel-conflict-btn"
										onclick={() => onConflictOpenNote?.(row.noteId)}
									>
										Open
									</button>
									{#if row.canRestoreLocal}
										<button
											type="button"
											class="mash-peel-conflict-btn"
											data-testid="sync-conflict-restore"
											onclick={() => onConflictRestoreLocal?.(row.id)}
										>
											Restore local
										</button>
									{/if}
									<button
										type="button"
										class="mash-peel-conflict-btn"
										data-testid="sync-conflict-keep"
										onclick={() => onConflictKeepRemote?.(row.id)}
									>
										Keep remote
									</button>
								</div>
							</div>
						{/each}
					{/if}
				</div>
			{:else if isLoading}
				<div class="mash-peel-empty">Loading…</div>
			{:else if notes.length === 0}
				<div class="mash-peel-empty">
					<p>Nothing to scan</p>
					{#if onNewNote}
						<button
							type="button"
							class="mash-btn mash-type-caption mt-3 rounded-lg px-3 py-1.5 font-semibold"
							onclick={onNewNote}
						>
							Start a note
						</button>
					{/if}
				</div>
			{:else}
				<VirtualList items={notes} itemHeight={84}>
					{#snippet children(note)}
						{@const isSelected = selectedIds.has(note.id)}
						{@const isPermanentWelcome = isPermanentMashWelcomeNote(note)}
						<div
							class="mash-tray-chip group flex h-full w-full text-left
								{draggingId === note.id ? 'is-dragging' : ''}
								{isSelected ? 'mash-row-active' : 'mash-row-hover'}"
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
							{#if isPermanentWelcome}
								<img
									src={MASH_SPOON_LOGO}
									alt="Scoop, the Mash mascot"
									class="h-12 w-12 shrink-0 self-center object-contain drop-shadow-sm"
								/>
							{/if}
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
										class="mash-type-body truncate font-medium"
										style="color: {isSelected ? 'var(--mash-ink)' : 'var(--mash-ink-muted)'};"
									>
										{note.title}
									</span>
									{#if note.pinned}
										<Pin class="h-3 w-3 shrink-0 text-[var(--mash-accent-bright)]" />
									{/if}
								</div>
								<div
									class="mash-type-caption mt-0.5 line-clamp-2 leading-snug"
									style="color: var(--mash-ink-muted);"
								>
									{notePreview(note.body, 72)}
								</div>
								<div
									class="mash-type-micro mt-1 flex items-center justify-between tabular-nums"
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
		{:else if mode === 'conflicts'}
			<div class="mash-peel-footer">
				Review after sync — Restore local undoes LWW for that field
			</div>
		{/if}
	</aside>
{/if}
