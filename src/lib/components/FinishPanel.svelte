<script lang="ts">
	import {
		Check,
		Clock3,
		Copy,
		Download,
		Image as ImageIcon,
		Package,
		Printer,
		Trash2
	} from 'lucide-svelte';
	import {
		defaultFinishScope,
		finishScopeOptions,
		type FinishDisposition,
		type FinishDraft,
		type FinishExportKind,
		type FinishScope,
		type FinishSnapshot
	} from '$lib/finish-model';
	import { sessionLifecycleLabel } from '$lib/session-lifecycle';
	import type { Note, Session } from '$lib/types';

	export type FinishExportResult = { ok: boolean; message: string };
	export type FinishCommitResult = { ok: boolean; message: string };

	interface Props {
		snapshot: FinishSnapshot | null;
		notesById: ReadonlyMap<string, Note>;
		activeSession: Session | null;
		onExport: (kind: FinishExportKind, scope: FinishScope) => Promise<FinishExportResult>;
		onCommit: (draft: FinishDraft) => Promise<FinishCommitResult>;
		onLeave: () => void;
		onViewDesks: () => void;
	}

	let { snapshot, notesById, activeSession, onExport, onCommit, onLeave, onViewDesks }: Props =
		$props();

	let scope = $state<FinishScope>('desk');
	let busyKind = $state<FinishExportKind | null>(null);
	let actionStatus = $state<{ kind: FinishExportKind; ok: boolean; message: string } | null>(null);
	let disposition = $state<FinishDisposition>('leave');
	let keepTakeaway = $state(false);
	let commitBusy = $state(false);
	let commitStatus = $state<FinishCommitResult | null>(null);
	let options = $derived(snapshot ? finishScopeOptions(snapshot, notesById) : []);
	let activeOption = $derived(options.find((option) => option.scope === scope) ?? options[0]);
	let hasTakeaway = $derived((activeOption?.count ?? 0) > 0);

	$effect(() => {
		if (!snapshot) return;
		scope = defaultFinishScope(snapshot);
		actionStatus = null;
		busyKind = null;
		disposition = 'leave';
		keepTakeaway = false;
		commitStatus = null;
		commitBusy = false;
	});

	$effect(() => {
		if (scope === 'desk' || disposition === 'keep-desk' || activeSession?.mode === 'kept') {
			keepTakeaway = false;
		}
		commitStatus = null;
	});

	async function runExport(kind: FinishExportKind) {
		if (busyKind || !snapshot || !hasTakeaway) return;
		busyKind = kind;
		actionStatus = null;
		try {
			const result = await onExport(kind, kind === 'bundle' ? 'desk' : scope);
			actionStatus = { kind, ...result };
		} catch {
			actionStatus = { kind, ok: false, message: 'That export did not finish. Try again.' };
		} finally {
			busyKind = null;
		}
	}

	async function commitFinish() {
		if (commitBusy || !snapshot) return;
		commitBusy = true;
		commitStatus = null;
		try {
			commitStatus = await onCommit({ scope, keepTakeaway, disposition });
		} catch {
			commitStatus = {
				ok: false,
				message: 'Mash could not update local storage. Export your work and try again.'
			};
		} finally {
			commitBusy = false;
		}
	}

	const exportActions: Array<{
		kind: FinishExportKind;
		label: string;
		detail: string;
		icon: typeof Copy;
		primary?: boolean;
	}> = [
		{
			kind: 'copy-markdown',
			label: 'Copy Markdown',
			detail: 'Ready to paste anywhere',
			icon: Copy,
			primary: true
		},
		{
			kind: 'download-markdown',
			label: 'Download Markdown',
			detail: 'One portable .md file',
			icon: Download
		},
		{
			kind: 'pdf',
			label: 'Print / save PDF',
			detail: 'One card per page',
			icon: Printer
		},
		{
			kind: 'board-image',
			label: 'Board image',
			detail: 'Cards + visible relationships',
			icon: ImageIcon
		},
		{
			kind: 'bundle',
			label: 'MASH bundle',
			detail: 'Whole desk + result history',
			icon: Package
		}
	];
</script>

<div class="mash-finish">
	<div data-testid="finish-scroll" class="mash-finish-scroll">
		<section class="mash-finish-section" aria-labelledby="mash-finish-takeaway-title">
			<div class="flex items-center justify-between gap-3">
				<h3 id="mash-finish-takeaway-title" class="mash-finish-heading">Takeaway</h3>
				{#if activeOption}
					<span class="text-[11px]" style="color: var(--mash-ink-muted);">
						{activeOption.count} card{activeOption.count === 1 ? '' : 's'}
					</span>
				{/if}
			</div>

			<fieldset class="mt-0 border-0 p-0">
				<legend class="sr-only">Choose what to take with you</legend>
				<div class="mash-finish-scope">
					{#each options as option (option.scope)}
						<label
							class="mash-finish-choice"
							class:is-selected={scope === option.scope}
							class:opacity-45={!option.enabled}
						>
							<input
								class="sr-only"
								type="radio"
								name="finish-scope"
								value={option.scope}
								checked={scope === option.scope}
								disabled={!option.enabled}
								onchange={() => {
									scope = option.scope;
									actionStatus = null;
								}}
							/>
							{option.label} · {option.count}
						</label>
					{/each}
				</div>
			</fieldset>
			<p class="sr-only" aria-live="polite" aria-atomic="true">
				{activeOption
					? `${activeOption.label} takeaway, ${activeOption.count} ${activeOption.count === 1 ? 'card' : 'cards'}`
					: 'No takeaway cards'}
			</p>

			<p class="mash-finish-preview truncate">
				{activeOption?.preview || 'Add or import something first.'}
			</p>

			<div class="mash-finish-export-grid">
				{#each exportActions as exportAction (exportAction.kind)}
					{@const Icon = exportAction.icon}
					<button
						type="button"
						class={exportAction.primary
							? 'mash-btn mash-finish-export mash-finish-export--primary'
							: 'mash-finish-export mash-finish-export--secondary'}
						disabled={!hasTakeaway || busyKind !== null}
						aria-busy={busyKind === exportAction.kind}
						onclick={() => void runExport(exportAction.kind)}
					>
						<Icon class="h-4 w-4 shrink-0" aria-hidden="true" />
						<span class="min-w-0 flex-1">
							<strong class="block text-xs">{exportAction.label}</strong>
							<small class="block truncate text-[10px] opacity-75">
								{busyKind === exportAction.kind ? 'Working…' : exportAction.detail}
							</small>
						</span>
						{#if actionStatus?.kind === exportAction.kind && actionStatus.ok}
							<Check class="h-4 w-4 shrink-0" aria-hidden="true" />
						{/if}
					</button>
				{/each}
			</div>

			{#if actionStatus}
				<p
					class="mash-finish-status"
					class:is-ok={actionStatus.ok}
					class:is-error={!actionStatus.ok}
					role="status"
					aria-label="Takeaway export status"
				>
					{actionStatus.message}
				</p>
			{/if}
		</section>

		<section
			class="mash-finish-section"
			aria-labelledby="mash-finish-remain-title"
		>
			<h3 id="mash-finish-remain-title" class="mash-finish-heading">What stays here?</h3>
			{#if activeSession?.mode === 'scratch' && scope !== 'desk' && hasTakeaway}
				<label class="mash-finish-keep-takeaway">
					<input type="checkbox" bind:checked={keepTakeaway} />
					<span class="min-w-0 flex-1">
						<strong class="block text-sm">Keep this takeaway on this device</strong>
						{activeOption?.count ?? 0} card{activeOption?.count === 1 ? '' : 's'} will also appear in
						Kept takeaways.
					</span>
				</label>
			{/if}

			<fieldset class="mt-0 border-0 p-0">
				<legend class="sr-only">Choose what happens to this desk</legend>
				<div class="mash-finish-disposition-grid">
					<label
						class="mash-finish-disposition"
						class:is-selected={disposition === 'leave'}
					>
						<input
							class="sr-only"
							type="radio"
							name="finish-disposition"
							value="leave"
							bind:group={disposition}
						/>
						<Clock3 class="h-4 w-4 shrink-0" />
						<span
							><strong class="block"
								>{activeSession?.mode === 'kept' ? 'Keep as is' : 'Leave as scratch'}</strong
							>Return to desk</span
						>
					</label>
					{#if activeSession?.mode === 'scratch'}
						<label
							class="mash-finish-disposition"
							class:is-selected={disposition === 'keep-desk'}
						>
							<input
								class="sr-only"
								type="radio"
								name="finish-disposition"
								value="keep-desk"
								bind:group={disposition}
							/>
							<Check class="h-4 w-4 shrink-0 text-[var(--mash-accent-bright)]" />
							<span><strong class="block">Keep entire desk</strong>Never auto-clears</span>
						</label>
					{/if}
					<label
						class="mash-finish-disposition is-danger"
						class:is-selected={disposition === 'clear'}
					>
						<input
							class="sr-only"
							type="radio"
							name="finish-disposition"
							value="clear"
							bind:group={disposition}
						/>
						<Trash2 class="h-4 w-4 shrink-0 text-[var(--mash-danger)]" />
						<span><strong class="block">Clear now</strong>Recoverable 7 days</span>
					</label>
				</div>
			</fieldset>
			{#if activeSession}
				<p class="mt-3 text-[11px]" style="color: var(--mash-ink-muted);">
					{sessionLifecycleLabel(activeSession, Date.now())}
				</p>
			{/if}
			{#if commitStatus}
				<p
					class="mash-finish-status"
					class:is-ok={commitStatus.ok}
					class:is-error={!commitStatus.ok}
					role="status"
					aria-label="Finish lifecycle status"
				>
					{commitStatus.message}
				</p>
			{/if}
		</section>
	</div>

	<div data-testid="finish-footer" class="mash-finish-footer">
		<button
			type="button"
			class="mash-btn-ghost mash-finish-footer-secondary"
			onclick={onLeave}>Back to desk</button
		>
		<button
			type="button"
			class="mash-btn mash-finish-footer-primary"
			aria-disabled={commitBusy}
			onclick={() => void commitFinish()}
		>
			{commitBusy ? 'Finishing…' : disposition === 'clear' ? 'Finish and clear' : 'Finish'}
		</button>
		<button type="button" class="mash-finish-footer-link" onclick={onViewDesks}>
			View all desks
		</button>
	</div>
</div>
