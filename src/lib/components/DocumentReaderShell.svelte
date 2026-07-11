<script lang="ts">
	import type { Snippet } from 'svelte';
	import { FileText, GripVertical, Inbox, X } from 'lucide-svelte';

	export type DocumentReaderClipping = {
		id: string;
		text: string;
		meta?: string;
		imageDataUrl?: string;
	};

	interface Props {
		open?: boolean;
		fileName: string;
		ariaLabel: string;
		closeAriaLabel?: string;
		clippingsLabel: string;
		clippingsCountLabel: string;
		emptyClippingsHint: string;
		emptyClippingsSubhint?: string;
		onClose: () => void;
		onOpenClippings?: () => void;
		clippings: DocumentReaderClipping[];
		/** Toolbar controls between filename and close (page/zoom/region for PDF). */
		children?: Snippet;
		/** Main stage content. */
		stage: Snippet;
	}

	let {
		open = true,
		fileName,
		ariaLabel,
		closeAriaLabel = 'Close document reader',
		clippingsLabel,
		clippingsCountLabel,
		emptyClippingsHint,
		emptyClippingsSubhint,
		onClose,
		onOpenClippings,
		clippings,
		children,
		stage
	}: Props = $props();

	let mainEl: HTMLElement | undefined = $state();

	function scrollToStage() {
		mainEl
			?.querySelector('.mash-pdf-stage')
			?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
	}
</script>

<section class="mash-pdf-reader" class:is-hidden={!open} aria-label={ariaLabel}>
	<div class="mash-pdf-main" bind:this={mainEl}>
		<header class="mash-pdf-toolbar">
			<div class="mash-pdf-file" title={fileName}>
				<FileText size={17} aria-hidden="true" />
				<span>{fileName}</span>
			</div>
			{@render children?.()}
			<button type="button" class="mash-pdf-close" onclick={onClose} aria-label={closeAriaLabel}
				><X size={18} /></button
			>
		</header>

		{@render stage()}
	</div>

	<aside class="mash-pdf-clippings" aria-label={clippingsLabel}>
		<div class="mash-pdf-clippings-title">
			<Inbox size={18} aria-hidden="true" />
			<div>
				<span class="mash-display">Clippings</span>
				<small>{clippingsCountLabel}</small>
			</div>
		</div>
		<div class="mash-pdf-clipping-list" aria-live="polite">
			{#if clippings.length === 0}
				<div class="mash-pdf-clippings-empty">
					<img
						src="/icons/New%20Icons/Mashed%20potato%20character@2x.png"
						alt="Spoon, the Mash mascot"
					/>
					<p>{emptyClippingsHint}</p>
					{#if emptyClippingsSubhint}
						<span>{emptyClippingsSubhint}</span>
					{/if}
				</div>
			{:else}
				{#each clippings as clipping, index (clipping.id)}
					<article class="mash-pdf-clipping" class:is-newest={index === clippings.length - 1}>
						<div class="mash-pdf-clipping-meta">
							<span>{clipping.meta ?? ''}</span>
							<GripVertical size={15} aria-hidden="true" />
						</div>
						{#if clipping.imageDataUrl}
							<img
								class="mash-pdf-clipping-thumb"
								src={clipping.imageDataUrl}
								alt={clipping.meta ? `Clipping ${clipping.meta}` : 'Clipping'}
							/>
						{:else}
							<p>{clipping.text}</p>
						{/if}
						{#if index === clippings.length - 1}<span class="mash-pdf-new-badge">Just added</span
						>{/if}
					</article>
				{/each}
			{/if}
		</div>
		<div class="mash-pdf-clippings-actions">
			<button
				type="button"
				class="mash-pdf-open-canvas"
				disabled={clippings.length === 0 || !onOpenClippings}
				onclick={() => onOpenClippings?.()}
			>
				Open {clippings.length || ''} on canvas
			</button>
			<button type="button" class="mash-pdf-keep-reading" onclick={scrollToStage}
				>Keep reading</button
			>
			<p>Saved clippings are already available in your note library.</p>
		</div>
	</aside>
</section>

<style>
	.mash-pdf-reader {
		position: absolute;
		inset: 0;
		z-index: 20;
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(250px, 320px);
		gap: 16px;
		padding: 18px 24px 18px 100px;
		background: color-mix(in srgb, var(--mash-board) 97%, transparent);
		color: var(--mash-ink);
	}
	.mash-pdf-reader.is-hidden {
		display: none;
	}
	.mash-pdf-main,
	.mash-pdf-clippings {
		min-width: 0;
		border: 1px solid var(--mash-panel-border);
		border-radius: 18px;
		background: var(--mash-panel);
		box-shadow: var(--mash-shadow-lift);
		overflow: hidden;
	}
	.mash-pdf-main {
		display: flex;
		flex-direction: column;
	}
	.mash-pdf-toolbar {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto auto auto auto;
		align-items: center;
		gap: 14px;
		min-height: 58px;
		padding: 0 14px 0 18px;
		border-bottom: 1px solid var(--mash-panel-border);
		background: color-mix(in srgb, var(--mash-panel) 88%, var(--mash-board));
	}
	.mash-pdf-file {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 9px;
		font-size: 13px;
		font-weight: 600;
	}
	.mash-pdf-file span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/* Snippet toolbar controls render as descendants; style them via :global. */
	.mash-pdf-toolbar :global(button) {
		display: grid;
		place-items: center;
		width: 30px;
		height: 30px;
		border-radius: 8px;
		color: inherit;
	}
	.mash-pdf-toolbar :global(button:hover:not(:disabled)) {
		background: var(--mash-hover-fill);
		color: var(--mash-ink);
	}
	.mash-pdf-toolbar :global(button:disabled) {
		opacity: 0.32;
	}
	.mash-pdf-close {
		margin-left: 2px;
	}
	.mash-pdf-clippings {
		display: flex;
		flex-direction: column;
	}
	.mash-pdf-clippings-title {
		display: flex;
		min-height: 72px;
		align-items: flex-start;
		gap: 9px;
		padding: 18px 18px 14px;
		border-bottom: 1px solid var(--mash-panel-border);
	}
	.mash-pdf-clippings-title > :global(svg) {
		margin-top: 4px;
		color: var(--mash-accent);
	}
	.mash-pdf-clippings-title span {
		display: block;
		font-size: 20px;
		font-weight: 600;
	}
	.mash-pdf-clippings-title small {
		display: block;
		margin-top: 3px;
		color: var(--mash-ink-muted);
		font-size: 10px;
	}
	.mash-pdf-clipping-list {
		min-height: 0;
		flex: 1;
		overflow-y: auto;
		padding: 12px;
	}
	.mash-pdf-clippings-empty {
		display: flex;
		height: 100%;
		min-height: 280px;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 24px;
		text-align: center;
	}
	.mash-pdf-clippings-empty img {
		width: 72px;
		height: 72px;
		object-fit: contain;
		filter: drop-shadow(0 6px 8px rgb(0 0 0 / 0.18));
	}
	.mash-pdf-clippings-empty p {
		margin-top: 12px;
		font-family: var(--mash-font-display, Georgia, serif);
		font-size: 16px;
		line-height: 1.3;
	}
	.mash-pdf-clippings-empty span {
		margin-top: 6px;
		color: var(--mash-ink-muted);
		font-size: 11px;
		line-height: 1.45;
	}
	.mash-pdf-clipping {
		position: relative;
		margin-bottom: 10px;
		padding: 12px 12px 13px;
		border: 1px solid var(--mash-tray-edge);
		border-radius: 13px;
		background: var(--mash-hover-fill-soft);
	}
	.mash-pdf-clipping.is-newest {
		border-color: var(--mash-accent-select);
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--mash-accent) 18%, transparent);
	}
	.mash-pdf-clipping-meta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		color: var(--mash-accent-bright);
		font-size: 10px;
	}
	.mash-pdf-clipping p {
		margin-top: 8px;
		display: -webkit-box;
		overflow: hidden;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 4;
		line-clamp: 4;
		color: var(--mash-ink);
		font-size: 12px;
		line-height: 1.45;
	}
	.mash-pdf-clipping-thumb {
		display: block;
		width: 100%;
		max-height: 140px;
		margin-top: 8px;
		border-radius: 8px;
		object-fit: contain;
		background: color-mix(in srgb, var(--mash-board) 70%, white);
	}
	.mash-pdf-new-badge {
		position: absolute;
		top: 9px;
		right: 28px;
		padding: 2px 6px;
		border-radius: 999px;
		background: var(--mash-accent-wash);
		color: var(--mash-accent-bright);
		font-size: 8px;
		font-weight: 650;
	}
	.mash-pdf-clippings-actions {
		padding: 13px;
		border-top: 1px solid var(--mash-panel-border);
	}
	.mash-pdf-open-canvas,
	.mash-pdf-keep-reading {
		width: 100%;
		min-height: 40px;
		border-radius: 11px;
		font-size: 12px;
		font-weight: 650;
	}
	.mash-pdf-open-canvas {
		background: var(--mash-accent);
		color: var(--mash-accent-ink);
	}
	.mash-pdf-open-canvas:disabled {
		opacity: 0.38;
	}
	.mash-pdf-keep-reading {
		margin-top: 8px;
		border: 1px solid var(--mash-tray-edge);
		color: var(--mash-ink-muted);
	}
	.mash-pdf-keep-reading:hover {
		color: var(--mash-ink);
		background: var(--mash-hover-fill-soft);
	}
	.mash-pdf-clippings-actions p {
		margin-top: 9px;
		color: var(--mash-ink-muted);
		font-size: 9px;
		line-height: 1.4;
		text-align: center;
	}

	@media (max-width: 840px) {
		.mash-pdf-reader {
			grid-template-columns: 1fr;
			grid-template-rows: minmax(270px, 1fr) minmax(210px, 30vh);
			overflow: hidden;
			padding: 12px 12px 84px;
		}
		.mash-pdf-clippings-title {
			min-height: 58px;
			padding: 11px 14px 9px;
		}
		.mash-pdf-clippings-actions {
			padding: 10px;
		}
		.mash-pdf-keep-reading,
		.mash-pdf-clippings-actions p {
			display: none;
		}
		.mash-pdf-toolbar {
			grid-template-columns: minmax(0, 1fr) auto auto auto;
			gap: 7px;
			padding-left: 12px;
		}
	}
</style>
