<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import {
		ChevronLeft,
		ChevronRight,
		FileText,
		GripVertical,
		Inbox,
		Minus,
		Plus,
		X
	} from 'lucide-svelte';
	import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
	import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
	import 'pdfjs-dist/web/pdf_viewer.css';
	import type { PdfClipping } from '$lib/pdf-clipping';
	import { normalizePdfExcerpt } from '$lib/pdf-clipping';

	interface Props {
		file: File;
		clippings: PdfClipping[];
		open?: boolean;
		initialPage?: number;
		initialZoom?: number;
		onClose: () => void;
		onClip: (excerpt: { text: string; page: number }) => void | Promise<void>;
		onOpenClippings: (noteIds: string[]) => void | Promise<void>;
		onViewChange?: (view: { page: number; zoom: number }) => void;
	}

	let {
		file,
		clippings,
		open = true,
		initialPage = 1,
		initialZoom = 1,
		onClose,
		onClip,
		onOpenClippings,
		onViewChange
	}: Props = $props();

	let pdfDocument: PDFDocumentProxy | null = null;
	let loadingTask: PDFDocumentLoadingTask | null = null;
	let renderTask: RenderTask | null = null;
	let stageEl: HTMLElement | undefined = $state();
	let canvasEl: HTMLCanvasElement | undefined = $state();
	let textLayerEl: HTMLDivElement | undefined = $state();
	let pageShellEl: HTMLDivElement | undefined = $state();
	let stageWidth = $state(0);
	let pageNumber = $state(1);
	let pageCount = $state(0);
	let zoom = $state(1);
	let pageWidth = $state(0);
	let pageHeight = $state(0);
	let loading = $state(true);
	let error = $state('');
	let renderReadyTick = $state(0);
	let selectionText = $state('');
	let selectionPoint = $state({ left: 0, top: 0 });
	let savingExcerpt = $state(false);
	let renderRevision = 0;
	let resizeObserver: ResizeObserver | null = null;
	let disposed = false;

	onMount(() => {
		pageNumber = initialPage;
		zoom = initialZoom;
		resizeObserver = new ResizeObserver(([entry]) => {
			stageWidth = entry?.contentRect.width ?? stageEl?.clientWidth ?? 0;
		});
		if (stageEl) resizeObserver.observe(stageEl);
		void loadPdf();
	});

	onDestroy(() => {
		disposed = true;
		renderRevision++;
		resizeObserver?.disconnect();
		renderTask?.cancel();
		pdfDocument = null;
		void loadingTask?.destroy();
		loadingTask = null;
	});

	$effect(() => {
		const renderState = { pageNumber, zoom, stageWidth, renderReadyTick };
		if (pdfDocument && renderState.stageWidth > 0) void renderPage();
	});

	async function loadPdf() {
		loading = true;
		error = '';
		try {
			const pdfjs = await import('pdfjs-dist');
			pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
			const bytes = new Uint8Array(await file.arrayBuffer());
			loadingTask = pdfjs.getDocument({ data: bytes });
			pdfDocument = await loadingTask.promise;
			if (disposed) return;
			pageCount = pdfDocument.numPages;
			pageNumber = Math.min(Math.max(1, pageNumber), pageCount);
			renderReadyTick++;
		} catch (cause) {
			if (disposed) return;
			console.error(cause);
			error = 'Mash couldn’t open this PDF. It may be damaged or password protected.';
			loading = false;
		}
	}

	async function renderPage() {
		if (!pdfDocument || !canvasEl || !textLayerEl || stageWidth <= 0) return;
		const revision = ++renderRevision;
		renderTask?.cancel();
		selectionText = '';
		loading = true;
		error = '';
		try {
			const pdfjs = await import('pdfjs-dist');
			const page = await pdfDocument.getPage(pageNumber);
			if (revision !== renderRevision) return;
			const natural = page.getViewport({ scale: 1 });
			const available = Math.max(320, Math.min(stageWidth - 56, 920));
			const fitScale = Math.min(1.55, available / natural.width);
			const viewport = page.getViewport({ scale: fitScale * zoom });
			const outputScale = Math.min(window.devicePixelRatio || 1, 2);
			const canvas = canvasEl;
			const context = canvas.getContext('2d', { alpha: false });
			if (!context) throw new Error('Canvas unavailable');

			pageWidth = viewport.width;
			pageHeight = viewport.height;
			canvas.width = Math.floor(viewport.width * outputScale);
			canvas.height = Math.floor(viewport.height * outputScale);
			canvas.style.width = `${viewport.width}px`;
			canvas.style.height = `${viewport.height}px`;
			renderTask = page.render({
				canvas,
				canvasContext: context,
				viewport,
				transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0]
			});
			await renderTask.promise;
			if (revision !== renderRevision) return;

			// PDF.js owns the contents of its text-layer container.
			// eslint-disable-next-line svelte/no-dom-manipulating
			textLayerEl.replaceChildren();
			const textContent = await page.getTextContent();
			const textLayer = new pdfjs.TextLayer({
				textContentSource: textContent,
				container: textLayerEl,
				viewport
			});
			await textLayer.render();
			if (revision === renderRevision) loading = false;
		} catch (cause) {
			if (cause instanceof Error && cause.name === 'RenderingCancelledException') return;
			console.error(cause);
			if (revision === renderRevision) {
				error = 'This page couldn’t be rendered.';
				loading = false;
			}
		}
	}

	function changePage(delta: number) {
		if (!pageCount) return;
		pageNumber = Math.min(pageCount, Math.max(1, pageNumber + delta));
		onViewChange?.({ page: pageNumber, zoom });
	}

	function changeZoom(delta: number) {
		zoom = Math.min(1.8, Math.max(0.65, Math.round((zoom + delta) * 10) / 10));
		onViewChange?.({ page: pageNumber, zoom });
	}

	function captureSelection() {
		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !textLayerEl) {
			selectionText = '';
			return;
		}
		const range = selection.getRangeAt(0);
		if (!textLayerEl.contains(range.commonAncestorContainer)) {
			selectionText = '';
			return;
		}
		const text = normalizePdfExcerpt(selection.toString());
		if (!text) {
			selectionText = '';
			return;
		}
		selectionText = text;
		const rangeRect = range.getBoundingClientRect();
		const shellRect = pageShellEl?.getBoundingClientRect();
		if (!shellRect) return;
		selectionPoint = {
			left: Math.min(pageWidth - 148, Math.max(12, rangeRect.right - shellRect.left + 10)),
			top: Math.min(pageHeight - 48, Math.max(12, rangeRect.bottom - shellRect.top + 8))
		};
	}

	async function saveSelection() {
		if (!selectionText || savingExcerpt) return;
		savingExcerpt = true;
		try {
			await onClip({ text: selectionText, page: pageNumber });
			selectionText = '';
			window.getSelection()?.removeAllRanges();
		} finally {
			savingExcerpt = false;
		}
	}
</script>

<section class="mash-pdf-reader" class:is-hidden={!open} aria-label="PDF reader">
	<div class="mash-pdf-main">
		<header class="mash-pdf-toolbar">
			<div class="mash-pdf-file" title={file.name}>
				<FileText size={17} aria-hidden="true" />
				<span>{file.name}</span>
			</div>
			<div class="mash-pdf-page-controls" aria-label="PDF page controls">
				<button
					type="button"
					onclick={() => changePage(-1)}
					disabled={pageNumber <= 1}
					aria-label="Previous page"
				>
					<ChevronLeft size={17} />
				</button>
				<span><strong>{pageNumber}</strong> / {pageCount || '—'}</span>
				<button
					type="button"
					onclick={() => changePage(1)}
					disabled={pageNumber >= pageCount}
					aria-label="Next page"
				>
					<ChevronRight size={17} />
				</button>
			</div>
			<div class="mash-pdf-zoom" aria-label="PDF zoom controls">
				<button type="button" onclick={() => changeZoom(-0.1)} aria-label="Zoom out"
					><Minus size={15} /></button
				>
				<span>{Math.round(zoom * 100)}%</span>
				<button type="button" onclick={() => changeZoom(0.1)} aria-label="Zoom in"
					><Plus size={15} /></button
				>
			</div>
			<button type="button" class="mash-pdf-close" onclick={onClose} aria-label="Close PDF reader"
				><X size={18} /></button
			>
		</header>

		<section
			bind:this={stageEl}
			class="mash-pdf-stage"
			aria-label="PDF page viewport"
			onpointerup={() => window.setTimeout(captureSelection, 0)}
		>
			{#if error}
				<div class="mash-pdf-error" role="alert">
					<FileText size={30} />
					<p>{error}</p>
					<button type="button" onclick={onClose}>Back to canvas</button>
				</div>
			{:else}
				<div
					bind:this={pageShellEl}
					class="mash-pdf-page"
					style="width: {pageWidth || 640}px; height: {pageHeight || 820}px;"
				>
					<canvas bind:this={canvasEl} aria-label="PDF page {pageNumber}"></canvas>
					<div bind:this={textLayerEl} class="textLayer" aria-label="Selectable PDF text"></div>
					{#if selectionText}
						<button
							type="button"
							class="mash-pdf-save-selection"
							style="left: {selectionPoint.left}px; top: {selectionPoint.top}px;"
							onclick={() => void saveSelection()}
							disabled={savingExcerpt}
						>
							{savingExcerpt ? 'Saving…' : 'Save excerpt'}
						</button>
					{/if}
					{#if loading}
						<div class="mash-pdf-page-loading">Rendering page…</div>
					{/if}
				</div>
			{/if}
		</section>
	</div>

	<aside class="mash-pdf-clippings" aria-label="PDF clippings">
		<div class="mash-pdf-clippings-title">
			<Inbox size={18} aria-hidden="true" />
			<div>
				<span class="mash-display">Clippings</span>
				<small>{clippings.length} saved from this PDF</small>
			</div>
		</div>
		<div class="mash-pdf-clipping-list" aria-live="polite">
			{#if clippings.length === 0}
				<div class="mash-pdf-clippings-empty">
					<img
						src="/icons/New%20Icons/Mashed%20potato%20character@2x.png"
						alt="Spoon, the Mash mascot"
					/>
					<p>Select useful text in the PDF, then save the excerpt.</p>
					<span>Each clipping keeps its page reference.</span>
				</div>
			{:else}
				{#each clippings as clipping, index (clipping.id)}
					<article class="mash-pdf-clipping" class:is-newest={index === clippings.length - 1}>
						<div class="mash-pdf-clipping-meta">
							<span>p. {clipping.page}</span>
							<GripVertical size={15} aria-hidden="true" />
						</div>
						<p>{clipping.text}</p>
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
				disabled={clippings.length === 0}
				onclick={() => void onOpenClippings(clippings.map((clipping) => clipping.noteId))}
			>
				Open {clippings.length || ''} on canvas
			</button>
			<button
				type="button"
				class="mash-pdf-keep-reading"
				onclick={() => stageEl?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })}
				>Keep reading</button
			>
			<p>Saved excerpts are already available in your note library.</p>
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
		grid-template-columns: minmax(0, 1fr) auto auto auto;
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
	.mash-pdf-page-controls,
	.mash-pdf-zoom {
		display: flex;
		align-items: center;
		gap: 7px;
		color: var(--mash-ink-muted);
		font-size: 12px;
	}
	.mash-pdf-toolbar button {
		display: grid;
		place-items: center;
		width: 30px;
		height: 30px;
		border-radius: 8px;
		color: inherit;
	}
	.mash-pdf-toolbar button:hover:not(:disabled) {
		background: var(--mash-hover-fill);
		color: var(--mash-ink);
	}
	.mash-pdf-toolbar button:disabled {
		opacity: 0.32;
	}
	.mash-pdf-zoom {
		gap: 2px;
		padding: 2px;
		border: 1px solid var(--mash-tray-edge);
		border-radius: 9px;
	}
	.mash-pdf-zoom span {
		min-width: 45px;
		text-align: center;
	}
	.mash-pdf-close {
		margin-left: 2px;
	}
	.mash-pdf-stage {
		position: relative;
		min-height: 0;
		flex: 1;
		overflow: auto;
		padding: 28px;
		background: color-mix(in srgb, var(--mash-board) 82%, var(--mash-panel));
		outline: none;
	}
	.mash-pdf-page {
		position: relative;
		margin: 0 auto;
		background: white;
		box-shadow: 0 18px 48px rgb(0 0 0 / 0.28);
	}
	.mash-pdf-page canvas {
		display: block;
	}
	.mash-pdf-page :global(.textLayer) {
		inset: 0;
		user-select: text;
	}
	.mash-pdf-page :global(.textLayer ::selection) {
		background: color-mix(in srgb, var(--mash-accent) 42%, transparent);
	}
	.mash-pdf-save-selection {
		position: absolute;
		z-index: 5;
		min-width: 124px;
		padding: 8px 13px;
		border-radius: 999px;
		background: var(--mash-accent);
		color: var(--mash-accent-ink);
		font-size: 12px;
		font-weight: 650;
		box-shadow: 0 8px 24px rgb(0 0 0 / 0.28);
	}
	.mash-pdf-page-loading {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		background: rgb(255 255 255 / 0.72);
		color: #5d5144;
		font-size: 12px;
	}
	.mash-pdf-error {
		display: grid;
		min-height: 70%;
		place-items: center;
		align-content: center;
		gap: 12px;
		text-align: center;
		color: var(--mash-ink-muted);
	}
	.mash-pdf-error p {
		max-width: 360px;
	}
	.mash-pdf-error button {
		padding: 8px 14px;
		border-radius: 9px;
		background: var(--mash-accent);
		color: var(--mash-accent-ink);
		font-size: 12px;
		font-weight: 650;
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
			grid-template-columns: minmax(0, 1fr) auto auto;
			gap: 7px;
			padding-left: 12px;
		}
		.mash-pdf-page-controls {
			display: none;
		}
		.mash-pdf-stage {
			padding: 16px;
		}
	}
</style>
