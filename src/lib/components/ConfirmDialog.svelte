<script lang="ts">
	import { focusTrap } from '$lib/focus-trap';
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

	$effect(() => {
		if (!open) return;
		function onKey(e: KeyboardEvent) {
			if (e.key === 'Escape') {
				e.preventDefault();
				e.stopImmediatePropagation();
				onCancel();
				return;
			}
			// Enter activates the focused control only — never force-confirm when Cancel is focused.
			if (e.key === 'Enter') {
				const target = e.target;
				if (!(target instanceof HTMLElement)) return;
				if (target.closest('[data-dialog-confirm]')) {
					e.preventDefault();
					e.stopImmediatePropagation();
					onConfirm();
					return;
				}
				if (target.closest('[data-dialog-cancel]')) {
					e.preventDefault();
					e.stopImmediatePropagation();
					onCancel();
				}
			}
		}
		window.addEventListener('keydown', onKey, true);
		return () => window.removeEventListener('keydown', onKey, true);
	});
</script>

{#if open}
	<div
		class="mash-dialog-backdrop mash-confirm-backdrop"
		role="presentation"
		onclick={(e) => {
			if (e.target === e.currentTarget) onCancel();
		}}
	>
		<div
			use:focusTrap={{ initialFocus: '[data-dialog-initial-focus]' }}
			class="mash-dialog-panel mash-confirm-dialog"
			role="alertdialog"
			aria-modal="true"
			aria-labelledby="mash-confirm-title"
			aria-describedby="mash-confirm-msg"
		>
			<h2 id="mash-confirm-title" class="mash-display text-base font-semibold tracking-tight">
				{title}
			</h2>
			<p id="mash-confirm-msg" class="mash-dialog-message">
				{message}
			</p>
			<div class="mash-dialog-actions">
				<button
					type="button"
					data-dialog-cancel
					class="mash-btn-ghost mash-dialog-btn"
					onclick={onCancel}
				>
					{cancelLabel}
				</button>
				<button
					data-dialog-initial-focus
					data-dialog-confirm
					type="button"
					class="mash-dialog-btn mash-dialog-btn-primary {danger ? 'mash-btn-danger' : 'mash-btn'}"
					onclick={onConfirm}
				>
					{confirmLabel}
				</button>
			</div>
		</div>
	</div>
{/if}
