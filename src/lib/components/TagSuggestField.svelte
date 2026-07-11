<script lang="ts">
	/**
	 * Tag field with suggest menu of existing library tags.
	 * Focus always offers unused existing tags (even when the note already has some).
	 * New tags are committed via the + action at the top of the menu.
	 */
	import { Plus, Tag } from 'lucide-svelte';
	import { fly } from 'svelte/transition';
	import { portal } from '$lib/portal';
	import {
		computeSuggestMenuPos,
		suggestMenuStyle,
		trackSuggestAnchor,
		type SuggestMenuPos
	} from '$lib/suggest-menu';

	interface Props {
		value: string[];
		tags: string[];
		placeholder?: string;
		title?: string;
		class?: string;
		onChange: (tags: string[]) => void;
	}

	let {
		value,
		tags,
		placeholder = 'tags',
		title = 'Pick an existing tag, or type a new one and press +',
		class: className = '',
		onChange
	}: Props = $props();

	const listId = `mash-tag-suggest-${Math.random().toString(36).slice(2, 9)}`;

	let open = $state(false);
	let draft = $state(formatDraft(value));
	let highlight = $state(-1);
	let controlEl: HTMLDivElement | undefined = $state();
	let inputEl: HTMLInputElement | undefined = $state();
	let menuPos = $state<SuggestMenuPos | null>(null);

	function formatDraft(tagsOnNote: string[], forEditing = false): string {
		if (tagsOnNote.length === 0) return '';
		const joined = tagsOnNote.join(', ');
		// Trailing separator keeps the current token empty so existing tags stay pickable.
		return forEditing ? `${joined}, ` : joined;
	}

	$effect(() => {
		if (!open) draft = formatDraft(value);
	});

	function parseTags(raw: string): string[] {
		return raw
			.split(',')
			.map((t) => t.trim())
			.filter(Boolean);
	}

	/** Text before the incomplete token + the token currently being typed. */
	function tokenParts(raw: string): { prefix: string; token: string } {
		const lastComma = raw.lastIndexOf(',');
		if (lastComma < 0) return { prefix: '', token: raw };
		return {
			prefix: raw.slice(0, lastComma + 1),
			token: raw.slice(lastComma + 1).replace(/^\s+/, '')
		};
	}

	function ownedSet(raw: string, current: string[]): Set<string> {
		const have = new Set(current.map((t) => t.toLowerCase()));
		for (const t of parseTags(tokenParts(raw).prefix)) have.add(t.toLowerCase());
		return have;
	}

	function suggestions(raw: string, current: string[]): string[] {
		const { token } = tokenParts(raw);
		const have = ownedSet(raw, current);
		const q = token.trim().toLowerCase();
		const pool = tags.filter((t) => !have.has(t.toLowerCase()));
		if (!q) return pool.slice(0, 10);
		return pool.filter((t) => t.toLowerCase().includes(q)).slice(0, 10);
	}

	let token = $derived(tokenParts(draft).token.trim());
	let hits = $derived(suggestions(draft, value));
	let canCreate = $derived.by(() => {
		if (!token) return false;
		const lower = token.toLowerCase();
		if (ownedSet(draft, value).has(lower)) return false;
		if (tags.some((t) => t.toLowerCase() === lower)) return false;
		return true;
	});
	let showClear = $derived(value.length > 0 && !token);
	let listOptions = $derived(showClear ? [...hits, ''] : hits);
	let showMenu = $derived(open);
	let menuStyle = $derived(menuPos ? suggestMenuStyle(menuPos) : '');
	let flyY = $derived(menuPos?.placement === 'above' ? 6 : -6);

	$effect(() => {
		if (!showMenu) {
			menuPos = null;
			return;
		}
		return trackSuggestAnchor(() => controlEl, (pos) => (menuPos = pos), {
			gap: 6,
			maxH: 220,
			minWidth: 168
		});
	});

	function placeCaretAtEnd() {
		if (!inputEl) return;
		const len = inputEl.value.length;
		inputEl.setSelectionRange(len, len);
	}

	function openMenu() {
		draft = formatDraft(value, true);
		open = true;
		highlight = -1;
		if (controlEl) {
			menuPos = computeSuggestMenuPos(controlEl.getBoundingClientRect(), {
				gap: 6,
				maxH: 220,
				minWidth: 168
			});
		}
		requestAnimationFrame(() => placeCaretAtEnd());
	}

	function commitTags(next: string[]) {
		const deduped = [...new Set(next.map((t) => t.trim()).filter(Boolean))];
		onChange(deduped);
		draft = formatDraft(deduped, true);
		highlight = -1;
		open = true;
		requestAnimationFrame(() => {
			inputEl?.focus();
			placeCaretAtEnd();
		});
	}

	function pickExisting(tag: string) {
		if (tag === '') {
			onChange([]);
			draft = '';
			highlight = -1;
			open = true;
			requestAnimationFrame(() => inputEl?.focus());
			return;
		}
		const { prefix } = tokenParts(draft);
		commitTags([...parseTags(prefix), tag]);
	}

	function createNew() {
		if (!canCreate) return;
		const { prefix } = tokenParts(draft);
		commitTags([...parseTags(prefix), token]);
	}

	function onInput(e: Event) {
		const next = (e.currentTarget as HTMLInputElement).value;
		draft = next;
		open = true;
		highlight = -1;
		if (!next.trim()) {
			onChange([]);
		} else {
			onChange(parseTags(tokenParts(next).prefix));
		}
	}

	function navCount(): number {
		return (canCreate ? 1 : 0) + listOptions.length;
	}

	function activateNav(index: number) {
		const createOffset = canCreate ? 1 : 0;
		if (canCreate && index === 0) {
			createNew();
			return;
		}
		const listIndex = index - createOffset;
		if (listIndex >= 0 && listIndex < listOptions.length) {
			pickExisting(listOptions[listIndex]);
		}
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.stopPropagation();
			open = false;
			highlight = -1;
			(e.currentTarget as HTMLInputElement).blur();
			return;
		}
		const count = navCount();
		if (e.key === 'ArrowDown') {
			if (!open) open = true;
			e.preventDefault();
			highlight = highlight < 0 ? 0 : Math.min(highlight + 1, Math.max(count - 1, 0));
			return;
		}
		if (e.key === 'ArrowUp') {
			if (!open) open = true;
			e.preventDefault();
			highlight = highlight < 0 ? Math.max(count - 1, 0) : Math.max(highlight - 1, 0);
			return;
		}
		if (e.key === 'Enter') {
			if (highlight >= 0 && highlight < count) {
				e.preventDefault();
				activateNav(highlight);
			} else if (canCreate) {
				e.preventDefault();
				createNew();
			} else if (hits.length === 1) {
				e.preventDefault();
				pickExisting(hits[0]);
			} else {
				open = false;
			}
		}
	}
</script>

<div class="mash-folder-field mash-tag-field {className}">
	<Tag class="mash-folder-field-icon" aria-hidden="true" />
	<div class="mash-folder-field-control" bind:this={controlEl}>
		<input
			bind:this={inputEl}
			type="text"
			value={draft}
			{placeholder}
			{title}
			autocomplete="off"
			class="mash-focus mash-folder-field-input"
			role="combobox"
			aria-expanded={showMenu}
			aria-autocomplete="list"
			aria-controls={showMenu ? listId : undefined}
			aria-activedescendant={highlight >= 0 ? `${listId}-opt-${highlight}` : undefined}
			onfocus={openMenu}
			oninput={onInput}
			onkeydown={onKeydown}
			onblur={() => {
				setTimeout(() => {
					open = false;
					highlight = -1;
					draft = formatDraft(value);
				}, 140);
			}}
		/>
	</div>
</div>

{#if showMenu && menuPos}
	<div
		use:portal
		id={listId}
		class="mash-folder-suggest mash-tag-suggest"
		class:is-above={menuPos.placement === 'above'}
		style={menuStyle}
		role="listbox"
		aria-label="Tags"
		in:fly={{ y: flyY, duration: 160, opacity: 0 }}
		out:fly={{ y: flyY * 0.5, duration: 110, opacity: 0 }}
		onwheel={(e) => e.stopPropagation()}
	>
		<div class="mash-tag-suggest-create-row" role="presentation">
			<button
				type="button"
				id={canCreate ? `${listId}-opt-0` : `${listId}-create`}
				role="option"
				aria-selected={canCreate && highlight === 0}
				aria-disabled={!canCreate}
				disabled={!canCreate}
				class="mash-tag-suggest-create"
				class:is-ready={canCreate}
				class:is-active={canCreate && highlight === 0}
				title={canCreate ? `Add new tag #${token}` : 'Type a new tag name, then press +'}
				onmousedown={(e) => {
					e.preventDefault();
					createNew();
				}}
				onmouseenter={() => {
					if (canCreate) highlight = 0;
				}}
			>
				<span class="mash-tag-suggest-create-plus" aria-hidden="true">
					<Plus class="mash-tag-suggest-create-icon" />
				</span>
				{#if canCreate}
					<span class="mash-tag-suggest-create-label">Add <strong>#{token}</strong></span>
				{:else}
					<span class="mash-tag-suggest-create-label is-muted">New tag</span>
				{/if}
			</button>
		</div>

		{#if listOptions.length > 0}
			<ul class="mash-tag-suggest-list">
				{#each listOptions as tag, i (tag === '' ? '__clear__' : tag)}
					{@const navIndex = (canCreate ? 1 : 0) + i}
					<li role="presentation">
						<button
							type="button"
							id={`${listId}-opt-${navIndex}`}
							role="option"
							aria-selected={highlight === navIndex}
							class="mash-folder-suggest-option"
							class:is-muted={tag === ''}
							class:is-active={highlight === navIndex}
							onmousedown={(e) => {
								e.preventDefault();
								pickExisting(tag);
							}}
							onmouseenter={() => (highlight = navIndex)}
						>
							{tag === '' ? 'Clear tags' : `#${tag}`}
						</button>
					</li>
				{/each}
			</ul>
		{:else if !canCreate}
			<div class="mash-tag-suggest-empty">No other tags yet — type a name and hit +</div>
		{/if}
	</div>
{/if}
