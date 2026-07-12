<script lang="ts">
	import { X } from 'lucide-svelte';
	import { theme } from '$lib/stores/theme.svelte';
	import { typography, type TypographySuiteId } from '$lib/stores/typography.svelte';
	import { flatShortcutRows } from '$lib/keyboard-shortcuts';
	import { formatNoteTimestamp } from '$lib/format';
	import { syncBackupHint } from '$lib/sync-hygiene';

	interface Props {
		snapEnabled: boolean;
		lastExportAt?: number | null;
		lastImportAt?: number | null;
		onClose: () => void;
		onSnapChange: (on: boolean) => void;
		onOrganize: () => void;
		onOpenShortcuts?: () => void;
		onImportMarkdown: () => void;
		onImportJson: () => void;
		onExportJson: () => void;
		onImportSync: () => void;
		onExportSync: () => void;
		onOpenDocx?: () => void;
		onOpenHtml?: () => void;
		onOpenImage?: () => void;
		conflictCount?: number;
		onOpenConflicts?: () => void;
	}

	let {
		snapEnabled,
		lastExportAt = null,
		lastImportAt = null,
		onClose,
		onSnapChange,
		onOrganize,
		onOpenShortcuts,
		onImportMarkdown,
		onImportJson,
		onExportJson,
		onImportSync,
		onExportSync,
		onOpenDocx,
		onOpenHtml,
		onOpenImage,
		conflictCount = 0,
		onOpenConflicts
	}: Props = $props();

	const shortcuts = flatShortcutRows().slice(0, 6);
	const backupHint = $derived(
		syncBackupHint({
			lastExportAt,
			lastImportAt,
			lastImportExportedAt: null
		})
	);
</script>

<aside class="mash-peel mash-settings" aria-label="Settings">
	<div class="mash-peel-header">
		<div class="min-w-0 flex-1">
			<div class="mash-peel-title truncate">Settings</div>
			<div class="mash-peel-subtitle">Local preferences & data</div>
		</div>
		<button type="button" class="mash-peel-icon-btn" onclick={onClose} aria-label="Close settings">
			<X class="h-3.5 w-3.5" strokeWidth={2} />
		</button>
	</div>

	<div class="mash-settings-body">
		<section class="mash-settings-section">
			<h2 class="mash-settings-heading">Appearance</h2>
			<div class="mash-settings-row">
				<span class="mash-settings-label">Theme</span>
				<div class="mash-settings-seg" role="group" aria-label="Theme">
					<button
						type="button"
						class="mash-settings-seg-btn"
						class:is-active={theme.mode === 'light'}
						onclick={() => theme.setMode('light')}
					>
						<img
							src="/icons/mash-flame-day.png"
							srcset="/icons/mash-flame-day.png 1x, /icons/mash-flame-day@2x.png 2x"
							alt=""
							width="20"
							height="20"
							class="mash-theme-flame mash-theme-flame--sm"
							draggable="false"
						/>
						Day
					</button>
					<button
						type="button"
						class="mash-settings-seg-btn"
						class:is-active={theme.mode === 'dark'}
						onclick={() => theme.setMode('dark')}
					>
						<img
							src="/icons/mash-flame-night.png"
							srcset="/icons/mash-flame-night.png 1x, /icons/mash-flame-night@2x.png 2x"
							alt=""
							width="20"
							height="20"
							class="mash-theme-flame mash-theme-flame--sm"
							draggable="false"
						/>
						Night
					</button>
				</div>
			</div>
			<p class="mash-settings-hint">Stickies and chrome both follow day / night.</p>

			<div class="mash-settings-type-block">
				<span class="mash-settings-label" id="mash-typography-label">Typography</span>
				<div
					class="mash-settings-type-list"
					role="radiogroup"
					aria-labelledby="mash-typography-label"
					data-testid="typography-suite"
				>
					{#each typography.suites as suite (suite.id)}
						<button
							type="button"
							role="radio"
							class="mash-settings-type-option"
							class:is-active={typography.suiteId === suite.id}
							aria-checked={typography.suiteId === suite.id}
							data-testid="typography-suite-{suite.id}"
							onclick={() => typography.setSuite(suite.id as TypographySuiteId)}
						>
							<span class="mash-settings-type-meta">
								<span class="mash-settings-type-name">{suite.label}</span>
								<span class="mash-settings-type-hint">{suite.hint}</span>
							</span>
							<span
								class="mash-settings-type-sample"
								style="font-family: {suite.display};"
							>
								{suite.sample}
							</span>
						</button>
					{/each}
				</div>
				<p class="mash-settings-hint">
					Pairs UI + display faces across the desk. Napkin uses Excalifont (OFL) from Excalidraw.
				</p>
			</div>
		</section>

		<section class="mash-settings-section">
			<h2 class="mash-settings-heading">Desk</h2>
			<div class="mash-settings-row">
				<span class="mash-settings-label">Snap to grid</span>
				<div class="mash-settings-seg" role="group" aria-label="Snap to grid">
					<button
						type="button"
						class="mash-settings-seg-btn"
						class:is-active={!snapEnabled}
						onclick={() => onSnapChange(false)}
					>
						Free
					</button>
					<button
						type="button"
						class="mash-settings-seg-btn"
						class:is-active={snapEnabled}
						onclick={() => onSnapChange(true)}
					>
						Snap
					</button>
				</div>
			</div>
			<p class="mash-settings-hint">
				Snap only affects future drags — it does not clear overlaps. Hold Alt while dragging to
				temporarily invert. Use Organize to tidy the whole desk onto the grid.
			</p>
			<div class="mash-settings-actions">
				<button type="button" class="mash-settings-action" onclick={onOrganize}>
					Organize desk
				</button>
			</div>
		</section>

		<section class="mash-settings-section">
			<h2 class="mash-settings-heading">Data</h2>
			<p class="mash-settings-hint mash-settings-hint--lead">
				Everything stays in this browser. Sync is a file you move yourself — no cloud, no accounts.
			</p>
			<div class="mash-settings-sync-meta" data-testid="sync-hygiene">
				<div class="mash-settings-row">
					<span class="mash-settings-label">Last export</span>
					<span class="mash-settings-value" data-testid="sync-last-export">
						{lastExportAt != null ? formatNoteTimestamp(lastExportAt) : 'Never'}
					</span>
				</div>
				<div class="mash-settings-row">
					<span class="mash-settings-label">Last import</span>
					<span class="mash-settings-value" data-testid="sync-last-import">
						{lastImportAt != null ? formatNoteTimestamp(lastImportAt) : 'Never'}
					</span>
				</div>
				{#if backupHint}
					<p class="mash-settings-hint" data-testid="sync-backup-hint">{backupHint}</p>
				{/if}
				{#if conflictCount > 0 && onOpenConflicts}
					<button
						type="button"
						class="mash-settings-action"
						data-testid="open-sync-conflicts"
						onclick={onOpenConflicts}
					>
						Review {conflictCount} sync conflict{conflictCount === 1 ? '' : 's'}…
					</button>
				{/if}
			</div>
			<div class="mash-settings-actions">
				<button type="button" class="mash-settings-action" onclick={onImportMarkdown}>
					Import markdown vault…
				</button>
				{#if onOpenDocx}
					<button
						type="button"
						class="mash-settings-action"
						data-testid="settings-open-docx"
						onclick={onOpenDocx}
					>
						Open Word document…
					</button>
				{/if}
				{#if onOpenHtml}
					<button
						type="button"
						class="mash-settings-action"
						data-testid="settings-open-html"
						onclick={onOpenHtml}
					>
						Open HTML document…
					</button>
				{/if}
				{#if onOpenImage}
					<button
						type="button"
						class="mash-settings-action"
						data-testid="settings-open-image"
						onclick={onOpenImage}
					>
						Open image…
					</button>
				{/if}
				<button type="button" class="mash-settings-action" onclick={onImportJson}>
					Import notes from JSON…
				</button>
				<button type="button" class="mash-settings-action" onclick={onExportJson}>
					Export all as JSON
				</button>
				<button type="button" class="mash-settings-action" onclick={onImportSync}>
					Import sync bundle…
				</button>
				<button type="button" class="mash-settings-action" onclick={onExportSync}>
					Export sync bundle…
				</button>
			</div>
		</section>

		<section class="mash-settings-section">
			<h2 class="mash-settings-heading">Keyboard</h2>
			<ul class="mash-settings-shortcuts">
				{#each shortcuts as row (row.keys)}
					<li>
						<kbd>{row.keys}</kbd>
						<span>{row.label}</span>
					</li>
				{/each}
			</ul>
			{#if onOpenShortcuts}
				<div class="mash-settings-actions" style="margin-top: 10px;">
					<button
						type="button"
						class="mash-settings-action"
						onclick={() => {
							onClose();
							onOpenShortcuts();
						}}
					>
						View all shortcuts…
					</button>
				</div>
			{/if}
		</section>

		<section class="mash-settings-section mash-settings-section--last">
			<h2 class="mash-settings-heading">About</h2>
			<p class="mash-settings-about">
				<strong class="mash-display">Mash</strong> v0.1.0 — local-only notes PWA. MIT licensed. Install
				via your browser’s Add to Home Screen / Install app when offered.
			</p>
		</section>
	</div>
</aside>
