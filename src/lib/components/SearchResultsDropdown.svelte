<script lang="ts">
	import { GripVertical, Pin } from 'lucide-svelte';
	import type { Note } from '$lib/types';
	import type { SearchResult } from '$lib/search';
	import { formatNoteTimestamp, notePreview } from '$lib/format';

	interface Props {
		open: boolean;
		query: string;
		results: SearchResult[];
		notesById: Map<string, Note>;
		highlightIndex: number;
		draggingId?: string | null;
		onOpen: (id: string) => void;
		onHighlight: (index: number) => void;
		onDragStart: (e: DragEvent, id: string) => void;
		onDragEnd: () => void;
	}

	let {
		open,
		query,
		results,
		notesById,
		highlightIndex,
		draggingId = null,
		onOpen,
		onHighlight,
		onDragStart,
		onDragEnd
	}: Props = $props();
</script>

{#if open}
	<div
		class="mash-search-dropdown"
		role="listbox"
		aria-label="Search results"
		onwheel={(e) => e.stopPropagation()}
	>
		{#if results.length === 0}
			<div class="mash-search-dropdown-empty">No notes match “{query.trim()}”</div>
		{:else}
			{#each results as result, i (result.id)}
				{@const note = notesById.get(result.id)}
				<div
					id={`mash-search-result-${result.id}`}
					class="mash-search-dropdown-row mash-row-hover
						{draggingId === result.id ? 'is-dragging' : ''}
						{i === highlightIndex ? 'mash-row-active' : ''}"
					role="option"
					aria-selected={i === highlightIndex}
					tabindex="-1"
					onmouseenter={() => onHighlight(i)}
				>
					<button
						type="button"
						class="mash-peel-drag-handle"
						draggable="true"
						aria-label="Drag {result.title} to canvas"
						title="Drag to canvas"
						ondragstart={(e) => onDragStart(e, result.id)}
						ondragend={onDragEnd}
						onclick={(e) => e.stopPropagation()}
					>
						<GripVertical class="h-3.5 w-3.5" />
					</button>
					<button type="button" class="min-w-0 flex-1 text-left" onclick={() => onOpen(result.id)}>
						<div class="flex items-center justify-between gap-1.5">
							<span class="truncate text-[13px] font-medium leading-tight" style="color: var(--mash-ink);">
								{result.title}
							</span>
							{#if result.pinned}
								<Pin class="h-3 w-3 shrink-0 text-[var(--mash-accent-bright)]" />
							{/if}
						</div>
						{#if note}
							<div
								class="mt-px line-clamp-1 text-[11px] leading-snug"
								style="color: var(--mash-ink-muted);"
							>
								{notePreview(note.body, 64)}
							</div>
						{/if}
						<div
							class="mt-0.5 flex items-center justify-between gap-2 text-[9px] tabular-nums"
							style="color: var(--mash-ink-muted);"
						>
							<span class="truncate">{result.folder || '—'}</span>
							<span>{formatNoteTimestamp(result.modified)}</span>
						</div>
					</button>
				</div>
			{/each}
		{/if}
	</div>
{/if}
