<script lang="ts">
	import { onDestroy } from 'svelte';
	import { FileText } from 'lucide-svelte';
	import type { DocxClipPayload, DocxClipping } from '$lib/docx-clipping';
	import { normalizeDocxExcerpt } from '$lib/docx-clipping';
	import { convertDocxToHtml } from '$lib/docx-import';
	import DocumentReaderShell from './DocumentReaderShell.svelte';

	interface Props {
		file: File;
		clippings: DocxClipping[];
		open?: boolean;
		onClose: () => void;
		onClip: (excerpt: DocxClipPayload) => void | Promise<void>;
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
		void loadDocx(currentFile);
	});

	async function loadDocx(currentFile: File) {
		const generation = ++loadGeneration;
		loading = true;
		error = '';
		html = '';
		selectionText = '';
		try {
			const buffer = await currentFile.arrayBuffer();
			if (disposed || generation !== loadGeneration) return;
			const result = await convertDocxToHtml(buffer, currentFile.name);
			if (disposed || generation !== loadGeneration) return;
			if (result.ok) {
				html = result.html;
			} else {
				error = result.error;
			}
		} catch (cause) {
			if (disposed || generation !== loadGeneration) return;
			console.error(cause);
			error = 'Couldn’t open this Word document.';
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
		const text = normalizeDocxExcerpt(selection.toString());
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
	ariaLabel="Word document reader"
	closeAriaLabel="Close Word document reader"
	clippingsLabel="Word clippings"
	clippingsCountLabel={`${clippings.length} saved from this document`}
	emptyClippingsHint="Select text to capture an excerpt."
	clippings={shellClippings}
	onClose={onClose}
	onOpenClippings={() => void onOpenClippings(clippings.map((clipping) => clipping.noteId))}
>
	{#snippet stage()}
		<section
			class="mash-pdf-stage mash-docx-stage"
			aria-label="Word document viewport"
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
					<!-- Local user-chosen file: trust model for mammoth HTML (no remote content). -->
					<article
						bind:this={articleEl}
						class="mash-docx-article"
						data-testid="docx-reader-stage"
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

<style>
	/* Keep reading in DocumentReaderShell targets .mash-pdf-stage. */
	.mash-docx-stage {
		position: relative;
		min-height: 0;
		flex: 1;
		overflow: auto;
		padding: 28px;
		background: color-mix(in srgb, var(--mash-board) 82%, var(--mash-panel));
		outline: none;
	}
	.mash-docx-page {
		position: relative;
		margin: 0 auto;
		max-width: 48rem;
	}
	.mash-docx-article {
		max-width: 42rem;
		margin: 0 auto;
		padding: 32px 36px 48px;
		border-radius: 4px;
		background: color-mix(in srgb, var(--mash-panel) 94%, white);
		box-shadow: 0 18px 48px rgb(0 0 0 / 0.18);
		color: var(--mash-ink);
		font-size: 15px;
		line-height: 1.65;
		user-select: text;
	}
	.mash-docx-article :global(p) {
		margin: 0 0 0.9em;
	}
	.mash-docx-article :global(:is(h1, h2, h3, h4, h5, h6)) {
		margin: 1.35em 0 0.55em;
		color: var(--mash-ink);
		font-family: var(--mash-font-display, Georgia, serif);
		font-weight: 650;
		line-height: 1.25;
	}
	.mash-docx-article :global(h1) {
		font-size: 1.55em;
	}
	.mash-docx-article :global(h2) {
		font-size: 1.3em;
	}
	.mash-docx-article :global(h3) {
		font-size: 1.15em;
	}
	.mash-docx-article :global(:is(h4, h5, h6)) {
		font-size: 1.05em;
		color: var(--mash-ink-muted);
	}
	.mash-docx-article :global(:is(ul, ol)) {
		margin: 0 0 0.9em;
		padding-left: 1.4em;
	}
	.mash-docx-article :global(li) {
		margin: 0.25em 0;
	}
	.mash-docx-article :global(strong) {
		font-weight: 700;
	}
	.mash-docx-article :global(em) {
		font-style: italic;
	}
	.mash-docx-article :global(a) {
		color: var(--mash-accent-bright);
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.mash-docx-article :global(::selection) {
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
	.mash-docx-loading {
		display: grid;
		min-height: 70%;
		place-items: center;
		color: var(--mash-ink-muted);
		font-size: 13px;
	}
	.mash-docx-error {
		display: grid;
		min-height: 70%;
		place-items: center;
		align-content: center;
		gap: 12px;
		text-align: center;
		color: var(--mash-ink-muted);
	}
	.mash-docx-error p {
		max-width: 360px;
		margin: 0;
	}
	.mash-docx-error button {
		padding: 8px 14px;
		border-radius: 9px;
		background: var(--mash-accent);
		color: var(--mash-accent-ink);
		font-size: 12px;
		font-weight: 650;
	}

	@media (max-width: 840px) {
		.mash-docx-stage {
			padding: 16px;
		}
		.mash-docx-article {
			padding: 22px 18px 32px;
			font-size: 14px;
		}
	}
</style>
