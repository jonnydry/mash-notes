<script lang="ts">
	import type { Snippet } from 'svelte';
	import { FileText, GripVertical, Inbox, X } from '@lucide/svelte';

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
						src="/icons/Rotating%20Icons/Mashed%20potato%20character@2x.png"
						alt="Scoop, the Mash mascot"
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
		grid-template-columns: minmax(0, 1fr) minmax(248px, 308px);
		gap: 14px;
		padding: 16px 20px 16px 100px;
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
		border-radius: 16px;
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
		gap: 10px 12px;
		min-height: 54px;
		padding: 0 12px 0 16px;
		border-bottom: 1px solid var(--mash-panel-border);
		background: color-mix(in srgb, var(--mash-panel) 90%, var(--mash-board));
	}
	.mash-pdf-file {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 8px;
		font-size: var(--mash-type-control);
		font-weight: 600;
		letter-spacing: -0.01em;
		color: var(--mash-ink);
	}
	.mash-pdf-file :global(svg) {
		flex-shrink: 0;
		color: var(--mash-ink-muted);
		opacity: 0.88;
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
		color: var(--mash-ink-muted);
		transition:
			background 120ms ease,
			color 120ms ease;
	}
	.mash-pdf-toolbar :global(button:hover:not(:disabled)) {
		background: var(--mash-hover-fill);
		color: var(--mash-ink);
	}
	.mash-pdf-toolbar :global(button:focus-visible) {
		outline: none;
		box-shadow:
			0 0 0 2px var(--mash-panel),
			0 0 0 4px var(--mash-accent-ring);
		color: var(--mash-ink);
	}
	.mash-pdf-toolbar :global(button:disabled) {
		opacity: 0.32;
	}
	.mash-pdf-close {
		margin-left: 2px;
		color: var(--mash-ink-muted);
	}
	.mash-pdf-clippings {
		display: flex;
		flex-direction: column;
	}
	.mash-pdf-clippings-title {
		display: flex;
		min-height: 64px;
		align-items: flex-start;
		gap: 10px;
		padding: 14px 16px 12px;
		border-bottom: 1px solid var(--mash-panel-border);
		background: color-mix(in srgb, var(--mash-panel) 92%, var(--mash-board));
	}
	.mash-pdf-clippings-title > :global(svg) {
		margin-top: 3px;
		color: var(--mash-accent);
		flex-shrink: 0;
	}
	.mash-pdf-clippings-title span {
		display: block;
		font-size: 18px;
		font-weight: 600;
		letter-spacing: -0.015em;
		line-height: 1.2;
	}
	.mash-pdf-clippings-title small {
		display: block;
		margin-top: 3px;
		color: var(--mash-ink-muted);
		font-size: var(--mash-type-micro);
		line-height: 1.35;
	}
	.mash-pdf-clipping-list {
		min-height: 0;
		flex: 1;
		overflow-y: auto;
		padding: 10px;
		scrollbar-width: thin;
	}
	.mash-pdf-clippings-empty {
		display: flex;
		height: 100%;
		min-height: 240px;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 28px 20px;
		text-align: center;
		border-radius: 12px;
		background: color-mix(in srgb, var(--mash-hover-fill-soft) 70%, transparent);
	}
	.mash-pdf-clippings-empty img {
		width: 68px;
		height: 68px;
		object-fit: contain;
		opacity: 0.96;
		filter: drop-shadow(0 6px 10px rgb(0 0 0 / 0.16));
	}
	.mash-pdf-clippings-empty p {
		margin: 14px 0 0;
		max-width: 16rem;
		font-family: var(--mash-font-display, Georgia, serif);
		font-size: 15px;
		line-height: 1.35;
		color: var(--mash-ink);
	}
	.mash-pdf-clippings-empty span {
		margin-top: 6px;
		max-width: 15rem;
		color: var(--mash-ink-muted);
		font-size: var(--mash-type-caption);
		line-height: 1.45;
	}
	.mash-pdf-clipping {
		position: relative;
		margin-bottom: 8px;
		padding: 11px 11px 12px;
		border: 1px solid var(--mash-tray-edge);
		border-radius: 12px;
		background: var(--mash-hover-fill-soft);
		transition:
			border-color 140ms ease,
			box-shadow 140ms ease;
	}
	.mash-pdf-clipping:last-child {
		margin-bottom: 0;
	}
	.mash-pdf-clipping.is-newest {
		border-color: color-mix(in srgb, var(--mash-accent) 55%, var(--mash-tray-edge));
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--mash-accent) 16%, transparent);
		background: color-mix(in srgb, var(--mash-accent-wash) 35%, var(--mash-hover-fill-soft));
	}
	.mash-pdf-clipping-meta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		min-height: 1rem;
		color: var(--mash-accent-bright);
		font-size: var(--mash-type-micro);
		font-weight: 600;
		letter-spacing: 0.01em;
	}
	.mash-pdf-clipping-meta :global(svg) {
		color: var(--mash-ink-muted);
		opacity: 0.55;
	}
	.mash-pdf-clipping p {
		margin-top: 7px;
		display: -webkit-box;
		overflow: hidden;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 4;
		line-clamp: 4;
		color: var(--mash-ink);
		font-size: var(--mash-type-caption);
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
		top: 8px;
		right: 28px;
		padding: 2px 7px;
		border-radius: 999px;
		background: var(--mash-accent-wash);
		color: var(--mash-accent-bright);
		font-size: var(--mash-type-micro);
		font-weight: 650;
		letter-spacing: 0.02em;
		text-transform: uppercase;
	}
	.mash-pdf-clippings-actions {
		padding: 12px;
		border-top: 1px solid var(--mash-panel-border);
		background: color-mix(in srgb, var(--mash-panel) 94%, var(--mash-board));
	}
	.mash-pdf-open-canvas,
	.mash-pdf-keep-reading {
		width: 100%;
		min-height: 38px;
		border-radius: 10px;
		font-size: var(--mash-type-caption);
		font-weight: 650;
		transition:
			background 140ms ease,
			color 140ms ease,
			opacity 140ms ease,
			border-color 140ms ease;
	}
	.mash-pdf-open-canvas {
		background: var(--mash-accent);
		color: var(--mash-accent-ink);
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.14);
	}
	.mash-pdf-open-canvas:hover:not(:disabled) {
		background: var(--mash-accent-bright);
	}
	.mash-pdf-open-canvas:disabled {
		opacity: 0.38;
	}
	.mash-pdf-open-canvas:focus-visible,
	.mash-pdf-keep-reading:focus-visible {
		outline: none;
		box-shadow:
			0 0 0 2px var(--mash-panel),
			0 0 0 4px var(--mash-accent-ring);
	}
	.mash-pdf-keep-reading {
		margin-top: 7px;
		border: 1px solid var(--mash-tray-edge);
		color: var(--mash-ink-muted);
	}
	.mash-pdf-keep-reading:hover {
		color: var(--mash-ink);
		background: var(--mash-hover-fill-soft);
		border-color: color-mix(in srgb, var(--mash-ink-muted) 40%, var(--mash-tray-edge));
	}
	.mash-pdf-clippings-actions p {
		margin: 9px 0 0;
		color: var(--mash-ink-muted);
		font-size: var(--mash-type-micro);
		line-height: 1.4;
		text-align: center;
		opacity: 0.9;
	}

	@media (max-width: 840px) {
		.mash-pdf-reader {
			grid-template-columns: 1fr;
			grid-template-rows: minmax(270px, 1fr) minmax(210px, 30vh);
			overflow: hidden;
			padding: 12px 12px 84px;
			gap: 10px;
		}
		.mash-pdf-clippings-title {
			min-height: 54px;
			padding: 10px 12px 8px;
		}
		.mash-pdf-clippings-title span {
			font-size: 16px;
		}
		.mash-pdf-clipping-list {
			padding: 8px;
		}
		.mash-pdf-clippings-actions {
			padding: 9px;
		}
		.mash-pdf-keep-reading,
		.mash-pdf-clippings-actions p {
			display: none;
		}
		.mash-pdf-toolbar {
			grid-template-columns: minmax(0, 1fr) auto auto auto;
			gap: 6px;
			min-height: 50px;
			padding: 0 8px 0 12px;
		}
	}
</style>
