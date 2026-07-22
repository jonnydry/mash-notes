<script lang="ts">
	import MarkdownPreview from '$lib/components/MarkdownPreview.svelte';
	import type { ExportDocument, PresentationExportOptions } from '$lib/export-document';
	import { exportDocumentWordCount } from '$lib/export-document';
	import { exportTemplate } from '$lib/export-templates';

	interface Props {
		document: ExportDocument;
		options: PresentationExportOptions;
	}

	let { document, options }: Props = $props();
	let template = $derived(exportTemplate(options.templateId));
	let sections = $derived(document.sections.slice(0, 3));
</script>

<div
	class="mash-export-preview {template.previewClass}"
	style:--export-paper={template.colors.paper}
	style:--export-ink={template.colors.ink}
	style:--export-muted={template.colors.muted}
	style:--export-accent={template.colors.accent}
	style:--export-wash={template.colors.wash}
	style:--export-border={template.colors.border}
	data-testid="export-preview"
>
	{#if options.includeCover}
		<section class="mash-export-preview-page is-cover" aria-label="Cover preview">
			<span class="mash-export-preview-kicker">{document.sourceLabel || 'Mash export'}</span>
			<h3>{options.documentTitle}</h3>
			<p>{document.sections.length} notes · {exportDocumentWordCount(document)} words</p>
			<div class="mash-export-preview-cover-mark" aria-hidden="true">M</div>
		</section>
	{/if}

	{#each sections as section (section.position)}
		<section
			class="mash-export-preview-page is-note"
			class:is-card={options.templateId === 'sticky-deck'}
			aria-label={`Page ${section.position} preview`}
		>
			<div class="mash-export-preview-note-number">{String(section.position).padStart(2, '0')}</div>
			<h3 style:text-align={section.align}>{section.title}</h3>
			{#if options.includeMetadata && (section.folder || section.tags.length || section.sourceLabel)}
				<p class="mash-export-preview-meta">
					{[section.folder, section.tags.map((tag) => `#${tag}`).join(' '), section.sourceLabel]
						.filter(Boolean)
						.join(' · ')}
				</p>
			{/if}
			<div class="mash-export-preview-body" style:text-align={section.align}>
				<MarkdownPreview nodes={section.blocks} />
			</div>
			{#if options.includePageNumbers}
				<span class="mash-export-preview-page-number">{section.position}</span>
			{/if}
		</section>
	{/each}

	{#if document.sections.length > sections.length}
		<p class="mash-export-preview-more">
			+ {document.sections.length - sections.length} more notes
		</p>
	{/if}
</div>
