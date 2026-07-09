<script lang="ts">
	import { X, Moon, Sun } from 'lucide-svelte';
	import { theme } from '$lib/stores/theme.svelte';

	interface Props {
		snapEnabled: boolean;
		onClose: () => void;
		onSnapChange: (on: boolean) => void;
		onImportMarkdown: () => void;
		onImportJson: () => void;
		onExportJson: () => void;
		onImportSync: () => void;
		onExportSync: () => void;
	}

	let {
		snapEnabled,
		onClose,
		onSnapChange,
		onImportMarkdown,
		onImportJson,
		onExportJson,
		onImportSync,
		onExportSync
	}: Props = $props();

	const shortcuts = [
		{ keys: '⌘K', label: 'Command palette' },
		{ keys: '⌘N', label: 'New note' },
		{ keys: '/', label: 'Focus search' },
		{ keys: '⌘Z', label: 'Undo (typing in sticky, layout on board)' },
		{ keys: 'Esc', label: 'Dismiss overlay / selection' },
		{ keys: '?', label: 'Shortcut tip' }
	];
</script>

<aside class="mash-peel mash-settings" aria-label="Settings">
	<div class="mash-peel-header">
		<div class="min-w-0 flex-1">
			<div class="truncate text-xs font-semibold tracking-tight" style="color: var(--mash-ink);">
				Settings
			</div>
			<div class="text-[10px]" style="color: var(--mash-ink-muted);">Local preferences & data</div>
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
						<Sun class="h-3 w-3" strokeWidth={2} />
						Day
					</button>
					<button
						type="button"
						class="mash-settings-seg-btn"
						class:is-active={theme.mode === 'dark'}
						onclick={() => theme.setMode('dark')}
					>
						<Moon class="h-3 w-3" strokeWidth={2} />
						Night
					</button>
				</div>
			</div>
			<p class="mash-settings-hint">Stickies and chrome both follow day / night.</p>
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
			<p class="mash-settings-hint">Hold Alt while dragging to temporarily invert snap.</p>
		</section>

		<section class="mash-settings-section">
			<h2 class="mash-settings-heading">Data</h2>
			<p class="mash-settings-hint mash-settings-hint--lead">
				Everything stays in this browser. Sync is a file you move yourself — no cloud, no accounts.
			</p>
			<div class="mash-settings-actions">
				<button type="button" class="mash-settings-action" onclick={onImportMarkdown}>
					Import markdown vault…
				</button>
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
		</section>

		<section class="mash-settings-section mash-settings-section--last">
			<h2 class="mash-settings-heading">About</h2>
			<p class="mash-settings-about">
				<strong class="mash-display">Mash</strong> v0.1.0 — local-only notes PWA. MIT licensed.
				Install via your browser’s Add to Home Screen / Install app when offered.
			</p>
		</section>
	</div>
</aside>
