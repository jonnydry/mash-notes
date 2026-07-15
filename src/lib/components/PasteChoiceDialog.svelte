<script lang="ts">
	import { ClipboardPaste, Pilcrow, Rows3, X } from '@lucide/svelte';
	import type { PasteAnalysis, PasteSplitMode } from '$lib/paste-cards';
	import { focusTrap } from '$lib/focus-trap';

	interface Props {
		open: boolean;
		analysis: PasteAnalysis | null;
		onChoose: (mode: PasteSplitMode) => void | Promise<void>;
		onClose: () => void;
	}

	let { open, analysis, onChoose, onClose }: Props = $props();
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

	function previewText() {
		if (!analysis) return '';
		return analysis.text.length > 360 ? `${analysis.text.slice(0, 360)}…` : analysis.text;
	}
</script>

{#if open && analysis}
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
			aria-labelledby="mash-paste-choice-title"
		>
			<header class="mash-paste-header">
				<div class="min-w-0 flex-1">
					<h2
						id="mash-paste-choice-title"
						class="mash-display text-lg font-semibold tracking-tight"
					>
						How should this land?
					</h2>
					<p class="mash-dialog-subtitle">
						Turn the clipboard into one note or a ready-to-move set.
					</p>
				</div>
				<button
					data-dialog-initial-focus
					type="button"
					class="mash-peel-icon-btn"
					onclick={onClose}
					aria-label="Cancel pasted text"
				>
					<X class="h-4 w-4" />
				</button>
			</header>

			<div class="mash-paste-body">
				<pre class="mash-paste-preview">{previewText()}</pre>

				<div class="mash-paste-choices">
					<button
						type="button"
						class="mash-btn-ghost mash-paste-choice"
						class:is-suggested={analysis.suggestedMode === 'single'}
						onclick={() => onChoose('single')}
					>
						<ClipboardPaste class="h-5 w-5 text-[var(--mash-accent-bright)]" />
						<strong>One card</strong>
						<small>Keep the clipboard together</small>
						{#if analysis.suggestedMode === 'single'}
							<span class="mash-paste-suggested">Suggested</span>
						{/if}
					</button>

					<button
						type="button"
						class="mash-btn-ghost mash-paste-choice"
						class:is-suggested={analysis.suggestedMode === 'lines'}
						disabled={analysis.lines.length < 2}
						onclick={() => onChoose('lines')}
					>
						<Rows3 class="h-5 w-5 text-[var(--mash-accent-bright)]" />
						<strong>{analysis.lines.length} line cards</strong>
						<small>Great for lists and options</small>
						{#if analysis.suggestedMode === 'lines'}
							<span class="mash-paste-suggested">Suggested</span>
						{/if}
					</button>

					<button
						type="button"
						class="mash-btn-ghost mash-paste-choice"
						class:is-suggested={analysis.suggestedMode === 'paragraphs'}
						disabled={analysis.paragraphs.length < 2}
						onclick={() => onChoose('paragraphs')}
					>
						<Pilcrow class="h-5 w-5 text-[var(--mash-accent-bright)]" />
						<strong>{analysis.paragraphs.length} paragraph cards</strong>
						<small>Keep related context together</small>
						{#if analysis.suggestedMode === 'paragraphs'}
							<span class="mash-paste-suggested">Suggested</span>
						{/if}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}
