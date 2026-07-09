<script lang="ts">
	/**
	 * Sticky-native editor for canvas bubbles.
	 * Edit / preview toggle with safe markdown + clickable wikilinks.
	 * Tiny write toolbar: bold, list, [[link]], text align.
	 */
	import {
		AlignCenter,
		AlignLeft,
		AlignRight,
		Bold,
		Eye,
		Link2,
		List,
		Pencil
	} from 'lucide-svelte';
	import { renderMarkdown } from '$lib/markdown';
	import type { TextAlign } from '$lib/types';

	interface Props {
		body: string;
		noteId: string;
		textAlign?: TextAlign;
		autofocus?: boolean;
		mode?: 'edit' | 'preview';
		onBodyChange: (body: string) => void;
		onTextAlignChange?: (align: TextAlign) => void;
		onModeChange?: (mode: 'edit' | 'preview') => void;
		onWikilink?: (target: string) => void;
	}

	let {
		body,
		noteId,
		textAlign = 'left',
		autofocus = true,
		mode = $bindable<'edit' | 'preview'>('edit'),
		onBodyChange,
		onTextAlignChange,
		onModeChange,
		onWikilink
	}: Props = $props();

	let bodyEl: HTMLTextAreaElement | undefined = $state();
	let focusedNoteId: string | null = null;

	let previewHtml = $derived(
		mode === 'preview' ? renderMarkdown(body || '') : ''
	);
	let align = $derived(
		textAlign === 'center' || textAlign === 'right' ? textAlign : 'left'
	);

	$effect(() => {
		if (autofocus && mode === 'edit' && noteId !== focusedNoteId) {
			focusedNoteId = noteId;
			requestAnimationFrame(() => bodyEl?.focus());
		}
	});

	function setMode(next: 'edit' | 'preview') {
		mode = next;
		onModeChange?.(next);
		if (next === 'edit') {
			requestAnimationFrame(() => bodyEl?.focus());
		}
	}

	function setAlign(next: TextAlign) {
		onTextAlignChange?.(next);
	}

	function onPreviewClick(e: MouseEvent) {
		const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-wikilink]');
		if (!btn) return;
		e.preventDefault();
		e.stopPropagation();
		const target = btn.dataset.wikilink;
		if (target) onWikilink?.(target);
	}

	function wrapOrInsert(before: string, after: string, placeholder = '') {
		const el = bodyEl;
		if (!el) return;
		const start = el.selectionStart;
		const end = el.selectionEnd;
		const selected = body.slice(start, end);
		const inner = selected || placeholder;
		const next = body.slice(0, start) + before + inner + after + body.slice(end);
		onBodyChange(next);
		requestAnimationFrame(() => {
			if (!bodyEl) return;
			bodyEl.focus();
			const cursor = start + before.length;
			if (selected) {
				bodyEl.setSelectionRange(cursor, cursor + selected.length);
			} else {
				bodyEl.setSelectionRange(cursor, cursor + placeholder.length);
			}
		});
	}

	function insertBold() {
		wrapOrInsert('**', '**', 'bold');
	}

	function insertList() {
		const el = bodyEl;
		if (!el) return;
		const start = el.selectionStart;
		const end = el.selectionEnd;
		const selected = body.slice(start, end);
		if (selected.includes('\n')) {
			const listed = selected
				.split('\n')
				.map((line) => (line.trim() ? `- ${line.replace(/^[-*]\s+/, '')}` : line))
				.join('\n');
			const next = body.slice(0, start) + listed + body.slice(end);
			onBodyChange(next);
			requestAnimationFrame(() => {
				bodyEl?.focus();
				bodyEl?.setSelectionRange(start, start + listed.length);
			});
			return;
		}
		const lineStart = body.lastIndexOf('\n', start - 1) + 1;
		const prefix = body.slice(lineStart, start).startsWith('- ') ? '' : '- ';
		if (!prefix && !selected) {
			wrapOrInsert('- ', '', 'item');
			return;
		}
		if (prefix) {
			const next = body.slice(0, lineStart) + prefix + body.slice(lineStart);
			onBodyChange(next);
			requestAnimationFrame(() => {
				bodyEl?.focus();
				bodyEl?.setSelectionRange(start + prefix.length, end + prefix.length);
			});
		}
	}

	function insertWikilink() {
		wrapOrInsert('[[', ']]', 'Note title');
	}
</script>

<div class="flex h-full min-h-0 w-full flex-col" data-no-drag>
	<div class="flex shrink-0 items-center justify-between gap-0.5 border-b border-[var(--mash-card-edge)] px-1.5 py-0.5">
		{#if mode === 'edit'}
			<div class="flex items-center gap-0.5">
				<button
					type="button"
					class="mash-sticky-mode-btn"
					onclick={(e) => {
						e.stopPropagation();
						insertBold();
					}}
					aria-label="Bold"
					title="Bold"
				>
					<Bold class="h-3 w-3" />
				</button>
				<button
					type="button"
					class="mash-sticky-mode-btn"
					onclick={(e) => {
						e.stopPropagation();
						insertList();
					}}
					aria-label="List"
					title="List"
				>
					<List class="h-3 w-3" />
				</button>
				<button
					type="button"
					class="mash-sticky-mode-btn"
					onclick={(e) => {
						e.stopPropagation();
						insertWikilink();
					}}
					aria-label="Insert wikilink"
					title="Insert [[link]]"
				>
					<Link2 class="h-3 w-3" />
				</button>
				<span class="mash-sticky-toolbar-sep" aria-hidden="true"></span>
				<button
					type="button"
					class="mash-sticky-mode-btn"
					class:is-active={align === 'left'}
					onclick={(e) => {
						e.stopPropagation();
						setAlign('left');
					}}
					aria-label="Align left"
					aria-pressed={align === 'left'}
					title="Align left"
				>
					<AlignLeft class="h-3 w-3" />
				</button>
				<button
					type="button"
					class="mash-sticky-mode-btn"
					class:is-active={align === 'center'}
					onclick={(e) => {
						e.stopPropagation();
						setAlign('center');
					}}
					aria-label="Align center"
					aria-pressed={align === 'center'}
					title="Align center"
				>
					<AlignCenter class="h-3 w-3" />
				</button>
				<button
					type="button"
					class="mash-sticky-mode-btn"
					class:is-active={align === 'right'}
					onclick={(e) => {
						e.stopPropagation();
						setAlign('right');
					}}
					aria-label="Align right"
					aria-pressed={align === 'right'}
					title="Align right"
				>
					<AlignRight class="h-3 w-3" />
				</button>
			</div>
		{:else}
			<span class="px-1 text-[9px] text-[var(--mash-card-muted)]">Preview</span>
		{/if}
		<div class="flex items-center gap-0.5">
			<button
				type="button"
				class="mash-sticky-mode-btn"
				class:is-active={mode === 'edit'}
				onclick={(e) => {
					e.stopPropagation();
					setMode('edit');
				}}
				aria-label="Edit"
				title="Edit"
			>
				<Pencil class="h-3 w-3" />
			</button>
			<button
				type="button"
				class="mash-sticky-mode-btn"
				class:is-active={mode === 'preview'}
				onclick={(e) => {
					e.stopPropagation();
					setMode('preview');
				}}
				aria-label="Preview"
				title="Preview"
			>
				<Eye class="h-3 w-3" />
			</button>
		</div>
	</div>

	{#if mode === 'edit'}
		<div class="relative min-h-0 flex-1">
			<textarea
				bind:this={bodyEl}
				data-card-scroll
				value={body}
				placeholder="Write here… Use [[Note title]] for links."
				class="mash-sticky-body absolute inset-0 h-full w-full resize-none overflow-y-auto overscroll-contain bg-transparent px-3 py-2 text-[13px] leading-relaxed outline-none"
				style="color: var(--mash-card-ink); text-align: {align};"
				oninput={(e) => onBodyChange((e.currentTarget as HTMLTextAreaElement).value)}
				onpointerdown={(e) => e.stopPropagation()}
				onwheel={(e) => e.stopPropagation()}
			></textarea>
		</div>
	{:else}
		<!-- Preview HTML is produced by renderMarkdown (escapes raw HTML). -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			data-card-scroll
			class="mash-sticky-preview min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2 text-[13px] leading-relaxed"
			style="color: var(--mash-card-ink); text-align: {align};"
			role="article"
			onclick={onPreviewClick}
			onpointerdown={(e) => e.stopPropagation()}
			onwheel={(e) => e.stopPropagation()}
		>
			{#if body.trim()}
				{@html previewHtml}
			{:else}
				<p class="opacity-50">Nothing to preview yet…</p>
			{/if}
		</div>
	{/if}
</div>

<style>
	.mash-sticky-body {
		font-family: var(--mash-font-ui, 'IBM Plex Sans', sans-serif);
		caret-color: var(--mash-accent, #4f7a3e);
		scrollbar-width: thin;
		scrollbar-color: var(--mash-card-edge-strong) transparent;
	}
	.mash-sticky-body::placeholder {
		color: var(--mash-card-muted, #6b5e4e);
		opacity: 0.7;
	}
	.mash-sticky-toolbar-sep {
		display: inline-block;
		width: 1px;
		height: 14px;
		margin: 0 2px;
		background: var(--mash-card-edge-strong);
		opacity: 0.7;
	}
	.mash-sticky-mode-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		border-radius: 6px;
		color: var(--mash-card-muted, #6b5e4e);
		background: transparent;
		border: none;
		cursor: pointer;
	}
	.mash-sticky-mode-btn:hover {
		background: var(--mash-card-hover);
		color: var(--mash-card-ink, #2c2418);
	}
	.mash-sticky-mode-btn.is-active {
		background: var(--mash-accent-wash);
		color: var(--mash-accent, #4f7a3e);
	}
	.mash-sticky-preview :global(h1),
	.mash-sticky-preview :global(h2),
	.mash-sticky-preview :global(h3) {
		font-family: var(--mash-font-display, Georgia, serif);
		font-weight: 650;
		line-height: 1.25;
		margin: 0.6em 0 0.35em;
	}
	.mash-sticky-preview :global(h1) {
		font-size: 1.15em;
	}
	.mash-sticky-preview :global(h2) {
		font-size: 1.05em;
	}
	.mash-sticky-preview :global(h3) {
		font-size: 1em;
	}
	.mash-sticky-preview :global(p),
	.mash-sticky-preview :global(ul),
	.mash-sticky-preview :global(ol) {
		margin: 0.35em 0;
	}
	.mash-sticky-preview :global(ul),
	.mash-sticky-preview :global(ol) {
		padding-left: 1.25em;
	}
	.mash-sticky-preview :global(code) {
		font-size: 0.9em;
		padding: 0.1em 0.35em;
		border-radius: 4px;
		background: var(--mash-card-hover);
	}
	.mash-sticky-preview :global(pre) {
		overflow-x: auto;
		padding: 0.6em 0.75em;
		border-radius: 8px;
		background: var(--mash-card-hover);
		font-size: 0.85em;
		text-align: left;
	}
	.mash-sticky-preview :global(pre code) {
		padding: 0;
		background: none;
	}
	.mash-sticky-preview :global(a) {
		color: var(--mash-accent, #4f7a3e);
	}
	.mash-sticky-preview :global(blockquote) {
		margin: 0.4em 0;
		padding-left: 0.75em;
		border-left: 3px solid var(--mash-card-edge-strong);
		opacity: 0.9;
	}
	.mash-sticky-preview :global(.mash-wikilink) {
		color: var(--mash-accent, #4f7a3e);
		text-decoration: underline;
		text-underline-offset: 2px;
		cursor: pointer;
		background: none;
		border: none;
		padding: 0;
		font: inherit;
	}
	.mash-sticky-preview :global(.mash-wikilink:hover) {
		opacity: 0.85;
	}
</style>
