<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { ChevronLeft, ChevronRight, Crop, FileText, Minus, Plus } from 'lucide-svelte';
	import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
	import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
	import type { CssRect, PdfClipPayload, PdfClipping } from '$lib/pdf-clipping';
	import { cropPdfCanvasRegion, normalizePdfExcerpt, normalizeRegionRect } from '$lib/pdf-clipping';
	import {
		PDFJS_CMAP_URL,
		PDFJS_ICC_URL,
		PDFJS_STANDARD_FONT_URL,
		PDFJS_WASM_URL
	} from '$lib/pdfjs-assets';
	import { ensurePdfJsMapPolyfills } from '$lib/pdfjs-polyfills';
	import DocumentReaderShell from './DocumentReaderShell.svelte';

	/** Stay under common browser canvas limits (Safari is especially strict). */
	const MAX_CANVAS_PIXELS = 16_777_216;
	const MAX_CANVAS_EDGE = 8192;
	const MIN_REGION_PX = 12;

	interface Props {
		file: File;
		clippings: PdfClipping[];
		open?: boolean;
		initialPage?: number;
		initialZoom?: number;
		onClose: () => void;
		onClip: (excerpt: PdfClipPayload) => void | Promise<void>;
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
	let textLayerTask: { cancel: () => void } | null = null;
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
	let pageError = $state('');
	let renderReadyTick = $state(0);
	let selectionText = $state('');
	let selectionPoint = $state({ left: 0, top: 0 });
	let savingExcerpt = $state(false);
	let regionMode = $state(false);
	let regionDraft = $state<CssRect | null>(null);
	let regionPending = $state<CssRect | null>(null);
	let regionDragging = false;
	let regionOrigin = { x: 0, y: 0 };
	let renderRevision = 0;
	let resizeObserver: ResizeObserver | null = null;
	let disposed = false;
	let stageWidthTimer: ReturnType<typeof setTimeout> | null = null;

	let regionSavePoint = $derived.by(() => {
		const rect = regionPending ?? regionDraft;
		if (!rect) return { left: 12, top: 12 };
		return {
			left: Math.min(pageWidth - 148, Math.max(12, rect.x + rect.w + 10)),
			top: Math.min(pageHeight - 48, Math.max(12, rect.y + rect.h + 8))
		};
	});

	let shellClippings = $derived(
		clippings.map((clipping) => ({
			id: clipping.id,
			text: clipping.text,
			meta: `p. ${clipping.page}`,
			imageDataUrl: clipping.imageDataUrl
		}))
	);

	function assetUrl(path: string): string {
		if (typeof window === 'undefined') return path;
		return new URL(path, window.location.origin).href;
	}

	function isCancelError(cause: unknown): boolean {
		if (!(cause instanceof Error)) return false;
		return (
			cause.name === 'RenderingCancelledException' ||
			cause.name === 'AbortException' ||
			cause.message === 'TextLayer task cancelled.'
		);
	}

	function errorDetail(cause: unknown): string {
		if (cause instanceof Error && cause.message.trim()) return cause.message.trim();
		return 'Unknown render error';
	}

	function safeCssScale(
		naturalWidth: number,
		naturalHeight: number,
		preferredCss: number,
		deviceScale: number
	): number {
		const width = Math.max(1, naturalWidth);
		const height = Math.max(1, naturalHeight);
		const dpr = Math.max(1, deviceScale);
		const byArea = Math.sqrt(MAX_CANVAS_PIXELS / (width * height)) / dpr;
		const byWidth = MAX_CANVAS_EDGE / (width * dpr);
		const byHeight = MAX_CANVAS_EDGE / (height * dpr);
		return Math.max(0.05, Math.min(preferredCss, byArea, byWidth, byHeight));
	}

	onMount(() => {
		pageNumber = initialPage;
		zoom = initialZoom;
		resizeObserver = new ResizeObserver(([entry]) => {
			const next = Math.round(entry?.contentRect.width ?? stageEl?.clientWidth ?? 0);
			if (next <= 0 || next === stageWidth) return;
			if (stageWidthTimer) clearTimeout(stageWidthTimer);
			stageWidthTimer = setTimeout(() => {
				stageWidth = next;
			}, 120);
		});
		if (stageEl) {
			resizeObserver.observe(stageEl);
			stageWidth = Math.round(stageEl.clientWidth);
		}
		void loadPdf();
	});

	onDestroy(() => {
		disposed = true;
		renderRevision++;
		if (stageWidthTimer) clearTimeout(stageWidthTimer);
		resizeObserver?.disconnect();
		renderTask?.cancel();
		textLayerTask?.cancel();
		textLayerTask = null;
		const doc = pdfDocument;
		pdfDocument = null;
		// pdfjs 6: PDFDocumentProxy exposes cleanup(); destroy() is on the loading task.
		void doc?.cleanup();
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
		pageError = '';
		try {
			ensurePdfJsMapPolyfills();
			const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
			pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
			const bytes = new Uint8Array(await file.arrayBuffer());
			loadingTask = pdfjs.getDocument({
				data: bytes,
				cMapUrl: assetUrl(PDFJS_CMAP_URL),
				cMapPacked: true,
				standardFontDataUrl: assetUrl(PDFJS_STANDARD_FONT_URL),
				wasmUrl: assetUrl(PDFJS_WASM_URL),
				iccUrl: assetUrl(PDFJS_ICC_URL),
				useWorkerFetch: true,
				isOffscreenCanvasSupported: true
			});
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
		textLayerTask?.cancel();
		textLayerTask = null;
		selectionText = '';
		regionDraft = null;
		regionPending = null;
		regionDragging = false;
		loading = true;
		pageError = '';
		try {
			ensurePdfJsMapPolyfills();
			const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
			const page = await pdfDocument.getPage(pageNumber);
			if (revision !== renderRevision) return;
			const natural = page.getViewport({ scale: 1 });
			const available = Math.max(320, Math.min(stageWidth - 56, 920));
			const fitScale = Math.min(1.35, available / Math.max(1, natural.width));
			const outputScale = Math.min(window.devicePixelRatio || 1, 2);
			const cssScale = safeCssScale(natural.width, natural.height, fitScale * zoom, outputScale);
			const viewport = page.getViewport({ scale: cssScale });
			const canvas = canvasEl;
			const context = canvas.getContext('2d', { alpha: false });
			if (!context) throw new Error('Canvas unavailable');

			pageWidth = viewport.width;
			pageHeight = viewport.height;
			const pixelW = Math.max(1, Math.floor(viewport.width * outputScale));
			const pixelH = Math.max(1, Math.floor(viewport.height * outputScale));
			if (
				pixelW * pixelH > MAX_CANVAS_PIXELS ||
				pixelW > MAX_CANVAS_EDGE ||
				pixelH > MAX_CANVAS_EDGE
			) {
				throw new Error(`Page is too large to draw (${pixelW}×${pixelH}px)`);
			}
			canvas.width = pixelW;
			canvas.height = pixelH;
			canvas.style.width = `${viewport.width}px`;
			canvas.style.height = `${viewport.height}px`;
			context.setTransform(1, 0, 0, 1, 0, 0);
			context.clearRect(0, 0, pixelW, pixelH);
			renderTask = page.render({
				canvas,
				canvasContext: context,
				viewport,
				transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0]
			});
			await renderTask.promise;
			if (revision !== renderRevision) return;

			// Text layer is best-effort — never fail the page paint if selection overlay breaks.
			try {
				// PDF.js owns the contents of its text-layer container.
				// eslint-disable-next-line svelte/no-dom-manipulating
				textLayerEl.replaceChildren();
				const textContent = await page.getTextContent();
				if (revision !== renderRevision) return;
				const textLayer = new pdfjs.TextLayer({
					textContentSource: textContent,
					container: textLayerEl,
					viewport
				});
				textLayerTask = textLayer;
				await textLayer.render();
				textLayerTask = null;
			} catch (textCause) {
				if (!isCancelError(textCause)) console.warn('PDF text layer skipped', textCause);
				textLayerTask = null;
			}

			try {
				page.cleanup();
			} catch {
				/* ignore */
			}
			if (revision === renderRevision) loading = false;
		} catch (cause) {
			if (isCancelError(cause)) return;
			console.error(cause);
			if (revision === renderRevision) {
				pageError = `This page couldn’t be rendered. ${errorDetail(cause)}`;
				loading = false;
			}
		}
	}

	function retryPage() {
		pageError = '';
		renderReadyTick++;
	}

	function changePage(delta: number) {
		if (!pageCount) return;
		goToPage(pageNumber + delta);
	}

	function goToPage(raw: number | string) {
		if (!pageCount) return;
		const parsed = typeof raw === 'number' ? raw : Number.parseInt(String(raw).trim(), 10);
		if (!Number.isFinite(parsed)) return;
		const next = Math.min(pageCount, Math.max(1, Math.trunc(parsed)));
		if (next === pageNumber) return;
		pageError = '';
		pageNumber = next;
		onViewChange?.({ page: pageNumber, zoom });
	}

	function onPageInputCommit(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		goToPage(input.value);
		input.value = String(pageNumber);
	}

	function changeZoom(delta: number) {
		pageError = '';
		zoom = Math.min(1.8, Math.max(0.65, Math.round((zoom + delta) * 10) / 10));
		onViewChange?.({ page: pageNumber, zoom });
	}

	function clearRegionState() {
		regionDraft = null;
		regionPending = null;
		regionDragging = false;
	}

	function toggleRegionMode() {
		regionMode = !regionMode;
		clearRegionState();
		selectionText = '';
		window.getSelection()?.removeAllRanges();
	}

	function pageLocalPoint(event: PointerEvent): { x: number; y: number } {
		const rect = pageShellEl?.getBoundingClientRect();
		if (!rect) return { x: 0, y: 0 };
		return {
			x: Math.min(pageWidth, Math.max(0, event.clientX - rect.left)),
			y: Math.min(pageHeight, Math.max(0, event.clientY - rect.top))
		};
	}

	function onRegionPointerDown(event: PointerEvent) {
		if (!regionMode || !pageShellEl) return;
		const target = event.target as HTMLElement | null;
		if (target?.closest('.mash-pdf-save-selection')) return;
		event.preventDefault();
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		regionPending = null;
		const point = pageLocalPoint(event);
		regionOrigin = point;
		regionDraft = { x: point.x, y: point.y, w: 0, h: 0 };
		regionDragging = true;
	}

	function onRegionPointerMove(event: PointerEvent) {
		if (!regionDragging) return;
		const point = pageLocalPoint(event);
		regionDraft = normalizeRegionRect(
			regionOrigin.x,
			regionOrigin.y,
			point.x,
			point.y,
			pageWidth,
			pageHeight
		);
	}

	function onRegionPointerUp(event: PointerEvent) {
		if (!regionDragging) return;
		regionDragging = false;
		try {
			(event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
		} catch {
			/* ignore */
		}
		if (regionDraft && regionDraft.w >= MIN_REGION_PX && regionDraft.h >= MIN_REGION_PX) {
			regionPending = regionDraft;
		} else {
			regionPending = null;
		}
		regionDraft = null;
	}

	function captureSelection() {
		if (regionMode) {
			selectionText = '';
			return;
		}
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

	async function saveRegion() {
		if (!regionPending || !canvasEl || savingExcerpt) return;
		const imageDataUrl = cropPdfCanvasRegion(canvasEl, regionPending, pageWidth, pageHeight);
		if (!imageDataUrl) return;
		savingExcerpt = true;
		try {
			await onClip({ imageDataUrl, page: pageNumber });
			clearRegionState();
			regionMode = false;
		} finally {
			savingExcerpt = false;
		}
	}

	function onRegionKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && regionMode) {
			event.preventDefault();
			regionMode = false;
			clearRegionState();
		}
	}

	$effect(() => {
		if (!regionMode) return;
		const onKey = (event: KeyboardEvent) => onRegionKeydown(event);
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});

	// Attach resize observer once the stage element is available (may mount after shell).
	$effect(() => {
		if (!stageEl || !resizeObserver) return;
		resizeObserver.observe(stageEl);
		const width = Math.round(stageEl.clientWidth);
		if (width > 0 && width !== stageWidth) stageWidth = width;
	});
</script>

<DocumentReaderShell
	{open}
	fileName={file.name}
	ariaLabel="PDF reader"
	closeAriaLabel="Close PDF reader"
	clippingsLabel="PDF clippings"
	clippingsCountLabel={`${clippings.length} saved from this PDF`}
	emptyClippingsHint="Select text, or use Clip region for scans and diagrams."
	emptyClippingsSubhint="Each clipping keeps its page reference."
	clippings={shellClippings}
	{onClose}
	onOpenClippings={() => void onOpenClippings(clippings.map((clipping) => clipping.noteId))}
>
	{#snippet children()}
		<div class="mash-pdf-page-controls" aria-label="PDF page controls">
			<button
				type="button"
				onclick={() => changePage(-1)}
				disabled={pageNumber <= 1}
				aria-label="Previous page"
			>
				<ChevronLeft size={17} />
			</button>
			<label class="mash-pdf-page-jump">
				<span class="sr-only">Go to page</span>
				<input
					type="number"
					inputmode="numeric"
					min="1"
					max={pageCount || 1}
					value={pageNumber}
					disabled={!pageCount}
					aria-label="Page number"
					title="Jump to page"
					onkeydown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							onPageInputCommit(e);
							(e.currentTarget as HTMLInputElement).blur();
						}
					}}
					onchange={onPageInputCommit}
					onblur={onPageInputCommit}
				/>
				<span aria-hidden="true">/</span>
				<span>{pageCount || '—'}</span>
			</label>
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
		<button
			type="button"
			class="mash-pdf-region-tool"
			class:is-active={regionMode}
			onclick={toggleRegionMode}
			aria-pressed={regionMode}
			aria-label={regionMode ? 'Exit clip region' : 'Clip region'}
			title={regionMode ? 'Exit clip region (Esc)' : 'Clip a region from the page'}
		>
			<Crop size={16} />
		</button>
	{/snippet}

	{#snippet stage()}
		<section
			bind:this={stageEl}
			class="mash-pdf-stage"
			class:is-region-mode={regionMode}
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
					class:is-region-mode={regionMode}
					style="width: {pageWidth || 640}px; height: {pageHeight || 820}px;"
					role="region"
					aria-label="PDF page {pageNumber} clipping surface"
					onpointerdown={onRegionPointerDown}
					onpointermove={onRegionPointerMove}
					onpointerup={onRegionPointerUp}
					onpointercancel={onRegionPointerUp}
				>
					<canvas bind:this={canvasEl} aria-label="PDF page {pageNumber}"></canvas>
					<div
						bind:this={textLayerEl}
						class="textLayer"
						class:is-region-blocked={regionMode}
						aria-label="Selectable PDF text"
					></div>
					{#if regionDraft || regionPending}
						{@const rect = regionPending ?? regionDraft}
						{#if rect}
							<div
								class="mash-pdf-region-rect"
								class:is-pending={!!regionPending}
								style="left: {rect.x}px; top: {rect.y}px; width: {rect.w}px; height: {rect.h}px;"
							></div>
						{/if}
					{/if}
					{#if regionPending}
						<button
							type="button"
							class="mash-pdf-save-selection"
							style="left: {regionSavePoint.left}px; top: {regionSavePoint.top}px;"
							onclick={() => void saveRegion()}
							disabled={savingExcerpt}
						>
							{savingExcerpt ? 'Saving…' : 'Save clipping'}
						</button>
					{:else if selectionText && !regionMode}
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
					{#if pageError}
						<div class="mash-pdf-page-error" role="alert">
							<p>{pageError}</p>
							<div class="mash-pdf-page-error-actions">
								<button type="button" onclick={retryPage}>Try again</button>
								<button type="button" class="is-quiet" onclick={onClose}>Back to canvas</button>
							</div>
						</div>
					{:else if loading}
						<div class="mash-pdf-page-loading">Rendering page…</div>
					{/if}
				</div>
			{/if}
		</section>
	{/snippet}
</DocumentReaderShell>

<style>
	.mash-pdf-page-controls,
	.mash-pdf-zoom {
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--mash-ink-muted);
		font-size: var(--mash-type-caption);
	}
	.mash-pdf-page-jump {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-variant-numeric: tabular-nums;
	}
	.mash-pdf-page-jump input {
		width: 3.1rem;
		height: 28px;
		padding: 0 5px;
		border: 1px solid var(--mash-tray-edge);
		border-radius: 8px;
		background: color-mix(in srgb, var(--mash-panel) 72%, transparent);
		color: var(--mash-ink);
		font: inherit;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		text-align: center;
		appearance: textfield;
		-moz-appearance: textfield;
		transition:
			border-color 120ms ease,
			box-shadow 120ms ease;
	}
	.mash-pdf-page-jump input::-webkit-outer-spin-button,
	.mash-pdf-page-jump input::-webkit-inner-spin-button {
		appearance: none;
		margin: 0;
	}
	.mash-pdf-page-jump input:focus-visible {
		outline: none;
		border-color: var(--mash-accent-select);
		box-shadow:
			0 0 0 2px var(--mash-panel),
			0 0 0 4px var(--mash-accent-ring);
	}
	.mash-pdf-page-jump input:disabled {
		opacity: 0.55;
	}
	.mash-pdf-zoom {
		gap: 1px;
		padding: 2px;
		border: 1px solid var(--mash-tray-edge);
		border-radius: 9px;
		background: color-mix(in srgb, var(--mash-hover-fill-soft) 80%, transparent);
	}
	.mash-pdf-zoom span {
		min-width: 42px;
		text-align: center;
		font-variant-numeric: tabular-nums;
		font-weight: 600;
		font-size: var(--mash-type-caption);
	}
	.mash-pdf-region-tool.is-active {
		background: var(--mash-accent-wash);
		color: var(--mash-accent-bright);
	}
	.mash-pdf-stage {
		position: relative;
		min-height: 0;
		flex: 1;
		overflow: auto;
		padding: 26px 24px 32px;
		background: color-mix(in srgb, var(--mash-board) 84%, var(--mash-panel));
		outline: none;
		scrollbar-width: thin;
	}
	.mash-pdf-stage.is-region-mode {
		cursor: crosshair;
	}
	.mash-pdf-page {
		position: relative;
		margin: 0 auto;
		background: white;
		box-shadow: 0 18px 48px rgb(0 0 0 / 0.28);
	}
	.mash-pdf-page.is-region-mode {
		cursor: crosshair;
		touch-action: none;
	}
	.mash-pdf-page canvas {
		display: block;
	}
	.mash-pdf-page :global(.textLayer.is-region-blocked) {
		pointer-events: none;
		user-select: none;
	}
	.mash-pdf-region-rect {
		position: absolute;
		z-index: 3;
		border: 1.5px solid var(--mash-accent);
		background: color-mix(in srgb, var(--mash-accent) 18%, transparent);
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--mash-accent-ink) 20%, transparent);
		pointer-events: none;
	}
	.mash-pdf-region-rect.is-pending {
		background: color-mix(in srgb, var(--mash-accent) 12%, transparent);
	}
	.mash-pdf-page :global(.textLayer) {
		position: absolute;
		inset: 0;
		overflow: clip;
		line-height: 1;
		letter-spacing: normal;
		word-spacing: normal;
		text-align: initial;
		text-size-adjust: none;
		forced-color-adjust: none;
		transform-origin: 0 0;
		caret-color: CanvasText;
		user-select: text;
		--min-font-size: 1;
		--text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size));
		--min-font-size-inv: calc(1 / var(--min-font-size));
	}
	.mash-pdf-page :global(.textLayer :is(span, br)) {
		position: absolute;
		color: transparent;
		white-space: pre;
		cursor: text;
		transform-origin: 0% 0%;
		user-select: text;
	}
	.mash-pdf-page :global(.textLayer > :not(.markedContent)),
	.mash-pdf-page :global(.textLayer .markedContent span:not(.markedContent)) {
		z-index: 1;
		font-size: calc(var(--text-scale-factor) * var(--font-height, 0));
		transform: rotate(var(--rotate, 0deg)) scaleX(var(--scale-x, 1)) scale(var(--min-font-size-inv));
	}
	.mash-pdf-page :global(.textLayer .markedContent) {
		display: contents;
	}
	.mash-pdf-page :global(.textLayer .endOfContent) {
		position: absolute;
		inset: 100% 0 0;
		display: block;
		cursor: default;
		user-select: none;
	}
	.mash-pdf-page :global(.textLayer.selecting .endOfContent) {
		top: 0;
	}
	.mash-pdf-page :global(.textLayer ::selection) {
		background: color-mix(in srgb, var(--mash-accent) 42%, transparent);
	}
	.mash-pdf-save-selection {
		position: absolute;
		z-index: 5;
		min-width: 124px;
		padding: 8px 14px;
		border-radius: 999px;
		background: var(--mash-accent);
		color: var(--mash-accent-ink);
		font-size: var(--mash-type-caption);
		font-weight: 650;
		box-shadow: 0 8px 24px rgb(0 0 0 / 0.28);
		transition:
			background 120ms ease,
			transform 100ms ease;
	}
	.mash-pdf-save-selection:hover:not(:disabled) {
		background: var(--mash-accent-bright);
	}
	.mash-pdf-save-selection:focus-visible {
		outline: none;
		box-shadow:
			0 0 0 2px var(--mash-panel),
			0 0 0 4px var(--mash-accent-ring);
	}
	.mash-pdf-page-loading {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		background: rgb(255 255 255 / 0.72);
		color: #5d5144;
		font-size: var(--mash-type-caption);
	}
	.mash-pdf-page-error {
		position: absolute;
		inset: 0;
		z-index: 4;
		display: grid;
		place-items: center;
		align-content: center;
		gap: 12px;
		padding: 24px;
		background: color-mix(in srgb, var(--mash-panel) 92%, transparent);
		backdrop-filter: blur(8px);
		text-align: center;
		color: var(--mash-ink-muted);
	}
	.mash-pdf-page-error p {
		max-width: 320px;
		margin: 0;
		font-size: var(--mash-type-control);
	}
	.mash-pdf-page-error-actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 8px;
	}
	.mash-pdf-page-error-actions button {
		padding: 8px 14px;
		border-radius: 9px;
		background: var(--mash-accent);
		color: var(--mash-accent-ink);
		font-size: var(--mash-type-caption);
		font-weight: 650;
	}
	.mash-pdf-page-error-actions button.is-quiet {
		background: transparent;
		border: 1px solid var(--mash-tray-edge);
		color: var(--mash-ink-muted);
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
		font-size: var(--mash-type-caption);
		font-weight: 650;
	}

	@media (max-width: 840px) {
		.mash-pdf-page-controls {
			display: none;
		}
		.mash-pdf-stage {
			padding: 16px;
		}
	}
</style>
