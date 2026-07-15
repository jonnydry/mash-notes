<script lang="ts">
	import { Film, Image as ImageIcon, X } from '@lucide/svelte';
	import { focusTrap } from '$lib/focus-trap';
	import { GIF_EXPLODE_MAX_FRAMES, type GifExplodeMode } from '$lib/gif-explode';

	interface Props {
		open: boolean;
		fileName: string;
		frameCount: number;
		onChoose: (mode: GifExplodeMode) => void | Promise<void>;
		onClose: () => void;
	}

	let { open, fileName, frameCount, onChoose, onClose }: Props = $props();

	const importCount = $derived(
		frameCount <= GIF_EXPLODE_MAX_FRAMES ? frameCount : GIF_EXPLODE_MAX_FRAMES
	);
	const willSample = $derived(frameCount > GIF_EXPLODE_MAX_FRAMES);

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
			aria-labelledby="mash-gif-explode-title"
			data-testid="gif-explode-dialog"
		>
			<header class="mash-paste-header">
				<div class="min-w-0 flex-1">
					<h2 id="mash-gif-explode-title" class="mash-display text-lg font-semibold tracking-tight">
						Animated GIF
					</h2>
					<p class="mash-dialog-subtitle">
						{fileName || 'GIF'} · {frameCount} frame{frameCount === 1 ? '' : 's'}
					</p>
				</div>
				<button
					data-dialog-initial-focus
					type="button"
					class="mash-peel-icon-btn"
					onclick={onClose}
					aria-label="Cancel GIF import"
				>
					<X class="h-4 w-4" />
				</button>
			</header>

			<div class="mash-paste-body">
				<p class="mash-dialog-subtitle" style="margin-bottom: 0.75rem;">
					Keep a still, or explode frames into a set of cards you can mash.
				</p>

				<div class="mash-paste-choices">
					<button
						type="button"
						class="mash-btn-ghost mash-paste-choice"
						data-testid="gif-explode-still"
						onclick={() => onChoose('still')}
					>
						<ImageIcon class="h-5 w-5 text-[var(--mash-accent-bright)]" />
						<strong>One still</strong>
						<small>First frame as a single visual sticky</small>
					</button>

					<button
						type="button"
						class="mash-btn-ghost mash-paste-choice is-suggested"
						data-testid="gif-explode-frames"
						onclick={() => onChoose('frames')}
					>
						<Film class="h-5 w-5 text-[var(--mash-accent-bright)]" />
						<strong>{importCount} frame card{importCount === 1 ? '' : 's'}</strong>
						<small>
							{#if willSample}
								Evenly sample {importCount} of {frameCount} frames
							{:else}
								One card per frame — arrange and mash the good ones
							{/if}
						</small>
						<span class="mash-paste-suggested">Fun</span>
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}
