<script lang="ts">
	import { FileDown, FileText, X } from '@lucide/svelte';
	import { untrack } from 'svelte';
	import './export-sheet.css';
	import { focusTrap } from '$lib/focus-trap';
	import ExportDocumentPreview from '$lib/components/ExportDocumentPreview.svelte';
	import {
		buildExportDocument,
		type PresentationExportOptions,
		type PresentationExportRequest,
		type PresentationFormat
	} from '$lib/export-document';
	import {
		EXPORT_PAGE_SIZES,
		EXPORT_TEMPLATES,
		loadPresentationExportOptions,
		savePresentationExportOptions
	} from '$lib/export-templates';

	interface Props {
		request: PresentationExportRequest;
		onClose: () => void;
	}

	let { request, onClose }: Props = $props();
	let options = $state<PresentationExportOptions>(
		untrack(() =>
			loadPresentationExportOptions(request.format, request.title, request.notes.length)
		)
	);
	let exporting = $state(false);
	let status = $state<{ ok: boolean; message: string } | null>(null);
	let controlsHaveMore = $state(false);
	let document = $derived(
		buildExportDocument(request.notes, {
			title: options.documentTitle,
			sourceLabel: request.sourceLabel
		})
	);

	function chooseFormat(format: PresentationFormat) {
		if (options.format === format) return;
		options = loadPresentationExportOptions(format, options.documentTitle, request.notes.length);
		status = null;
	}

	async function runExport() {
		if (exporting || document.sections.length === 0) return;
		exporting = true;
		status = null;
		try {
			const { exportPresentationDocument } = await import('$lib/presentation-export');
			const result = await exportPresentationDocument(document, options);
			savePresentationExportOptions(options);
			status = { ok: true, message: `${result.filename} downloaded.` };
		} catch (error) {
			console.error('Presentation export failed', error);
			status = { ok: false, message: 'Export did not finish. Your choices are still here.' };
		} finally {
			exporting = false;
		}
	}

	function handleBackdrop(event: MouseEvent) {
		if (event.target === event.currentTarget && !exporting) onClose();
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && !exporting) {
			event.preventDefault();
			onClose();
		}
	}

	function trackControlsOverflow(node: HTMLElement) {
		const update = () => {
			controlsHaveMore = node.scrollTop + node.clientHeight < node.scrollHeight - 4;
		};
		const observer = new ResizeObserver(update);
		observer.observe(node);
		node.addEventListener('scroll', update, { passive: true });
		requestAnimationFrame(update);
		return {
			destroy() {
				observer.disconnect();
				node.removeEventListener('scroll', update);
			}
		};
	}
</script>

<div
	class="mash-dialog-backdrop mash-export-backdrop"
	role="presentation"
	onclick={handleBackdrop}
	onkeydown={handleKeydown}
>
	<div
		use:focusTrap={{ initialFocus: '[data-dialog-initial-focus]' }}
		class="mash-dialog-panel mash-export-sheet"
		role="dialog"
		aria-modal="true"
		aria-labelledby="mash-export-title"
		data-testid="export-sheet"
	>
		<header class="mash-export-sheet-header">
			<div>
				<p class="mash-export-sheet-eyebrow">{request.sourceLabel}</p>
				<h2 id="mash-export-title">Export a polished document</h2>
				<p>
					{document.sections.length} note{document.sections.length === 1 ? '' : 's'} · rendered locally
				</p>
			</div>
			<button
				type="button"
				class="mash-peel-icon-btn"
				aria-label="Close export sheet"
				onclick={onClose}
				disabled={exporting}
			>
				<X size={18} />
			</button>
		</header>

		<div class="mash-export-sheet-body">
			<div class="mash-export-controls-shell">
				<div class="mash-export-controls" data-testid="export-controls" use:trackControlsOverflow>
					<fieldset>
						<legend>Format</legend>
						<div class="mash-export-format-switch">
							<button
								type="button"
								class:is-selected={options.format === 'pdf'}
								aria-pressed={options.format === 'pdf'}
								onclick={() => chooseFormat('pdf')}
							>
								<FileDown size={17} />
								<span><strong>PDF</strong><small>Ready to send</small></span>
							</button>
							<button
								type="button"
								class:is-selected={options.format === 'docx'}
								aria-pressed={options.format === 'docx'}
								onclick={() => chooseFormat('docx')}
							>
								<FileText size={17} />
								<span><strong>Word</strong><small>Easy to edit</small></span>
							</button>
						</div>
					</fieldset>

					<fieldset>
						<legend>Template</legend>
						<div class="mash-export-template-list">
							{#each EXPORT_TEMPLATES as template (template.id)}
								<label class:is-selected={options.templateId === template.id}>
									<input
										class="sr-only"
										type="radio"
										name="export-template"
										value={template.id}
										bind:group={options.templateId}
									/>
									<span class="mash-export-template-swatch" style:background={template.colors.wash}>
										<i style:background={template.colors.accent}></i>
									</span>
									<span>
										<strong>{template.name}</strong>
										<small>{template.summary}</small>
									</span>
								</label>
							{/each}
						</div>
					</fieldset>

					<fieldset>
						<legend>Document</legend>
						<label class="mash-export-title-field">
							<span>Title</span>
							<input data-dialog-initial-focus type="text" bind:value={options.documentTitle} />
						</label>
						<div class="mash-export-option-row">
							<label>
								<span>Page size</span>
								<select bind:value={options.pageSize}>
									{#each Object.entries(EXPORT_PAGE_SIZES) as [value, pageSize] (value)}
										<option {value}>{pageSize.label}</option>
									{/each}
								</select>
							</label>
						</div>
						<div class="mash-export-checks">
							<label><input type="checkbox" bind:checked={options.includeCover} /> Cover page</label
							>
							<label
								><input type="checkbox" bind:checked={options.includeMetadata} /> Folders, tags, and source</label
							>
							<label
								><input type="checkbox" bind:checked={options.includePageNumbers} /> Page numbers</label
							>
						</div>
					</fieldset>
				</div>
				{#if controlsHaveMore}
					<div class="mash-export-scroll-cue" data-testid="export-scroll-cue" aria-hidden="true">
						<span>More document options below</span>
						<span class="mash-export-scroll-arrow">↓</span>
					</div>
				{/if}
			</div>

			<div class="mash-export-preview-shell">
				<div class="mash-export-preview-label">
					<strong>Preview</strong>
					<span>First {Math.min(3, document.sections.length)} notes</span>
				</div>
				<ExportDocumentPreview {document} {options} />
			</div>
		</div>

		<footer class="mash-export-sheet-footer">
			<div aria-live="polite">
				{#if status}
					<p class:is-error={!status.ok}>{status.message}</p>
				{:else}
					<p>
						{options.format === 'pdf' ? 'Polished final copy' : 'Structured for editing in Word'}
					</p>
				{/if}
			</div>
			<button type="button" class="mash-btn-ghost" onclick={onClose} disabled={exporting}
				>Cancel</button
			>
			<button type="button" class="mash-btn" onclick={() => void runExport()} disabled={exporting}>
				{exporting
					? 'Building…'
					: options.format === 'pdf'
						? 'Download PDF'
						: 'Download Word document'}
			</button>
		</footer>
	</div>
</div>
