<script lang="ts">
	import { X } from 'lucide-svelte';
	import {
		KEYBOARD_SHORTCUT_GROUPS,
		type ShortcutGroup
	} from '$lib/keyboard-shortcuts';

	interface Props {
		open: boolean;
		onClose: () => void;
		groups?: ShortcutGroup[];
	}

	let { open, onClose, groups = KEYBOARD_SHORTCUT_GROUPS }: Props = $props();

	let closeBtn: HTMLButtonElement | undefined = $state();

	$effect(() => {
		if (!open) return;
		requestAnimationFrame(() => closeBtn?.focus());
		function onKey(e: KeyboardEvent) {
			if (e.key === 'Escape') {
				e.preventDefault();
				e.stopImmediatePropagation();
				onClose();
			}
		}
		window.addEventListener('keydown', onKey, true);
		return () => window.removeEventListener('keydown', onKey, true);
	});
</script>

{#if open}
	<div
		class="mash-shortcuts-backdrop"
		role="presentation"
		onclick={(e) => {
			if (e.target === e.currentTarget) onClose();
		}}
	>
		<div
			class="mash-shortcuts-dialog"
			role="dialog"
			aria-modal="true"
			aria-labelledby="mash-shortcuts-title"
		>
			<div class="mash-shortcuts-header">
				<div class="min-w-0 flex-1">
					<h2
						id="mash-shortcuts-title"
						class="mash-display text-base font-semibold tracking-tight"
						style="color: var(--mash-ink);"
					>
						Keyboard shortcuts
					</h2>
					<p class="mt-0.5 text-[11px]" style="color: var(--mash-ink-muted);">
						⌘ is Ctrl on Windows and Linux
					</p>
				</div>
				<button
					bind:this={closeBtn}
					type="button"
					class="mash-peel-icon-btn"
					onclick={onClose}
					aria-label="Close shortcuts"
				>
					<X class="h-3.5 w-3.5" strokeWidth={2} />
				</button>
			</div>

			<div class="mash-shortcuts-body">
				{#each groups as group (group.id)}
					<section class="mash-shortcuts-group">
						<h3 class="mash-shortcuts-group-title">{group.title}</h3>
						<ul class="mash-shortcuts-list">
							{#each group.rows as row (row.keys + row.label)}
								<li>
									<span class="mash-shortcuts-label">{row.label}</span>
									<span class="mash-shortcuts-keys">
										{#each row.keys.split(' / ') as chord, i (chord + i)}
											{#if i > 0}
												<span class="mash-shortcuts-or">or</span>
											{/if}
											{#each chord.split(' + ') as part, j (part + j)}
												{#if j > 0}
													<span class="mash-shortcuts-plus">+</span>
												{/if}
												<kbd>{part}</kbd>
											{/each}
										{/each}
									</span>
								</li>
							{/each}
						</ul>
					</section>
				{/each}
			</div>
		</div>
	</div>
{/if}
