<script lang="ts">
	import { onMount, tick } from 'svelte';
	import {
		LayoutGrid,
		Pin,
		Folder,
		Hash,
		Link2,
		Plus,
		Search,
		Settings,
		MoreHorizontal,
		Clock3
	} from 'lucide-svelte';
	import type { NavFilter } from '$lib/note-ui';
	import { isNavActive } from '$lib/note-ui';
	import type { DockAction } from '$lib/dock';

	interface Props {
		currentFilter: NavFilter;
		foldersOpen?: boolean;
		tagsOpen?: boolean;
		linkedOpen?: boolean;
		settingsOpen?: boolean;
		/** Callback for dock button presses (avoid `on*` — Svelte 5 treats those as events). */
		dockSelect: (action: DockAction) => void;
		openDesks?: () => void;
	}

	let {
		currentFilter,
		foldersOpen = false,
		tagsOpen = false,
		linkedOpen = false,
		settingsOpen = false,
		dockSelect,
		openDesks
	}: Props = $props();

	type DockItem = {
		id: DockAction;
		label: string;
		accent?: boolean;
		active: boolean;
	};

	let activeDockItem = $derived.by((): DockAction => {
		if (settingsOpen) return 'settings';
		if (linkedOpen) return 'linked';
		if (tagsOpen) return 'tags';
		if (foldersOpen) return 'folders';
		if (isNavActive(currentFilter, 'pinned')) return 'pinned';
		if (currentFilter.type === 'folder') return 'folders';
		if (currentFilter.type === 'tag') return 'tags';
		return 'all';
	});

	let items = $derived<DockItem[]>([
		{
			id: 'all',
			label: 'Desk',
			active: activeDockItem === 'all'
		},
		{
			id: 'pinned',
			label: 'Pinned',
			active: activeDockItem === 'pinned'
		},
		{
			id: 'folders',
			label: 'Folders',
			active: activeDockItem === 'folders'
		},
		{
			id: 'tags',
			label: 'Tags',
			active: activeDockItem === 'tags'
		},
		{
			id: 'linked',
			label: 'Linked',
			active: activeDockItem === 'linked'
		},
		{ id: 'new', label: 'New note', accent: true, active: false },
		{ id: 'search', label: 'Search', active: false },
		{ id: 'settings', label: 'Settings', active: activeDockItem === 'settings' }
	]);

	let dockEl: HTMLElement | undefined = $state();
	let magRaf = 0;
	let confirmTimer = 0;
	let mobileMoreOpen = $state(false);

	const MAG_RADIUS = 76;
	const MAG_PEAK = 0.12;
	const ICON_SIZE = 44; // must match .mash-side-dock-item width/height

	function iconFor(id: DockAction) {
		switch (id) {
			case 'all':
				return LayoutGrid;
			case 'pinned':
				return Pin;
			case 'folders':
				return Folder;
			case 'tags':
				return Hash;
			case 'linked':
				return Link2;
			case 'new':
				return Plus;
			case 'search':
				return Search;
			case 'settings':
				return Settings;
			default: {
				const _exhaustive: never = id;
				return _exhaustive;
			}
		}
	}

	function falloff(dist: number): number {
		const t = Math.max(0, 1 - dist / MAG_RADIUS);
		const bulge = Math.cos((1 - t) * (Math.PI / 2));
		return bulge * bulge;
	}

	/**
	 * macOS-style: glass stays fixed. Icons scale with transform only and
	 * overflow out of the pill. Distances use layout centers (not live
	 * scaled rects) so the curve doesn't chase itself and jitter.
	 */
	function prefersReducedMotion(): boolean {
		return (
			typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
		);
	}

	function applyMag(clientX: number | null, clientY: number | null) {
		if (!dockEl) return;
		if (prefersReducedMotion()) {
			const buttons = [...dockEl.querySelectorAll<HTMLElement>('[data-dock-item]')];
			for (const btn of buttons) {
				btn.style.setProperty('--dock-scale', '1');
				btn.classList.remove('is-hot');
			}
			dockEl.classList.remove('is-magnifying');
			return;
		}
		const dockRect = dockEl.getBoundingClientRect();
		const horizontal = dockRect.width > dockRect.height;
		const buttons = [...dockEl.querySelectorAll<HTMLElement>('[data-dock-item]')];
		let nearest: { id: string; dist: number } | null = null;
		const pointer = horizontal ? clientX : clientY;

		for (const btn of buttons) {
			// Layout center — stable while transforms change.
			const center = horizontal
				? dockRect.left + btn.offsetLeft + ICON_SIZE / 2
				: dockRect.top + btn.offsetTop + ICON_SIZE / 2;

			if (pointer === null) {
				btn.style.setProperty('--dock-scale', '1');
				btn.classList.remove('is-hot');
				continue;
			}

			const dist = Math.abs(pointer - center);
			const scale = 1 + falloff(dist) * MAG_PEAK;
			btn.style.setProperty('--dock-scale', String(scale));
			if (!nearest || dist < nearest.dist) {
				nearest = { id: btn.dataset.dockItem ?? '', dist };
			}
		}

		const nextHot =
			pointer !== null && nearest && nearest.dist < MAG_RADIUS * 0.85 ? nearest.id : null;
		for (const btn of buttons) {
			btn.classList.toggle('is-hot', btn.dataset.dockItem === nextHot);
		}
		dockEl.classList.toggle('is-magnifying', nextHot !== null);
	}

	function onPointerMove(e: PointerEvent) {
		if (!dockEl || prefersReducedMotion()) return;
		const { clientX, clientY } = e;
		if (magRaf) cancelAnimationFrame(magRaf);
		magRaf = requestAnimationFrame(() => {
			magRaf = 0;
			applyMag(clientX, clientY);
		});
	}

	function onPointerLeave() {
		if (magRaf) cancelAnimationFrame(magRaf);
		magRaf = 0;
		applyMag(null, null);
	}

	function syncActivePlate() {
		if (!dockEl) return;
		const activeButton = [
			...dockEl.querySelectorAll<HTMLElement>('.mash-side-dock-item.is-active')
		].find((button) => button.getClientRects().length > 0);
		if (!activeButton) {
			dockEl.classList.remove('has-active-item');
			return;
		}

		dockEl.style.setProperty('--dock-active-x', `${activeButton.offsetLeft}px`);
		dockEl.style.setProperty('--dock-active-y', `${activeButton.offsetTop}px`);
		dockEl.classList.add('has-active-item');
	}

	function confirmNewNote() {
		if (!dockEl || prefersReducedMotion()) return;
		const button = dockEl.querySelector<HTMLElement>('[data-dock-item="new"]');
		if (!button) return;
		button.classList.remove('is-confirming');
		void button.offsetWidth;
		button.classList.add('is-confirming');
		if (confirmTimer) window.clearTimeout(confirmTimer);
		confirmTimer = window.setTimeout(() => {
			button.classList.remove('is-confirming');
			confirmTimer = 0;
		}, 240);
	}

	function choose(action: DockAction) {
		mobileMoreOpen = false;
		if (action === 'new') confirmNewNote();
		dockSelect(action);
	}

	$effect(() => {
		const activeKey = items.map((item) => `${item.id}:${item.active}`).join('|');
		const moreOpen = mobileMoreOpen;
		void activeKey;
		void moreOpen;
		if (!dockEl) return;
		let frame = 0;
		let cancelled = false;
		void tick().then(() => {
			if (!cancelled) frame = window.requestAnimationFrame(syncActivePlate);
		});
		return () => {
			cancelled = true;
			window.cancelAnimationFrame(frame);
		};
	});

	onMount(() => {
		if (!dockEl) return;
		const observer = new ResizeObserver(syncActivePlate);
		observer.observe(dockEl);
		void document.fonts?.ready.then(syncActivePlate);
		syncActivePlate();
		return () => {
			observer.disconnect();
			if (confirmTimer) window.clearTimeout(confirmTimer);
		};
	});

	$effect(() => {
		if (!mobileMoreOpen) return;
		function onKey(e: KeyboardEvent) {
			if (e.key === 'Escape') {
				e.preventDefault();
				mobileMoreOpen = false;
			}
		}
		function onPointerDown(e: PointerEvent) {
			const t = e.target as Node | null;
			if (!t) return;
			const menu = document.querySelector('.mash-dock-more-menu');
			const moreBtn = document.querySelector('.mash-dock-more');
			if (menu?.contains(t) || moreBtn?.contains(t)) return;
			mobileMoreOpen = false;
		}
		window.addEventListener('keydown', onKey, true);
		window.addEventListener('pointerdown', onPointerDown, true);
		return () => {
			window.removeEventListener('keydown', onKey, true);
			window.removeEventListener('pointerdown', onPointerDown, true);
		};
	});
</script>

<nav
	bind:this={dockEl}
	class="mash-side-dock"
	aria-label="Mash dock"
	onpointermove={onPointerMove}
	onpointerleave={onPointerLeave}
>
	<span class="mash-side-dock-active-plate" aria-hidden="true"></span>
	{#each items as item (item.id)}
		{#if item.id === 'new'}
			<div class="mash-side-dock-spacer" aria-hidden="true"></div>
		{/if}
		{@const Icon = iconFor(item.id)}
		<button
			type="button"
			data-dock-item={item.id}
			class="mash-side-dock-item"
			class:mash-dock-secondary={!['all', 'new', 'search'].includes(item.id)}
			class:is-accent={item.accent}
			class:is-active={item.active}
			title={item.label}
			aria-label={item.label}
			aria-pressed={item.active}
			onclick={() => choose(item.id)}
		>
			<span class="mash-side-dock-icon" aria-hidden="true">
				<Icon class="h-[18px] w-[18px]" strokeWidth={2} />
			</span>
			<span class="mash-side-dock-label">{item.label}</span>
		</button>
	{/each}
	<button
		type="button"
		class="mash-side-dock-item mash-dock-more"
		class:is-active={mobileMoreOpen || items.some((item) => item.active && item.id !== 'all')}
		aria-label="More navigation"
		aria-haspopup="menu"
		aria-expanded={mobileMoreOpen}
		title="More"
		onclick={() => (mobileMoreOpen = !mobileMoreOpen)}
	>
		<span class="mash-side-dock-icon" aria-hidden="true">
			<MoreHorizontal class="h-[20px] w-[20px]" strokeWidth={2} />
		</span>
	</button>
	{#if mobileMoreOpen}
		<div class="mash-dock-more-menu" role="menu" aria-label="More navigation">
			{#if openDesks}
				<button
					type="button"
					role="menuitem"
					onclick={() => {
						mobileMoreOpen = false;
						openDesks();
					}}
				>
					<Clock3 size={18} strokeWidth={2} aria-hidden="true" />
					<span>Desks</span>
				</button>
			{/if}
			{#each items.filter((item) => !['all', 'new', 'search'].includes(item.id)) as item (item.id)}
				{@const MenuIcon = iconFor(item.id)}
				<button
					type="button"
					role="menuitem"
					class:is-active={item.active}
					onclick={() => choose(item.id)}
				>
					<MenuIcon size={18} strokeWidth={2} aria-hidden="true" />
					<span>{item.label}</span>
				</button>
			{/each}
		</div>
	{/if}
</nav>
