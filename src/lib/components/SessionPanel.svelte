<script lang="ts">
	import { onMount } from 'svelte';
	import { Check, Clock3, Plus, RotateCcw, X } from 'lucide-svelte';
	import { SCRATCH_RETENTION_OPTIONS, sessionLifecycleLabel } from '$lib/session-lifecycle';
	import type { Note, Session } from '$lib/types';
	import { focusTrap } from '$lib/focus-trap';
	import { formatStorageBytes, type StorageHealth } from '$lib/storage-health';
	import FinishPanel, {
		type FinishCommitResult,
		type FinishExportResult
	} from '$lib/components/FinishPanel.svelte';
	import type {
		FinishDraft,
		FinishExportKind,
		FinishScope,
		FinishSnapshot
	} from '$lib/finish-model';

	interface Props {
		open: boolean;
		initialView?: 'desks' | 'finish';
		activeSession: Session | null;
		activeSessions: Session[];
		recoveringSessions: Session[];
		retentionDays: number;
		finishSnapshot?: FinishSnapshot | null;
		notesById?: ReadonlyMap<string, Note>;
		storageHealth?: StorageHealth | null;
		onClose: () => void;
		onSwitch: (id: string) => void | Promise<void>;
		onNewScratch: () => void | Promise<void>;
		onFinishExport: (kind: FinishExportKind, scope: FinishScope) => Promise<FinishExportResult>;
		onFinishCommit: (draft: FinishDraft) => Promise<FinishCommitResult>;
		onRestore: (id: string) => void | Promise<void>;
		onRetentionChange: (days: number) => void | Promise<void>;
		onRefreshStorage?: () => void | Promise<void>;
	}

	let {
		open,
		initialView = 'desks',
		activeSession,
		activeSessions,
		recoveringSessions,
		retentionDays,
		finishSnapshot = null,
		notesById = new Map(),
		storageHealth = null,
		onClose,
		onSwitch,
		onNewScratch,
		onFinishExport,
		onFinishCommit,
		onRestore,
		onRetentionChange,
		onRefreshStorage
	}: Props = $props();

	let view = $state<'desks' | 'finish'>('desks');

	$effect(() => {
		if (!open) return;
		view = initialView;
	});

	onMount(() => {
		function onKeydown(event: KeyboardEvent) {
			if (!open || event.key !== 'Escape') return;
			event.preventDefault();
			onClose();
		}
		window.addEventListener('keydown', onKeydown);
		return () => window.removeEventListener('keydown', onKeydown);
	});
</script>

{#if open}
	<div
		class="fixed inset-0 z-50 flex items-end justify-center bg-[var(--mash-backdrop)] p-0 backdrop-blur-md sm:items-center sm:p-4"
		role="presentation"
		onclick={(event) => {
			if (event.target === event.currentTarget) onClose();
		}}
	>
		<div
			use:focusTrap={{ initialFocus: '[data-dialog-initial-focus]' }}
			class="flex max-h-[100dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl"
			style="border-color: var(--mash-panel-border); background: var(--mash-panel-strong); color: var(--mash-ink);"
			role="dialog"
			aria-modal="true"
			aria-labelledby="mash-session-panel-title"
			aria-describedby="mash-session-panel-description"
		>
			<header
				class="flex items-center gap-3 border-b px-5 py-4"
				style="border-color: var(--mash-divider);"
			>
				<div class="min-w-0 flex-1">
					<h2 id="mash-session-panel-title" class="mash-display text-lg font-semibold">
						{view === 'finish' ? 'Finish this desk' : 'Your desks'}
					</h2>
					<p
						id="mash-session-panel-description"
						class="mt-0.5 text-xs"
						style="color: var(--mash-ink-muted);"
					>
						{view === 'finish'
							? 'Take the useful part with you, then decide what stays.'
							: 'Scratch desks clear themselves. Kept desks stay on this device.'}
					</p>
				</div>
				<button
					data-dialog-initial-focus
					type="button"
					class="mash-peel-icon-btn min-h-11 min-w-11 sm:min-h-0 sm:min-w-0"
					onclick={onClose}
					aria-label="Close desk panel"
				>
					<X class="h-4 w-4" />
				</button>
			</header>

			{#if view === 'finish'}
				<FinishPanel
					snapshot={finishSnapshot}
					{notesById}
					{activeSession}
					onExport={onFinishExport}
					onCommit={onFinishCommit}
					onLeave={onClose}
					onViewDesks={() => (view = 'desks')}
				/>
			{:else}
				<div class="max-h-[70vh] overflow-y-auto p-5">
					<div class="flex items-center justify-between gap-3">
						<div>
							<div
								class="text-[10px] font-semibold tracking-[0.12em] uppercase"
								style="color: var(--mash-accent-bright);"
							>
								Active desks
							</div>
							<p class="mt-1 text-[11px]" style="color: var(--mash-ink-muted);">
								Work stays local to this browser.
							</p>
						</div>
						<button
							type="button"
							class="mash-btn flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold"
							onclick={onNewScratch}
						>
							<Plus class="h-3.5 w-3.5" /> New scratch desk
						</button>
					</div>

					<div class="mt-4 space-y-2">
						{#each activeSessions as session (session.id)}
							<button
								type="button"
								class="mash-row-hover flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left"
								class:mash-row-active={session.id === activeSession?.id}
								style="border-color: var(--mash-divider);"
								onclick={() => onSwitch(session.id)}
							>
								<span
									class="flex h-9 w-9 items-center justify-center rounded-lg"
									style="background: var(--mash-accent-wash); color: var(--mash-accent-bright);"
								>
									{#if session.mode === 'scratch'}<Clock3 class="h-4 w-4" />{:else}<Check
											class="h-4 w-4"
										/>{/if}
								</span>
								<span class="min-w-0 flex-1">
									<strong class="block truncate text-sm">{session.title}</strong>
									<small style="color: var(--mash-ink-muted);"
										>{sessionLifecycleLabel(session, Date.now())}</small
									>
								</span>
								{#if session.id === activeSession?.id}<span
										class="text-[10px] font-semibold uppercase"
										style="color: var(--mash-accent-bright);">Open</span
									>{/if}
							</button>
						{/each}
					</div>

					{#if recoveringSessions.length > 0}
						<div class="mt-6 border-t pt-4" style="border-color: var(--mash-divider);">
							<div
								class="text-[10px] font-semibold tracking-[0.12em] uppercase"
								style="color: var(--mash-ink-muted);"
							>
								Recently cleared
							</div>
							<div class="mt-2 space-y-2">
								{#each recoveringSessions as session (session.id)}
									<div
										class="flex items-center gap-3 rounded-xl border px-3 py-3"
										style="border-color: var(--mash-divider);"
									>
										<RotateCcw class="h-4 w-4 shrink-0" style="color: var(--mash-ink-muted);" />
										<span class="min-w-0 flex-1">
											<strong class="block truncate text-sm">{session.title}</strong>
											<small style="color: var(--mash-ink-muted);"
												>{sessionLifecycleLabel(session, Date.now())}</small
											>
										</span>
										<button
											type="button"
											class="mash-btn-ghost rounded-lg px-3 py-1.5 text-xs"
											onclick={() => onRestore(session.id)}>Restore</button
										>
									</div>
								{/each}
							</div>
						</div>
					{/if}

					<div
						class="mt-6 flex items-center justify-between gap-4 rounded-xl border px-3 py-3"
						style="border-color: var(--mash-divider);"
					>
						<div>
							<strong class="block text-xs">Scratch retention</strong>
							<small style="color: var(--mash-ink-muted);"
								>Meaningful activity resets the timer.</small
							>
						</div>
						<select
							class="mash-focus rounded-lg border bg-transparent px-2 py-1.5 text-xs"
							style="border-color: var(--mash-tray-edge);"
							value={retentionDays}
							onchange={(event) => onRetentionChange(Number(event.currentTarget.value))}
						>
							{#each SCRATCH_RETENTION_OPTIONS as days (days)}
								<option value={days}>{days} day{days === 1 ? '' : 's'}</option>
							{/each}
						</select>
					</div>
				</div>
			{/if}
			{#if storageHealth?.supported && view === 'desks'}
				<div
					class="flex flex-wrap items-center gap-3 border-t px-5 py-3 text-[11px]"
					style="border-color: var(--mash-divider); color: var(--mash-ink-muted);"
				>
					<span class="min-w-0 flex-1">
						<strong class="block text-xs" style="color: var(--mash-ink);">Local storage</strong>
						{formatStorageBytes(storageHealth.usage)} used of {formatStorageBytes(
							storageHealth.quota
						)}
						· {storageHealth.persisted === true ? 'browser-protected' : 'managed by this browser'}
						{#if storageHealth.pressure === 'warning'}
							· getting full{/if}
						{#if storageHealth.pressure === 'critical'}
							· nearly full{/if}
					</span>
					<button
						type="button"
						class="mash-btn-ghost rounded-lg px-2.5 py-1.5 text-xs"
						onclick={() => void onRefreshStorage?.()}
					>
						Refresh
					</button>
				</div>
			{/if}
		</div>
	</div>
{/if}
