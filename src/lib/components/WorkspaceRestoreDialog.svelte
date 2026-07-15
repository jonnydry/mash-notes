<script lang="ts">
	import { ArchiveRestore, AlertTriangle, X } from '@lucide/svelte';
	import { focusTrap } from '$lib/focus-trap';
	import type { WorkspaceBackup, WorkspaceRestorePlan } from '$lib/workspace-backup';

	interface Props {
		open: boolean;
		backup: WorkspaceBackup;
		plan: WorkspaceRestorePlan;
		busy?: boolean;
		error?: string;
		onConfirm: () => void | Promise<void>;
		onClose: () => void;
	}

	let { open, backup, plan, busy = false, error = '', onConfirm, onClose }: Props = $props();

	$effect(() => {
		if (!open) return;
		function onKey(event: KeyboardEvent) {
			if (event.key !== 'Escape' || busy) return;
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
			if (!busy && event.target === event.currentTarget) onClose();
		}}
	>
		<div
			use:focusTrap={{ initialFocus: '[data-dialog-initial-focus]' }}
			class="mash-dialog-panel mash-paste-dialog"
			role="dialog"
			aria-modal="true"
			aria-labelledby="mash-workspace-restore-title"
			data-testid="workspace-restore-dialog"
		>
			<header class="mash-paste-header">
				<div class="flex min-w-0 flex-1 items-center gap-3">
					<ArchiveRestore class="h-6 w-6 shrink-0 text-[var(--mash-accent-bright)]" />
					<div>
						<h2
							id="mash-workspace-restore-title"
							class="mash-display text-lg font-semibold tracking-tight"
						>
							Restore this workspace backup?
						</h2>
						<p class="mash-dialog-subtitle">
							Created {new Date(backup.exportedAt).toLocaleString()} · backup v{backup.version}
						</p>
					</div>
				</div>
				<button
					data-dialog-initial-focus
					type="button"
					class="mash-peel-icon-btn"
					disabled={busy}
					onclick={onClose}
					aria-label="Cancel workspace restore"
				>
					<X class="h-4 w-4" />
				</button>
			</header>

			<div class="mash-paste-body">
				<div class="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Backup contents">
					{#each [['Desks', plan.counts.sessions], ['Cards', plan.counts.notes], ['Images', plan.counts.assets], ['Results', plan.counts.operations]] as item (item[0])}
						<div class="rounded-lg border p-2" style="border-color: var(--mash-divider);">
							<strong class="mash-display block text-lg">{item[1]}</strong>
							<small style="color: var(--mash-ink-muted);">{item[0]}</small>
						</div>
					{/each}
				</div>

				<p class="mash-type-caption" data-testid="workspace-restore-impact">
					{plan.added} added · {plan.updated} updated · {plan.unchanged} unchanged
					{#if plan.removed > 0}
						· {plan.removed} removed{/if}
					{#if plan.conflicts > 0}
						· {plan.conflicts} conflicts{/if}
				</p>
				<p class="mash-dialog-subtitle">
					Existing local work is not erased. Newer changes win, and conflicting note bodies remain
					reviewable.
				</p>

				{#if plan.warnings.length > 0}
					<div
						class="mash-type-caption rounded-lg border p-3"
						style="border-color: var(--mash-accent); color: var(--mash-ink);"
					>
						{#each plan.warnings as warning, index (index)}
							<p class="flex items-start gap-2">
								<AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" />
								{warning}
							</p>
						{/each}
					</div>
				{/if}

				{#if error}
					<p class="mash-type-caption" role="alert" style="color: var(--mash-danger);">{error}</p>
				{/if}

				<div class="flex justify-end gap-2">
					<button
						type="button"
						class="mash-btn-ghost mash-type-caption rounded-[9px] px-3 py-2"
						disabled={busy}
						onclick={onClose}>Cancel</button
					>
					<button
						type="button"
						class="mash-btn mash-type-caption rounded-[9px] px-3 py-2 font-semibold"
						disabled={busy}
						onclick={onConfirm}
					>
						{busy ? 'Restoring…' : 'Restore backup'}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}
