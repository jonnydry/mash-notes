<script lang="ts">
	import { FileSpreadsheet, Rows3, Table2, X } from 'lucide-svelte';
	import {
		DELIMITED_MAX_CARDS,
		delimitedTableBody,
		type DelimitedAnalysis,
		type DelimitedImportMode
	} from '$lib/delimited-import';
	import { focusTrap } from '$lib/focus-trap';

	interface Props {
		open: boolean;
		analysis: DelimitedAnalysis;
		onChoose: (mode: DelimitedImportMode, titleColumn: number) => void | Promise<void>;
		onClose: () => void;
	}

	let { open, analysis, onChoose, onClose }: Props = $props();
	let titleColumn = $state(0);
	const tableFits = $derived(Boolean(delimitedTableBody(analysis)));

	$effect(() => {
		if (!open) return;
		function onKey(event: KeyboardEvent) {
			if (event.key !== 'Escape') return;
			event.preventDefault();
			onClose();
		}
		window.addEventListener('keydown', onKey, true);
		return () => window.removeEventListener('keydown', onKey, true);
	});

	function sample() {
		return [analysis.headers, ...analysis.previewRows]
			.map((row) => row.join(analysis.delimiter === '\t' ? '  ·  ' : ', '))
			.join('\n');
	}
</script>

{#if open}
	<div
		class="mash-dialog-backdrop mash-paste-backdrop"
		role="presentation"
		onclick={(event) => {
			if (event.target === event.currentTarget) onClose();
		}}
	>
		<div
			use:focusTrap={{ initialFocus: '[data-dialog-initial-focus]' }}
			class="mash-dialog-panel mash-paste-dialog"
			role="dialog"
			aria-modal="true"
			aria-labelledby="mash-delimited-title"
			data-testid="delimited-import-dialog"
		>
			<header class="mash-paste-header">
				<div class="min-w-0 flex-1">
					<h2 id="mash-delimited-title" class="mash-display text-lg font-semibold tracking-tight">
						How should this table land?
					</h2>
					<p class="mash-dialog-subtitle">
						{analysis.rows.length} rows · {analysis.headers.length} columns · {analysis.format.toUpperCase()}
					</p>
				</div>
				<button
					data-dialog-initial-focus
					type="button"
					class="mash-peel-icon-btn"
					onclick={onClose}
					aria-label="Cancel table import"
				>
					<X class="h-4 w-4" />
				</button>
			</header>

			<div class="mash-paste-body">
				<div class="mash-dialog-subtitle flex items-center gap-2">
					<FileSpreadsheet class="h-4 w-4" aria-hidden="true" />
					<span class="truncate">{analysis.fileName}</span>
				</div>
				<pre class="mash-paste-preview">{sample()}</pre>

				<label class="mash-dialog-subtitle flex items-center justify-between gap-3">
					<span>Card title column</span>
					<select bind:value={titleColumn} class="mash-input rounded-md px-2 py-1">
						{#each analysis.headers as header, index (header)}
							<option value={index}>{header}</option>
						{/each}
					</select>
				</label>

				<div class="mash-paste-choices">
					<button
						type="button"
						class="mash-btn-ghost mash-paste-choice"
						class:is-suggested={analysis.suggestedMode === 'rows'}
						disabled={analysis.rows.length > DELIMITED_MAX_CARDS}
						onclick={() => onChoose('rows', titleColumn)}
					>
						<Rows3 class="h-5 w-5 text-[var(--mash-accent-bright)]" />
						<strong>One card per row</strong>
						<small>
							{analysis.rows.length <= DELIMITED_MAX_CARDS
								? `${analysis.rows.length} ready-to-move cards`
								: `Limited to ${DELIMITED_MAX_CARDS} rows`}
						</small>
						{#if analysis.suggestedMode === 'rows'}
							<span class="mash-paste-suggested">Suggested</span>
						{/if}
					</button>

					<button
						type="button"
						class="mash-btn-ghost mash-paste-choice"
						class:is-suggested={analysis.suggestedMode === 'table'}
						disabled={!tableFits}
						onclick={() => onChoose('table', titleColumn)}
					>
						<Table2 class="h-5 w-5 text-[var(--mash-accent-bright)]" />
						<strong>One Markdown table card</strong>
						<small>{tableFits ? 'Keep the rows together' : 'Too large for one card'}</small>
						{#if analysis.suggestedMode === 'table'}
							<span class="mash-paste-suggested">Suggested</span>
						{/if}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}
