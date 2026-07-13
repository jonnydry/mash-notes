<script lang="ts">
	/**
	 * Folder path field with an anchored suggest menu.
	 * Portals the list into document body so it isn’t clipped by pane overflow
	 * or mis-scaled under the canvas transform (native datalist fails both).
	 */
	import { Folder } from 'lucide-svelte';
	import { fly } from 'svelte/transition';
	import { portal } from '$lib/portal';
	import {
		computeSuggestMenuPos,
		suggestMenuStyle,
		trackSuggestAnchor,
		type SuggestMenuPos
	} from '$lib/suggest-menu';

	interface Props {
		value: string;
		folders: string[];
		placeholder?: string;
		title?: string;
		class?: string;
		onChange: (folder: string) => void;
	}

	let {
		value,
		folders,
		placeholder = 'Folder path…',
		title = 'Type a folder path, or pick an existing one',
		class: className = '',
		onChange
	}: Props = $props();

	const listId = `mash-folder-suggest-${Math.random().toString(36).slice(2, 9)}`;

	let open = $state(false);
	// svelte-ignore state_referenced_locally -- the effect below resyncs external changes while closed
	let query = $state(value);
	let highlight = $state(-1);
	let controlEl: HTMLDivElement | undefined = $state();
	let menuPos = $state<SuggestMenuPos | null>(null);

	$effect(() => {
		if (!open) query = value;
	});

	function suggestions(q: string, current: string): string[] {
		const trimmed = q.trim().toLowerCase();
		if (!trimmed) {
			return folders.filter((f) => f !== current).slice(0, 8);
		}
		return folders
			.filter((f) => {
				const fl = f.toLowerCase();
				if (fl === trimmed) return false;
				return fl.includes(trimmed);
			})
			.slice(0, 8);
	}

	let hits = $derived(suggestions(query, value));
	/** Clear row + folder hits when the menu is open. */
	let options = $derived(value ? ['', ...hits] : hits);
	let showMenu = $derived(open && options.length > 0);
	let menuStyle = $derived(menuPos ? suggestMenuStyle(menuPos) : '');
	let flyY = $derived(menuPos?.placement === 'above' ? 6 : -6);

	$effect(() => {
		if (!showMenu) {
			menuPos = null;
			return;
		}
		return trackSuggestAnchor(() => controlEl, (pos) => (menuPos = pos), {
			gap: 6,
			maxH: 200,
			minWidth: 160
		});
	});

	function openMenu(fromValue: string) {
		query = fromValue;
		open = true;
		highlight = -1;
		if (controlEl) {
			menuPos = computeSuggestMenuPos(controlEl.getBoundingClientRect(), {
				gap: 6,
				maxH: 200,
				minWidth: 160
			});
		}
	}

	function pick(folder: string) {
		onChange(folder);
		query = folder;
		open = false;
		highlight = -1;
	}

	function onInput(e: Event) {
		const next = (e.currentTarget as HTMLInputElement).value;
		query = next;
		open = true;
		highlight = -1;
		onChange(next);
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.stopPropagation();
			open = false;
			highlight = -1;
			(e.currentTarget as HTMLInputElement).blur();
			return;
		}
		if (!showMenu) {
			if (e.key === 'Enter') open = false;
			return;
		}
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			highlight = highlight < 0 ? 0 : Math.min(highlight + 1, options.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			highlight = highlight < 0 ? options.length - 1 : Math.max(highlight - 1, 0);
		} else if (e.key === 'Enter') {
			if (highlight >= 0 && highlight < options.length) {
				e.preventDefault();
				pick(options[highlight]);
			} else if (hits.length === 1) {
				e.preventDefault();
				pick(hits[0]);
			} else {
				open = false;
			}
		}
	}
</script>

<div class="mash-folder-field {className}">
	<Folder class="mash-folder-field-icon" aria-hidden="true" />
	<div class="mash-folder-field-control" bind:this={controlEl}>
		<input
			type="text"
			{value}
			{placeholder}
			{title}
			autocomplete="off"
			class="mash-focus mash-folder-field-input"
			role="combobox"
			aria-expanded={showMenu}
			aria-autocomplete="list"
			aria-controls={showMenu ? listId : undefined}
			aria-activedescendant={highlight >= 0 ? `${listId}-opt-${highlight}` : undefined}
			onfocus={() => openMenu(value)}
			oninput={onInput}
			onkeydown={onKeydown}
			onblur={() => {
				setTimeout(() => {
					open = false;
					highlight = -1;
				}, 140);
			}}
		/>
	</div>
</div>

{#if showMenu && menuPos}
	<ul
		use:portal
		id={listId}
		class="mash-folder-suggest"
		class:is-above={menuPos.placement === 'above'}
		style={menuStyle}
		role="listbox"
		aria-label="Existing folders"
		in:fly={{ y: flyY, duration: 160, opacity: 0 }}
		out:fly={{ y: flyY * 0.5, duration: 110, opacity: 0 }}
		onwheel={(e) => e.stopPropagation()}
	>
		{#each options as folder, i (folder === '' ? '__clear__' : folder)}
			<li role="presentation">
				<button
					type="button"
					id={`${listId}-opt-${i}`}
					role="option"
					aria-selected={highlight === i}
					class="mash-folder-suggest-option"
					class:is-muted={folder === ''}
					class:is-active={highlight === i}
					onmousedown={(e) => {
						e.preventDefault();
						pick(folder);
					}}
					onmouseenter={() => (highlight = i)}
				>
					{folder === '' ? 'Clear folder' : folder}
				</button>
			</li>
		{/each}
	</ul>
{/if}
