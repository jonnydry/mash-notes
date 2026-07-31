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
	let swissCoverSection = $derived(
		options.includeCover && options.templateId === 'swiss' ? document.sections[0] : undefined
	);
	let sections = $derived(
		document.sections.slice(swissCoverSection ? 1 : 0, swissCoverSection ? 3 : 3)
	);
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
			<header class="mash-export-preview-running-head">
				<span>{document.sourceLabel || 'Mash export'}</span>
				<strong>Mash</strong>
			</header>
			<div class="mash-export-preview-cover-copy">
				<span class="mash-export-preview-kicker">{template.name} edition</span>
				<h3>{options.documentTitle}</h3>
				<p>{document.sections.length} notes · {exportDocumentWordCount(document)} words</p>
			</div>
			{#if swissCoverSection}
				<div class="mash-export-preview-swiss-cover-note">
					<div class="mash-export-preview-note-number">01</div>
					<div class="mash-export-preview-note-copy">
						<h4>{swissCoverSection.title}</h4>
						{#if options.includeMetadata && (swissCoverSection.folder || swissCoverSection.tags.length)}
							<p class="mash-export-preview-meta">
								{[
									swissCoverSection.folder,
									swissCoverSection.tags.map((tag) => `#${tag}`).join(' ')
								]
									.filter(Boolean)
									.join(' · ')}
							</p>
						{/if}
						<div class="mash-export-preview-body">
							<MarkdownPreview nodes={swissCoverSection.blocks} />
						</div>
					</div>
				</div>
			{/if}
			<div class="mash-export-preview-cover-mark" aria-hidden="true">M</div>
		</section>
	{/if}

	{#each sections as section (section.position)}
		<section
			class="mash-export-preview-page is-note"
			class:is-card={options.templateId === 'cards'}
			aria-label={`Page ${section.position} preview`}
		>
			<header class="mash-export-preview-running-head">
				<span>{document.sourceLabel || 'Mash export'}</span>
				<strong>Mash</strong>
			</header>
			<div class="mash-export-preview-note-layout">
				<div class="mash-export-preview-note-number">
					{String(section.position).padStart(2, '0')}
				</div>
				<div class="mash-export-preview-note-copy">
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
				</div>
			</div>
			{#if options.includePageNumbers}
				<span class="mash-export-preview-page-number">{section.position}</span>
			{/if}
		</section>
	{/each}

	{#if document.sections.length > sections.length + (swissCoverSection ? 1 : 0)}
		<p class="mash-export-preview-more">
			+ {document.sections.length - sections.length - (swissCoverSection ? 1 : 0)} more notes
		</p>
	{/if}
</div>
