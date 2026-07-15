<script lang="ts">
	import { Undo2 } from '@lucide/svelte';
	import type { OperationReceiptView } from '$lib/operator-kitchen';

	interface Props {
		receipt: OperationReceiptView | null;
		canUndo: boolean;
		onUndo?: () => void | Promise<void>;
	}

	let { receipt, canUndo, onUndo }: Props = $props();
</script>

{#if receipt && !receipt.reverted}
	<div
		class="mash-operator-receipt flex max-w-[min(92vw,28rem)] items-center gap-2 rounded-2xl border px-3 py-1.5 shadow-xl"
		style="border-color: var(--mash-panel-border); background: var(--mash-panel); backdrop-filter: blur(10px);"
		data-testid="operator-receipt"
		role="status"
		aria-live="polite"
		aria-label="Last transform receipt"
	>
		<div class="min-w-0 flex-1">
			<div class="flex items-baseline gap-2">
				<strong
					class="mash-type-caption font-semibold tracking-tight"
					style="color: var(--mash-ink);"
				>
					{receipt.title}
				</strong>
				<span
					class="mash-type-micro shrink-0 rounded-md px-1.5 py-px font-semibold tabular-nums"
					style="background: color-mix(in srgb, var(--mash-accent) 16%, transparent); color: var(--mash-accent);"
					data-testid="operator-receipt-summary"
				>
					{receipt.summary}
				</span>
			</div>
			<p class="mash-type-micro truncate" style="color: var(--mash-ink-muted);">
				{receipt.detail}
				{#if canUndo}
					<span aria-hidden="true"> · Undo reverses this</span>
				{/if}
			</p>
		</div>
		{#if canUndo && onUndo}
			<button
				type="button"
				class="mash-btn-ghost mash-type-caption flex shrink-0 items-center gap-1 rounded-xl px-2 py-1 font-semibold"
				data-testid="operator-receipt-undo"
				onclick={() => void onUndo()}
				title="Undo this transform"
				aria-label="Undo this transform"
			>
				<Undo2 class="h-3.5 w-3.5" />
				Undo
			</button>
		{/if}
	</div>
{/if}
