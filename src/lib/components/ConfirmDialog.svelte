<script lang="ts">
	interface Props {
		open: boolean;
		title: string;
		message: string;
		confirmLabel?: string;
		cancelLabel?: string;
		danger?: boolean;
		onConfirm: () => void;
		onCancel: () => void;
	}

	let {
		open,
		title,
		message,
		confirmLabel = 'Confirm',
		cancelLabel = 'Cancel',
		danger = false,
		onConfirm,
		onCancel
	}: Props = $props();

	let dialogEl: HTMLDivElement | undefined = $state();
	let confirmBtn: HTMLButtonElement | undefined = $state();

	$effect(() => {
		if (!open) return;
		requestAnimationFrame(() => confirmBtn?.focus());
		function onKey(e: KeyboardEvent) {
			if (e.key === 'Escape') {
				e.preventDefault();
				e.stopImmediatePropagation();
				onCancel();
				return;
			}
			if (e.key === 'Enter') {
				e.preventDefault();
				e.stopImmediatePropagation();
				onConfirm();
			}
		}
		window.addEventListener('keydown', onKey, true);
		return () => window.removeEventListener('keydown', onKey, true);
	});
</script>

{#if open}
	<div
		class="mash-confirm-backdrop"
		role="presentation"
		onclick={(e) => {
			if (e.target === e.currentTarget) onCancel();
		}}
	>
		<div
			bind:this={dialogEl}
			class="mash-confirm-dialog"
			role="alertdialog"
			aria-modal="true"
			aria-labelledby="mash-confirm-title"
			aria-describedby="mash-confirm-msg"
		>
			<h2 id="mash-confirm-title" class="mash-display text-base font-semibold tracking-tight">
				{title}
			</h2>
			<p
				id="mash-confirm-msg"
				class="mt-2 text-sm leading-relaxed"
				style="color: var(--mash-ink-muted);"
			>
				{message}
			</p>
			<div class="mt-4 flex items-center justify-end gap-2">
				<button
					type="button"
					class="mash-btn-ghost rounded-lg px-3 py-1.5 text-xs"
					onclick={onCancel}
				>
					{cancelLabel}
				</button>
				<button
					bind:this={confirmBtn}
					type="button"
					class="rounded-lg px-3 py-1.5 text-xs font-semibold {danger
						? 'mash-btn-danger'
						: 'mash-btn'}"
					onclick={onConfirm}
				>
					{confirmLabel}
				</button>
			</div>
		</div>
	</div>
{/if}
