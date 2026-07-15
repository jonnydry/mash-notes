<script lang="ts">
	import { onMount } from 'svelte';
	import { Check, Clock3, Plus, RotateCcw, X } from '@lucide/svelte';
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
		workspaceBackupStatus?: string;
		workspaceBackupBusy?: boolean;
		onClose: () => void;
		onSwitch: (id: string) => void | Promise<void>;
		onNewScratch: () => void | Promise<void>;
		onFinishExport: (kind: FinishExportKind, scope: FinishScope) => Promise<FinishExportResult>;
		onFinishCommit: (draft: FinishDraft) => Promise<FinishCommitResult>;
		onRestore: (id: string) => void | Promise<void>;
		onRetentionChange: (days: number) => void | Promise<void>;
		onRefreshStorage?: () => void | Promise<void>;
		onBackupWorkspace?: () => void | Promise<void>;
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
		workspaceBackupStatus = '',
		workspaceBackupBusy = false,
		onClose,
		onSwitch,
		onNewScratch,
		onFinishExport,
		onFinishCommit,
		onRestore,
		onRetentionChange,
		onRefreshStorage,
		onBackupWorkspace
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
			class="mash-session-dialog flex max-h-[100dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl"
			style="background: var(--mash-panel-strong); color: var(--mash-ink);"
			role="dialog"
			aria-modal="true"
			aria-labelledby="mash-session-panel-title"
			aria-describedby="mash-session-panel-description"
		>
			<header class="mash-session-header">
				<div class="min-w-0 flex-1">
					{#if view === 'finish'}
						<div class="mash-finish-header-brand">
							<img
								src="/icons/Rotating%20Icons/Salt%20and%20pepper%20shakers@2x.png"
								alt=""
								width="48"
								height="48"
								class="mash-finish-header-logo"
								draggable="false"
							/>
							<div class="min-w-0">
								<h2 id="mash-session-panel-title" class="mash-display text-lg font-semibold">
									Finish this desk
								</h2>
								<p id="mash-session-panel-description" class="mash-session-header-desc">
									Take the useful part with you, then decide what stays.
								</p>
							</div>
						</div>
					{:else}
						<h2 id="mash-session-panel-title" class="mash-display text-lg font-semibold">
							Your desks
						</h2>
						<p id="mash-session-panel-description" class="mash-session-header-desc">
							Scratch desks clear themselves. Kept desks stay on this device.
						</p>
					{/if}
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
				<div class="mash-session-body">
					<div class="flex items-center justify-between gap-3">
						<div>
							<div class="mash-session-section-label">Active desks</div>
							<p class="mash-session-section-hint">Work stays local to this browser.</p>
						</div>
						<button
							type="button"
							class="mash-btn mash-type-caption flex items-center gap-1.5 rounded-[9px] px-3 py-2 font-semibold"
							onclick={onNewScratch}
						>
							<Plus class="h-3.5 w-3.5" /> New scratch desk
						</button>
					</div>

					<div class="mash-session-list">
						{#each activeSessions as session (session.id)}
							<button
								type="button"
								class="mash-session-row"
								class:is-active={session.id === activeSession?.id}
								class:mash-row-active={session.id === activeSession?.id}
								onclick={() => onSwitch(session.id)}
							>
								<span class="mash-session-row-icon">
									{#if session.mode === 'scratch'}<Clock3 class="h-4 w-4" />{:else}<Check
											class="h-4 w-4"
										/>{/if}
								</span>
								<span class="min-w-0 flex-1">
									<strong class="mash-type-body block truncate">{session.title}</strong>
									<small style="color: var(--mash-ink-muted);"
										>{sessionLifecycleLabel(session, Date.now())}</small
									>
								</span>
								{#if session.id === activeSession?.id}<span class="mash-session-row-badge"
										>Open</span
									>{/if}
							</button>
						{/each}
					</div>

					{#if recoveringSessions.length > 0}
						<div class="mash-session-recover-block">
							<div class="mash-session-section-label">Recently cleared</div>
							<div class="mash-session-list" style="margin-top: 10px;">
								{#each recoveringSessions as session (session.id)}
									<div class="mash-session-recover-row">
										<RotateCcw class="h-4 w-4 shrink-0" style="color: var(--mash-ink-muted);" />
										<span class="min-w-0 flex-1">
											<strong class="mash-type-body block truncate">{session.title}</strong>
											<small style="color: var(--mash-ink-muted);"
												>{sessionLifecycleLabel(session, Date.now())}</small
											>
										</span>
										<button
											type="button"
											class="mash-btn-ghost mash-type-caption rounded-[9px] px-3 py-1.5"
											onclick={() => onRestore(session.id)}>Restore</button
										>
									</div>
								{/each}
							</div>
						</div>
					{/if}

					<div class="mash-session-retention">
						<div>
							<strong class="mash-type-caption block">Scratch retention</strong>
							<small style="color: var(--mash-ink-muted);"
								>Meaningful activity resets the timer.</small
							>
						</div>
						<select
							class="mash-focus mash-type-caption rounded-[9px] border bg-transparent px-2.5 py-1.5"
							style="border-color: var(--mash-divider);"
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
			{#if view === 'desks' && workspaceBackupStatus}
				<div class="mash-session-storage" data-testid="workspace-backup-health">
					<span class="min-w-0 flex-1">
						<strong class="mash-type-caption block" style="color: var(--mash-ink);"
							>Workspace backup</strong
						>
						{workspaceBackupStatus}
					</span>
					{#if onBackupWorkspace}
						<button
							type="button"
							class="mash-btn-ghost mash-type-caption rounded-[9px] px-2.5 py-1.5"
							disabled={workspaceBackupBusy}
							onclick={() => void onBackupWorkspace()}
						>
							{workspaceBackupBusy ? 'Preparing…' : 'Back up'}
						</button>
					{/if}
				</div>
			{/if}
			{#if storageHealth?.supported && view === 'desks'}
				<div class="mash-session-storage">
					<span class="min-w-0 flex-1">
						<strong class="mash-type-caption block" style="color: var(--mash-ink);"
							>Local storage</strong
						>
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
						class="mash-btn-ghost mash-type-caption rounded-[9px] px-2.5 py-1.5"
						onclick={() => void onRefreshStorage?.()}
					>
						Refresh
					</button>
				</div>
			{/if}
		</div>
	</div>
{/if}
