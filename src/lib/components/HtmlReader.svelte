<script lang="ts">
	import { onDestroy } from 'svelte';
	import { FileText } from 'lucide-svelte';
	import type { HtmlClipPayload, HtmlClipping } from '$lib/html-clipping';
	import { normalizeHtmlExcerpt } from '$lib/html-clipping';
	import { convertHtmlFile } from '$lib/html-import';
	import DocumentReaderShell from './DocumentReaderShell.svelte';

	interface Props {
		file: File;
		clippings: HtmlClipping[];
		open?: boolean;
		onClose: () => void;
		onClip: (excerpt: HtmlClipPayload) => void | Promise<void>;
		onOpenClippings: (noteIds: string[]) => void | Promise<void>;
	}

	let { file, clippings, open = true, onClose, onClip, onOpenClippings }: Props = $props();

	let articleEl: HTMLElement | undefined = $state();
	let pageShellEl: HTMLElement | undefined = $state();
	let html = $state('');
	let loading = $state(true);
	let error = $state('');
	let selectionText = $state('');
	let selectionPoint = $state({ left: 0, top: 0 });
	let savingExcerpt = $state(false);
	let loadGeneration = 0;
	let disposed = false;

	let shellClippings = $derived(
		clippings.map((clipping) => ({
			id: clipping.id,
			text: clipping.text
		}))
	);

	onDestroy(() => {
		disposed = true;
		loadGeneration++;
	});

	$effect(() => {
		const currentFile = file;
		void loadHtml(currentFile);
	});

	async function loadHtml(currentFile: File) {
		const generation = ++loadGeneration;
		loading = true;
		error = '';
		html = '';
		selectionText = '';
		try {
			const result = await convertHtmlFile(currentFile, currentFile.name);
			if (disposed || generation !== loadGeneration) return;
			if (result.ok) {
				html = result.html;
			} else {
				error = result.error;
			}
		} catch (cause) {
			if (disposed || generation !== loadGeneration) return;
			console.error(cause);
			error = 'Couldn’t open this HTML file.';
		} finally {
			if (!disposed && generation === loadGeneration) loading = false;
		}
	}

	function captureSelection() {
		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !articleEl) {
			selectionText = '';
			return;
		}
		const range = selection.getRangeAt(0);
		if (!articleEl.contains(range.commonAncestorContainer)) {
			selectionText = '';
			return;
		}
		const text = normalizeHtmlExcerpt(selection.toString());
		if (!text) {
			selectionText = '';
			return;
		}
		selectionText = text;
		const rangeRect = range.getBoundingClientRect();
		const shellRect = pageShellEl?.getBoundingClientRect();
		if (!shellRect) return;
		const maxLeft = Math.max(12, shellRect.width - 148);
		const maxTop = Math.max(12, shellRect.height - 48);
		selectionPoint = {
			left: Math.min(maxLeft, Math.max(12, rangeRect.right - shellRect.left + 10)),
			top: Math.min(maxTop, Math.max(12, rangeRect.bottom - shellRect.top + 8))
		};
	}

	function onStagePointerUp(event: PointerEvent) {
		const target = event.target as HTMLElement | null;
		if (target?.closest('.mash-pdf-save-selection')) return;
		window.setTimeout(captureSelection, 0);
	}

	async function saveSelection() {
		if (!selectionText || savingExcerpt) return;
		savingExcerpt = true;
		try {
			await onClip({ text: selectionText });
			selectionText = '';
			window.getSelection()?.removeAllRanges();
		} finally {
			savingExcerpt = false;
		}
	}
</script>

<DocumentReaderShell
	{open}
	fileName={file.name}
	ariaLabel="HTML document reader"
	closeAriaLabel="Close HTML document reader"
	clippingsLabel="HTML clippings"
	clippingsCountLabel={`${clippings.length} saved from this document`}
	emptyClippingsHint="Select text to capture an excerpt."
	clippings={shellClippings}
	onClose={onClose}
	onOpenClippings={() => void onOpenClippings(clippings.map((clipping) => clipping.noteId))}
>
	{#snippet stage()}
		<section
			class="mash-pdf-stage mash-docx-stage"
			aria-label="HTML document viewport"
			onpointerup={onStagePointerUp}
		>
			{#if error}
				<div class="mash-docx-error" role="alert">
					<FileText size={30} />
					<p>{error}</p>
					<button type="button" onclick={onClose}>Back to canvas</button>
				</div>
			{:else if loading}
				<div class="mash-docx-loading">Opening document…</div>
			{:else}
				<div bind:this={pageShellEl} class="mash-docx-page">
					<article
						bind:this={articleEl}
						class="mash-docx-article"
						data-testid="html-reader-stage"
					>
						{@html html}
					</article>
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
				</div>
			{/if}
		</section>
	{/snippet}
</DocumentReaderShell>
