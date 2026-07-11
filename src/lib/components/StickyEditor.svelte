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
		Lock,
		Maximize2,
		Pencil,
		RotateCcw,
		RotateCw,
		X,
		ZoomIn,
		ZoomOut
	} from 'lucide-svelte';
	import { focusTrap } from '$lib/focus-trap';
	import { rotateImageDataUrl } from '$lib/image-rotate';
	import { composeEmbeddedNoteImage, parseEmbeddedNoteImage, renderMarkdown } from '$lib/markdown';
	import { portal } from '$lib/portal';
	import type { TextAlign } from '$lib/types';

	const CLIP_ZOOM_MIN = 1;
	const CLIP_ZOOM_MAX = 4;
	const CLIP_ZOOM_STEP = 0.5;

	interface Props {
		body: string;
		noteId: string;
		textAlign?: TextAlign;
		autofocus?: boolean;
		mode?: 'edit' | 'preview';
		heroImage?: { src: string; alt: string } | null;
		readOnly?: boolean;
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
		heroImage = null,
		readOnly = false,
		onBodyChange,
		onTextAlignChange,
		onModeChange,
		onWikilink
	}: Props = $props();

	let bodyEl: HTMLTextAreaElement | undefined = $state();
	let focusedNoteId: string | null = null;
	let rotating = $state(false);
	let clipZoom = $state(1);
	let clipInspectOpen = $state(false);

	let embeddedImage = $derived(parseEmbeddedNoteImage(body));
	let editableText = $derived(embeddedImage ? embeddedImage.caption : body);
	let captionPreviewHtml = $derived(
		embeddedImage?.caption ? renderMarkdown(embeddedImage.caption) : ''
	);
	let previewHtml = $derived(mode === 'preview' ? renderMarkdown(body || '') : '');
	let align = $derived(textAlign === 'center' || textAlign === 'right' ? textAlign : 'left');
	let clipZoomLabel = $derived(`${Math.round(clipZoom * 100)}%`);

	$effect(() => {
		if (readOnly && mode !== 'preview') {
			mode = 'preview';
			onModeChange?.('preview');
		}
	});

	$effect(() => {
		void noteId;
		clipZoom = 1;
		clipInspectOpen = false;
	});

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

	function commitEditable(next: string) {
		if (embeddedImage) {
			onBodyChange(composeEmbeddedNoteImage(embeddedImage.alt, embeddedImage.src, next));
			return;
		}
		onBodyChange(next);
	}

	function changeClipZoom(delta: number) {
		const stepped = Math.round((clipZoom + delta) / CLIP_ZOOM_STEP) * CLIP_ZOOM_STEP;
		clipZoom = Math.min(CLIP_ZOOM_MAX, Math.max(CLIP_ZOOM_MIN, Number(stepped.toFixed(2))));
	}

	function clipZoomWheel(node: HTMLElement) {
		const onWheel = (event: WheelEvent) => {
			if (!(event.ctrlKey || event.metaKey)) return;
			event.preventDefault();
			event.stopPropagation();
			changeClipZoom(event.deltaY < 0 ? CLIP_ZOOM_STEP : -CLIP_ZOOM_STEP);
		};
		node.addEventListener('wheel', onWheel, { passive: false });
		return {
			destroy() {
				node.removeEventListener('wheel', onWheel);
			}
		};
	}

	async function rotateClip(quarterTurns: 1 | -1) {
		if (!embeddedImage || rotating || readOnly) return;
		rotating = true;
		try {
			const src = await rotateImageDataUrl(embeddedImage.src, quarterTurns);
			onBodyChange(composeEmbeddedNoteImage(embeddedImage.alt, src, embeddedImage.caption));
		} catch (cause) {
			console.error(cause);
		} finally {
			rotating = false;
		}
	}

	function onPreviewClick(e: MouseEvent) {
		const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-wikilink]');
		if (!btn) return;
		e.preventDefault();
		e.stopPropagation();
		const target = btn.dataset.wikilink;
		if (target) onWikilink?.(target);
	}

	function onInspectKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			clipInspectOpen = false;
			return;
		}
		if (event.key === '+' || event.key === '=') {
			event.preventDefault();
			changeClipZoom(CLIP_ZOOM_STEP);
			return;
		}
		if (event.key === '-' || event.key === '_') {
			event.preventDefault();
			changeClipZoom(-CLIP_ZOOM_STEP);
		}
	}

	function wrapOrInsert(before: string, after: string, placeholder = '') {
		const el = bodyEl;
		if (!el) return;
		const start = el.selectionStart;
		const end = el.selectionEnd;
		const selected = editableText.slice(start, end);
		const inner = selected || placeholder;
		const next = editableText.slice(0, start) + before + inner + after + editableText.slice(end);
		commitEditable(next);
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
		const selected = editableText.slice(start, end);
		if (selected.includes('\n')) {
			const listed = selected
				.split('\n')
				.map((line) => (line.trim() ? `- ${line.replace(/^[-*]\s+/, '')}` : line))
				.join('\n');
			const next = editableText.slice(0, start) + listed + editableText.slice(end);
			commitEditable(next);
			requestAnimationFrame(() => {
				bodyEl?.focus();
				bodyEl?.setSelectionRange(start, start + listed.length);
			});
			return;
		}
		const lineStart = editableText.lastIndexOf('\n', start - 1) + 1;
		const prefix = editableText.slice(lineStart, start).startsWith('- ') ? '' : '- ';
		if (!prefix && !selected) {
			wrapOrInsert('- ', '', 'item');
			return;
		}
		if (prefix) {
			const next = editableText.slice(0, lineStart) + prefix + editableText.slice(lineStart);
			commitEditable(next);
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
	<div
		class="flex shrink-0 items-center justify-between gap-0.5 border-b border-[var(--mash-card-edge)] px-1.5 py-0.5"
	>
		{#if mode === 'edit' && !readOnly}
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
		{:else if readOnly}
			<span
				class="flex items-center gap-1 px-1 text-[9px] font-medium text-[var(--mash-card-muted)]"
			>
				<Lock class="h-2.5 w-2.5" /> From the Mash team · permanent
			</span>
		{:else}
			<span class="px-1 text-[9px] font-medium text-[var(--mash-card-muted)]">Preview</span>
		{/if}
		<div class="flex items-center gap-0.5">
			{#if embeddedImage}
				<button
					type="button"
					class="mash-sticky-mode-btn"
					disabled={clipZoom <= CLIP_ZOOM_MIN}
					onclick={(e) => {
						e.stopPropagation();
						changeClipZoom(-CLIP_ZOOM_STEP);
					}}
					aria-label="Zoom out"
					title="Zoom out"
				>
					<ZoomOut class="h-3 w-3" />
				</button>
				<span class="mash-sticky-zoom-label" title="Image zoom">{clipZoomLabel}</span>
				<button
					type="button"
					class="mash-sticky-mode-btn"
					disabled={clipZoom >= CLIP_ZOOM_MAX}
					onclick={(e) => {
						e.stopPropagation();
						changeClipZoom(CLIP_ZOOM_STEP);
					}}
					aria-label="Zoom in"
					title="Zoom in"
				>
					<ZoomIn class="h-3 w-3" />
				</button>
				<button
					type="button"
					class="mash-sticky-mode-btn"
					onclick={(e) => {
						e.stopPropagation();
						clipInspectOpen = true;
					}}
					aria-label="Inspect image"
					title="Inspect image"
				>
					<Maximize2 class="h-3 w-3" />
				</button>
				{#if !readOnly}
					<span class="mash-sticky-toolbar-sep" aria-hidden="true"></span>
					<button
						type="button"
						class="mash-sticky-mode-btn"
						disabled={rotating}
						onclick={(e) => {
							e.stopPropagation();
							void rotateClip(-1);
						}}
						aria-label="Rotate left"
						title="Rotate left"
					>
						<RotateCcw class="h-3 w-3" />
					</button>
					<button
						type="button"
						class="mash-sticky-mode-btn"
						disabled={rotating}
						onclick={(e) => {
							e.stopPropagation();
							void rotateClip(1);
						}}
						aria-label="Rotate right"
						title="Rotate right"
					>
						<RotateCw class="h-3 w-3" />
					</button>
				{/if}
				<span class="mash-sticky-toolbar-sep" aria-hidden="true"></span>
			{/if}
			{#if !readOnly}
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
			{/if}
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

	{#if heroImage}
		<div class="mash-sticky-hero-wrap shrink-0" aria-label="Spoon logo">
			<img class="mash-sticky-hero" src={heroImage.src} alt={heroImage.alt} />
		</div>
	{/if}

	{#if embeddedImage}
		<div class="relative flex min-h-0 flex-1 flex-col">
			<div
				class="mash-sticky-clip-viewport"
				class:is-zoomed={clipZoom > 1}
				style="--clip-zoom: {clipZoom};"
				data-card-scroll
				use:clipZoomWheel
				onpointerdown={(e) => e.stopPropagation()}
			>
				<button
					type="button"
					class="mash-sticky-clip-hit"
					onclick={(e) => {
						e.stopPropagation();
						clipInspectOpen = true;
					}}
					aria-label="Inspect image clipping"
					title="Click to inspect"
				>
					<img
						class="mash-sticky-clip"
						src={embeddedImage.src}
						alt={embeddedImage.alt || 'Note image'}
						draggable="false"
					/>
				</button>
			</div>
			{#if mode === 'edit' && !readOnly}
				<textarea
					bind:this={bodyEl}
					data-card-scroll
					value={editableText}
					placeholder="Add a caption…"
					class="mash-sticky-body is-caption min-h-0 w-full resize-none overflow-y-auto overscroll-contain bg-transparent px-3 py-2 text-[13px] leading-relaxed outline-none"
					style="color: var(--mash-card-ink); text-align: {align};"
					oninput={(e) => commitEditable((e.currentTarget as HTMLTextAreaElement).value)}
					onpointerdown={(e) => e.stopPropagation()}
					onwheel={(e) => e.stopPropagation()}
				></textarea>
			{:else if embeddedImage.caption.trim()}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
				<div
					data-card-scroll
					class="mash-sticky-preview mash-sticky-clip-caption px-3 py-2 text-[13px] leading-relaxed"
					style="color: var(--mash-card-ink); text-align: {align};"
					role="article"
					onclick={onPreviewClick}
					onpointerdown={(e) => e.stopPropagation()}
					onwheel={(e) => e.stopPropagation()}
				>
					<!-- eslint-disable-next-line svelte/no-at-html-tags -- renderMarkdown escapes raw HTML. -->
					{@html captionPreviewHtml}
				</div>
			{/if}
		</div>
	{:else if mode === 'edit'}
		<div class="relative min-h-0 flex-1">
			<textarea
				bind:this={bodyEl}
				data-card-scroll
				value={editableText}
				placeholder="Write here… Use [[Note title]] for links."
				class="mash-sticky-body absolute inset-0 h-full w-full resize-none overflow-y-auto overscroll-contain bg-transparent px-3 py-2 text-[13px] leading-relaxed outline-none"
				style="color: var(--mash-card-ink); text-align: {align};"
				oninput={(e) => commitEditable((e.currentTarget as HTMLTextAreaElement).value)}
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
				<!-- eslint-disable-next-line svelte/no-at-html-tags -- renderMarkdown escapes raw HTML before producing previewHtml. -->
				{@html previewHtml}
			{:else}
				<p class="opacity-50">Nothing to preview yet…</p>
			{/if}
		</div>
	{/if}
</div>

{#if clipInspectOpen && embeddedImage}
	<div
		use:portal
		use:focusTrap={{ initialFocus: '[data-dialog-initial-focus]' }}
		class="mash-clip-inspect"
		role="dialog"
		aria-modal="true"
		aria-label="Inspect image clipping"
		tabindex="-1"
		onkeydown={onInspectKeydown}
		onpointerdown={(e) => e.stopPropagation()}
	>
		<div
			class="mash-clip-inspect-backdrop"
			role="presentation"
			onclick={() => (clipInspectOpen = false)}
		></div>
		<div class="mash-clip-inspect-panel">
			<header class="mash-clip-inspect-toolbar">
				<span class="mash-clip-inspect-title">{embeddedImage.alt || 'Image clipping'}</span>
				<div class="mash-clip-inspect-actions">
					<button
						type="button"
						class="mash-sticky-mode-btn"
						disabled={clipZoom <= CLIP_ZOOM_MIN}
						onclick={() => changeClipZoom(-CLIP_ZOOM_STEP)}
						aria-label="Zoom out"
						title="Zoom out"
					>
						<ZoomOut class="h-3.5 w-3.5" />
					</button>
					<span class="mash-sticky-zoom-label">{clipZoomLabel}</span>
					<button
						type="button"
						class="mash-sticky-mode-btn"
						disabled={clipZoom >= CLIP_ZOOM_MAX}
						data-dialog-initial-focus
						onclick={() => changeClipZoom(CLIP_ZOOM_STEP)}
						aria-label="Zoom in"
						title="Zoom in"
					>
						<ZoomIn class="h-3.5 w-3.5" />
					</button>
					{#if !readOnly}
						<span class="mash-sticky-toolbar-sep" aria-hidden="true"></span>
						<button
							type="button"
							class="mash-sticky-mode-btn"
							disabled={rotating}
							onclick={() => void rotateClip(-1)}
							aria-label="Rotate left"
							title="Rotate left"
						>
							<RotateCcw class="h-3.5 w-3.5" />
						</button>
						<button
							type="button"
							class="mash-sticky-mode-btn"
							disabled={rotating}
							onclick={() => void rotateClip(1)}
							aria-label="Rotate right"
							title="Rotate right"
						>
							<RotateCw class="h-3.5 w-3.5" />
						</button>
					{/if}
					<button
						type="button"
						class="mash-sticky-mode-btn"
						onclick={() => (clipInspectOpen = false)}
						aria-label="Close"
						title="Close"
					>
						<X class="h-3.5 w-3.5" />
					</button>
				</div>
			</header>
			<div
				class="mash-clip-inspect-viewport"
				class:is-zoomed={clipZoom > 1}
				style="--clip-zoom: {clipZoom};"
				use:clipZoomWheel
			>
				<img
					src={embeddedImage.src}
					alt={embeddedImage.alt || 'Note image'}
					draggable="false"
				/>
			</div>
		</div>
	</div>
{/if}

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
	.mash-sticky-zoom-label {
		min-width: 2.4rem;
		padding: 0 2px;
		color: var(--mash-card-muted, #6b5e4e);
		font-size: 9px;
		font-variant-numeric: tabular-nums;
		text-align: center;
	}
	.mash-sticky-hero-wrap {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 88px;
		padding: 8px 12px 4px;
		background: color-mix(in srgb, var(--mash-card-hover) 55%, transparent);
	}
	.mash-sticky-hero {
		display: block;
		width: auto;
		height: 80px;
		max-width: 100%;
		object-fit: contain;
		filter: drop-shadow(0 5px 8px color-mix(in srgb, var(--mash-card-ink) 12%, transparent));
	}
	.mash-sticky-clip-viewport {
		min-height: 0;
		flex: 1 1 auto;
		max-height: min(52vh, 420px);
		overflow: auto;
		padding: 8px 12px 0;
		overscroll-behavior: contain;
		scrollbar-width: thin;
	}
	.mash-sticky-clip-viewport.is-zoomed {
		max-height: min(60vh, 520px);
	}
	.mash-sticky-clip-hit {
		display: block;
		width: 100%;
		margin: 0 auto;
		padding: 0;
		border: none;
		background: transparent;
		cursor: zoom-in;
	}
	.mash-sticky-clip-viewport.is-zoomed .mash-sticky-clip-hit {
		width: calc(100% * var(--clip-zoom, 1));
	}
	.mash-sticky-clip {
		display: block;
		width: 100%;
		max-height: min(48vh, 400px);
		border-radius: 8px;
		object-fit: contain;
		background: color-mix(in srgb, var(--mash-card-hover) 70%, transparent);
	}
	.mash-sticky-clip-viewport.is-zoomed .mash-sticky-clip {
		max-height: none;
	}
	.mash-sticky-clip-caption {
		flex: 0 1 auto;
		max-height: 30%;
		overflow: auto;
		border-top: 1px solid var(--mash-card-edge);
	}
	.mash-sticky-body.is-caption {
		flex: 0 1 auto;
		min-height: 4.5rem;
		max-height: 30%;
		border-top: 1px solid var(--mash-card-edge);
	}
	.mash-clip-inspect {
		position: fixed;
		inset: 0;
		z-index: 80;
		display: grid;
		place-items: center;
		padding: 24px;
	}
	.mash-clip-inspect-backdrop {
		position: absolute;
		inset: 0;
		background: rgb(20 16 12 / 0.62);
		backdrop-filter: blur(6px);
	}
	.mash-clip-inspect-panel {
		position: relative;
		z-index: 1;
		display: flex;
		flex-direction: column;
		width: min(960px, 100%);
		height: min(860px, 100%);
		overflow: hidden;
		border: 1px solid var(--mash-panel-border, var(--mash-card-edge));
		border-radius: 16px;
		background: var(--mash-panel, var(--mash-card-hover));
		box-shadow: 0 24px 64px rgb(0 0 0 / 0.35);
		color: var(--mash-ink, var(--mash-card-ink));
	}
	.mash-clip-inspect-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 10px 12px;
		border-bottom: 1px solid var(--mash-tray-edge, var(--mash-card-edge));
	}
	.mash-clip-inspect-title {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 13px;
		font-weight: 600;
	}
	.mash-clip-inspect-actions {
		display: flex;
		align-items: center;
		gap: 2px;
	}
	.mash-clip-inspect-viewport {
		min-height: 0;
		flex: 1;
		overflow: auto;
		padding: 18px;
		overscroll-behavior: contain;
		background: color-mix(in srgb, var(--mash-board, #efe6d8) 70%, transparent);
	}
	.mash-clip-inspect-viewport img {
		display: block;
		width: min(100%, 720px);
		max-height: 100%;
		margin: 0 auto;
		border-radius: 10px;
		object-fit: contain;
		background: white;
		box-shadow: 0 12px 32px rgb(0 0 0 / 0.18);
	}
	.mash-clip-inspect-viewport.is-zoomed img {
		width: calc(min(100%, 720px) * var(--clip-zoom, 1));
		max-width: none;
		max-height: none;
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
	.mash-sticky-mode-btn:disabled {
		opacity: 0.4;
		cursor: default;
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
	.mash-sticky-preview :global(img) {
		display: block;
		max-width: 100%;
		height: auto;
		margin: 0.4em 0;
		border-radius: 6px;
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
