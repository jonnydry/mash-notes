<script lang="ts">
	/**
	 * Screen-space editor stage — OS-like tiled note panes over the canvas.
	 */
	import { Maximize2, Minimize2, X, Pin, Folder, Tag } from 'lucide-svelte';
	import { onDestroy } from 'svelte';
	import type { Note } from '$lib/types';
	import StickyEditor from '$lib/components/StickyEditor.svelte';
	import { notePreview } from '$lib/format';
	import { isPermanentMashWelcomeNote, MASH_SPOON_LOGO } from '$lib/canvas-empty-state';
	import {
		detectFillOrSnapZone,
		type EditorPane,
		type EditorStageStore,
		type SnapZone
	} from '$lib/stores/editor-stage.svelte';

	interface Props {
		stage: EditorStageStore;
		notesById: Map<string, Note>;
		/** Notes currently on the desk — offered in the empty split half. */
		canvasNotes?: Note[];
		folders?: string[];
		onTitleChange: (noteId: string, title: string) => void;
		onBodyChange: (noteId: string, body: string) => void;
		onMetaChange?: (
			noteId: string,
			patch: {
				folder?: string;
				tags?: string[];
				pinned?: 0 | 1;
				textAlign?: 'left' | 'center' | 'right';
			}
		) => void;
		onWikilink?: (target: string) => void;
	}

	let {
		stage,
		notesById,
		canvasNotes = [],
		folders = [],
		onTitleChange,
		onBodyChange,
		onMetaChange,
		onWikilink
	}: Props = $props();

	let stageEl: HTMLDivElement | undefined = $state();
	let dragPaneId = $state<string | null>(null);
	let splitterAxis = $state<'h' | 'v' | null>(null);
	let stopSplitterDrag: (() => void) | null = null;

	onDestroy(() => {
		stopSplitterDrag?.();
	});

	function paneNote(pane: EditorPane): Note | undefined {
		return notesById.get(pane.noteId);
	}

	function stageSplits() {
		return { h: stage.splitH, v: stage.splitV };
	}

	function onTitlePointerDown(e: PointerEvent, pane: EditorPane) {
		if (e.button !== 0) return;
		const t = e.target as HTMLElement;
		if (t.closest('button') || t.closest('input')) return;
		e.preventDefault();
		dragPaneId = pane.id;
		stage.focusNote(pane.noteId);
		(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
	}

	function onTitlePointerMove(e: PointerEvent) {
		if (!dragPaneId || !stageEl) return;
		const rect = stageEl.getBoundingClientRect();
		const zone = detectFillOrSnapZone(e.clientX, e.clientY, rect, stage.panes, stageSplits());
		stage.setPreview(zone);
	}

	function onTitlePointerUp(e: PointerEvent) {
		if (!dragPaneId || !stageEl) {
			dragPaneId = null;
			stage.setPreview(null);
			return;
		}
		const rect = stageEl.getBoundingClientRect();
		const zone = detectFillOrSnapZone(e.clientX, e.clientY, rect, stage.panes, stageSplits());
		if (zone) stage.snapPane(dragPaneId, zone);
		else stage.setPreview(null);
		dragPaneId = null;
	}

	function startSplitter(e: PointerEvent, axis: 'h' | 'v') {
		if (e.button !== 0 || !stageEl) return;
		e.preventDefault();
		e.stopPropagation();
		stopSplitterDrag?.();
		splitterAxis = axis;
		const prevCursor = document.body.style.cursor;
		const prevSelect = document.body.style.userSelect;
		document.body.style.cursor = axis === 'h' ? 'col-resize' : 'row-resize';
		document.body.style.userSelect = 'none';

		const onMove = (ev: PointerEvent) => {
			if (!stageEl) return;
			const rect = stageEl.getBoundingClientRect();
			if (rect.width <= 0 || rect.height <= 0) return;
			if (axis === 'h') {
				stage.setSplitH((ev.clientX - rect.left) / rect.width);
			} else {
				stage.setSplitV((ev.clientY - rect.top) / rect.height);
			}
		};
		const onUp = () => {
			stopSplitterDrag?.();
		};
		stopSplitterDrag = () => {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('pointercancel', onUp);
			document.body.style.cursor = prevCursor;
			document.body.style.userSelect = prevSelect;
			splitterAxis = null;
			stopSplitterDrag = null;
		};
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
		window.addEventListener('pointercancel', onUp);
		onMove(e);
	}

	function onSplitterKeydown(e: KeyboardEvent, axis: 'h' | 'v') {
		const current = axis === 'h' ? stage.splitH : stage.splitV;
		const step = e.shiftKey ? 0.05 : 0.01;
		let next: number | null = null;
		if (e.key === 'Home') next = 0.2;
		else if (e.key === 'End') next = 0.8;
		else if (axis === 'h' && e.key === 'ArrowLeft') next = current - step;
		else if (axis === 'h' && e.key === 'ArrowRight') next = current + step;
		else if (axis === 'v' && e.key === 'ArrowUp') next = current - step;
		else if (axis === 'v' && e.key === 'ArrowDown') next = current + step;
		if (next === null) return;
		e.preventDefault();
		if (axis === 'h') stage.setSplitH(next);
		else stage.setSplitV(next);
	}

	function slotStyle(pane: EditorPane): string {
		const gap = 8;
		const layout = stage.layout;
		if (layout === 'single' || pane.slot === 'full') {
			return `inset: ${gap}px;`;
		}
		// Half-pane waiting for a partner, or a completed horizontal split.
		if (layout === 'waiting-h' || layout === 'split-h') {
			const leftPct = stage.splitH * 100;
			if (pane.slot === 'left') {
				return `left:${gap}px; top:${gap}px; bottom:${gap}px; width:calc(${leftPct}% - ${gap * 1.5}px);`;
			}
			if (pane.slot === 'right') {
				return `left:calc(${leftPct}% + ${gap / 2}px); top:${gap}px; right:${gap}px; bottom:${gap}px;`;
			}
		}
		if (layout === 'waiting-v' || layout === 'split-v') {
			const topPct = stage.splitV * 100;
			if (pane.slot === 'top') {
				return `left:${gap}px; top:${gap}px; right:${gap}px; height:calc(${topPct}% - ${gap * 1.5}px);`;
			}
			if (pane.slot === 'bottom') {
				return `left:${gap}px; top:calc(${topPct}% + ${gap / 2}px); right:${gap}px; bottom:${gap}px;`;
			}
		}
		return `inset: ${gap}px;`;
	}

	function emptyHalfStyle(slot: NonNullable<typeof stage.emptySlot>): string {
		const gap = 8;
		const leftPct = stage.splitH * 100;
		const topPct = stage.splitV * 100;
		switch (slot) {
			case 'left':
				return `left:${gap}px; top:${gap}px; bottom:${gap}px; width:calc(${leftPct}% - ${gap * 1.5}px);`;
			case 'right':
				return `left:calc(${leftPct}% + ${gap / 2}px); top:${gap}px; right:${gap}px; bottom:${gap}px;`;
			case 'top':
				return `left:${gap}px; top:${gap}px; right:${gap}px; height:calc(${topPct}% - ${gap * 1.5}px);`;
			case 'bottom':
				return `left:${gap}px; top:calc(${topPct}% + ${gap / 2}px); right:${gap}px; bottom:${gap}px;`;
			case 'full':
				return `inset: ${gap}px;`;
			default: {
				const _exhaustive: never = slot;
				void _exhaustive;
				return `inset: ${gap}px;`;
			}
		}
	}

	function previewStyle(zone: SnapZone): string {
		switch (zone) {
			case 'left':
				return 'left:0; top:0; bottom:0; width:50%;';
			case 'right':
				return 'right:0; top:0; bottom:0; width:50%;';
			case 'top':
				return 'left:0; top:0; right:0; height:50%;';
			case 'bottom':
				return 'left:0; bottom:0; right:0; height:50%;';
			case 'maximize':
				return 'inset: 0.75rem;';
			default: {
				const _exhaustive: never = zone;
				void _exhaustive;
				return 'inset: 0;';
			}
		}
	}

	let openNoteIds = $derived(new Set(stage.panes.map((p) => p.noteId)));
	let pickerNotes = $derived(
		canvasNotes
			.filter((n) => !openNoteIds.has(n.id))
			.slice()
			.sort((a, b) => {
				if (a.pinned !== b.pinned) return b.pinned - a.pinned;
				return b.modified - a.modified;
			})
	);

	function pickForEmptyHalf(noteId: string) {
		stage.openBeside(noteId);
	}
</script>

{#if stage.open || stage.previewZone}
	<div
		bind:this={stageEl}
		class="mash-editor-stage"
		class:is-open={stage.open}
		class:is-previewing={Boolean(stage.previewZone)}
		role="region"
		aria-label="Note editor stage"
	>
		{#if stage.previewZone}
			<div
				class="mash-snap-preview"
				style={previewStyle(stage.previewZone)}
				aria-hidden="true"
			></div>
		{/if}

		{#if stage.emptySlot && !stage.previewZone}
			<div
				class="mash-empty-half"
				style={emptyHalfStyle(stage.emptySlot)}
				aria-label="Choose a note for this half"
			>
				<div class="mash-empty-half-picker">
					<p class="mash-empty-half-label">
						Open a note here
						<span>
							{pickerNotes.length > 0
								? 'Pick from notes on this desk, or drop one in'
								: 'Drop a note here — or place more on the desk first'}
						</span>
					</p>
					{#if pickerNotes.length > 0}
						<ul class="mash-empty-half-list" onwheel={(e) => e.stopPropagation()}>
							{#each pickerNotes as note (note.id)}
								<li>
									<button
										type="button"
										class="mash-empty-half-item"
										onclick={() => pickForEmptyHalf(note.id)}
									>
										<span class="mash-empty-half-item-title">
											{note.title || 'Untitled'}
											{#if note.pinned === 1}
												<Pin class="h-3 w-3 shrink-0 text-[var(--mash-accent-bright)]" />
											{/if}
										</span>
										<span class="mash-empty-half-item-preview">
											{notePreview(note.body, 64)}
										</span>
										{#if note.folder}
											<span class="mash-empty-half-item-meta">{note.folder}</span>
										{/if}
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			</div>
		{/if}

		{#each stage.panes as pane (pane.id)}
			{@const note = paneNote(pane)}
			{#if note}
				{@const isPermanentWelcome = isPermanentMashWelcomeNote(note)}
				<section
					class="mash-editor-pane"
					class:is-active={stage.activeNoteId === note.id}
					style={slotStyle(pane)}
					aria-label={note.title || 'Untitled'}
				>
					<header
						class="mash-editor-pane-titlebar"
						role="group"
						aria-label="Pane window controls"
						onpointerdown={(e) => onTitlePointerDown(e, pane)}
						onpointermove={onTitlePointerMove}
						onpointerup={onTitlePointerUp}
						onpointercancel={onTitlePointerUp}
					>
						<input
							type="text"
							value={note.title}
							class="mash-focus min-w-0 flex-1 bg-transparent text-sm font-semibold tracking-tight outline-none"
							style="color: var(--mash-card-ink);"
							onpointerdown={(e) => e.stopPropagation()}
							oninput={(e) => onTitleChange(note.id, (e.currentTarget as HTMLInputElement).value)}
							onfocus={() => stage.focusNote(note.id)}
						/>
						<button
							type="button"
							class="mash-pane-btn {note.pinned === 1 ? 'is-accent' : ''}"
							onclick={(e) => {
								e.stopPropagation();
								onMetaChange?.(note.id, { pinned: note.pinned === 1 ? 0 : 1 });
							}}
							aria-label={note.pinned === 1 ? 'Unpin note' : 'Pin note'}
							title={note.pinned === 1 ? 'Unpin' : 'Pin'}
						>
							<Pin class="h-3.5 w-3.5" />
						</button>
						<button
							type="button"
							class="mash-pane-btn"
							onclick={(e) => {
								e.stopPropagation();
								stage.snapPane(pane.id, 'maximize');
							}}
							aria-label="Maximize pane"
							title="Maximize"
						>
							<Maximize2 class="h-3.5 w-3.5" />
						</button>
						<button
							type="button"
							class="mash-pane-btn"
							onclick={(e) => {
								e.stopPropagation();
								stage.dismissPane(pane.id);
							}}
							aria-label="Collapse to canvas"
							title="Back to canvas"
						>
							<Minimize2 class="h-3.5 w-3.5" />
						</button>
						<button
							type="button"
							class="mash-pane-btn"
							onclick={(e) => {
								e.stopPropagation();
								stage.dismissPane(pane.id);
							}}
							aria-label="Close pane"
						>
							<X class="h-3.5 w-3.5" />
						</button>
					</header>

					<div class="mash-editor-pane-meta">
						<label
							class="flex min-w-0 flex-1 items-center gap-1 text-[10px] text-[var(--mash-card-muted)]"
						>
							<Folder class="h-3 w-3 shrink-0" />
							<input
								type="text"
								value={note.folder}
								list="mash-pane-folders"
								placeholder="folder"
								class="mash-focus min-w-0 flex-1 rounded border-0 bg-transparent py-0.5 text-[11px] outline-none"
								style="color: var(--mash-card-ink);"
								oninput={(e) =>
									onMetaChange?.(note.id, {
										folder: (e.currentTarget as HTMLInputElement).value
									})}
							/>
						</label>
						<label
							class="flex min-w-[40%] flex-1 items-center gap-1 text-[10px] text-[var(--mash-card-muted)]"
						>
							<Tag class="h-3 w-3 shrink-0" />
							<input
								type="text"
								value={note.tags.join(', ')}
								placeholder="tags"
								class="mash-focus min-w-0 flex-1 rounded border-0 bg-transparent py-0.5 text-[11px] outline-none"
								style="color: var(--mash-card-ink);"
								oninput={(e) => {
									const raw = (e.currentTarget as HTMLInputElement).value;
									const tags = raw
										.split(',')
										.map((t) => t.trim())
										.filter(Boolean);
									onMetaChange?.(note.id, { tags });
								}}
							/>
						</label>
					</div>

					<div class="mash-editor-pane-body">
						<StickyEditor
							body={note.body}
							noteId={note.id}
							heroImage={isPermanentWelcome
								? { src: MASH_SPOON_LOGO, alt: 'Spoon, the Mash mascot' }
								: null}
							textAlign={note.textAlign}
							autofocus={stage.activeNoteId === note.id}
							onBodyChange={(b) => onBodyChange(note.id, b)}
							onTextAlignChange={(align) => onMetaChange?.(note.id, { textAlign: align })}
							onWikilink={(target) => onWikilink?.(target)}
						/>
					</div>
				</section>
			{/if}
		{/each}

		{#if stage.layout === 'split-h' || stage.layout === 'waiting-h'}
			<!-- The ARIA separator is interactive when focusable and implements arrow-key resizing. -->
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<div
				class="mash-pane-splitter is-h"
				class:is-dragging={splitterAxis === 'h'}
				style="left: {stage.splitH * 100}%;"
				role="separator"
				tabindex="0"
				aria-label="Resize panes"
				aria-orientation="vertical"
				aria-valuemin="20"
				aria-valuemax="80"
				aria-valuenow={Math.round(stage.splitH * 100)}
				onpointerdown={(e) => startSplitter(e, 'h')}
				onkeydown={(e) => onSplitterKeydown(e, 'h')}
			></div>
		{:else if stage.layout === 'split-v' || stage.layout === 'waiting-v'}
			<!-- The ARIA separator is interactive when focusable and implements arrow-key resizing. -->
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<div
				class="mash-pane-splitter is-v"
				class:is-dragging={splitterAxis === 'v'}
				style="top: {stage.splitV * 100}%;"
				role="separator"
				tabindex="0"
				aria-label="Resize panes"
				aria-orientation="horizontal"
				aria-valuemin="20"
				aria-valuemax="80"
				aria-valuenow={Math.round(stage.splitV * 100)}
				onpointerdown={(e) => startSplitter(e, 'v')}
				onkeydown={(e) => onSplitterKeydown(e, 'v')}
			></div>
		{/if}

		{#if folders.length > 0}
			<datalist id="mash-pane-folders">
				{#each folders as folder (folder)}
					<option value={folder}></option>
				{/each}
			</datalist>
		{/if}
	</div>
{/if}
