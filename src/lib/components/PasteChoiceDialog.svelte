<script lang="ts">
	import { ClipboardPaste, Pilcrow, Rows3, X } from 'lucide-svelte';
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
		class="fixed inset-0 z-[60] flex items-center justify-center bg-[var(--mash-backdrop)] p-4 backdrop-blur-md"
		role="presentation"
		onclick={(event) => {
			if (event.target === event.currentTarget) onClose();
		}}
	>
		<div
			use:focusTrap={{ initialFocus: '[data-dialog-initial-focus]' }}
			class="w-full max-w-xl overflow-hidden rounded-2xl border shadow-2xl"
			style="border-color: var(--mash-panel-border); background: var(--mash-panel-strong); color: var(--mash-ink);"
			role="dialog"
			aria-modal="true"
			aria-labelledby="mash-paste-choice-title"
		>
			<header
				class="flex items-center gap-3 border-b px-5 py-4"
				style="border-color: var(--mash-divider);"
			>
				<div class="min-w-0 flex-1">
					<h2 id="mash-paste-choice-title" class="mash-display text-lg font-semibold">
						How should this land?
					</h2>
					<p class="mt-0.5 text-xs" style="color: var(--mash-ink-muted);">
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

			<div class="p-5">
				<pre
					class="max-h-36 overflow-auto rounded-xl border p-3 text-xs leading-relaxed whitespace-pre-wrap"
					style="border-color: var(--mash-divider); background: var(--mash-hover-fill-soft); color: var(--mash-ink-muted);">{previewText()}</pre>

				<div class="mt-4 grid gap-2 sm:grid-cols-3">
					<button
						type="button"
						class="mash-btn-ghost relative flex min-h-28 flex-col items-start rounded-xl p-3 text-left"
						class:border-[var(--mash-accent)]={analysis.suggestedMode === 'single'}
						onclick={() => onChoose('single')}
					>
						<ClipboardPaste class="h-5 w-5 text-[var(--mash-accent-bright)]" />
						<strong class="mt-3 text-sm">One card</strong>
						<small class="mt-1" style="color: var(--mash-ink-muted);"
							>Keep the clipboard together</small
						>
						{#if analysis.suggestedMode === 'single'}<span
								class="mt-auto pt-2 text-[9px] font-semibold uppercase"
								style="color: var(--mash-accent-bright);">Suggested</span
							>{/if}
					</button>

					<button
						type="button"
						class="mash-btn-ghost relative flex min-h-28 flex-col items-start rounded-xl p-3 text-left disabled:opacity-40"
						class:border-[var(--mash-accent)]={analysis.suggestedMode === 'lines'}
						disabled={analysis.lines.length < 2}
						onclick={() => onChoose('lines')}
					>
						<Rows3 class="h-5 w-5 text-[var(--mash-accent-bright)]" />
						<strong class="mt-3 text-sm">{analysis.lines.length} line cards</strong>
						<small class="mt-1" style="color: var(--mash-ink-muted);"
							>Great for lists and options</small
						>
						{#if analysis.suggestedMode === 'lines'}<span
								class="mt-auto pt-2 text-[9px] font-semibold uppercase"
								style="color: var(--mash-accent-bright);">Suggested</span
							>{/if}
					</button>

					<button
						type="button"
						class="mash-btn-ghost relative flex min-h-28 flex-col items-start rounded-xl p-3 text-left disabled:opacity-40"
						class:border-[var(--mash-accent)]={analysis.suggestedMode === 'paragraphs'}
						disabled={analysis.paragraphs.length < 2}
						onclick={() => onChoose('paragraphs')}
					>
						<Pilcrow class="h-5 w-5 text-[var(--mash-accent-bright)]" />
						<strong class="mt-3 text-sm">{analysis.paragraphs.length} paragraph cards</strong>
						<small class="mt-1" style="color: var(--mash-ink-muted);"
							>Keep related context together</small
						>
						{#if analysis.suggestedMode === 'paragraphs'}<span
								class="mt-auto pt-2 text-[9px] font-semibold uppercase"
								style="color: var(--mash-accent-bright);">Suggested</span
							>{/if}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}
