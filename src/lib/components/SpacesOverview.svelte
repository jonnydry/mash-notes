<script lang="ts">
	import { focusTrap } from '$lib/focus-trap';
	import { untrack } from 'svelte';
	import { X } from '@lucide/svelte';
	import { getCanvasItems, getOrCreateFolderCanvas } from '$lib/db';
	import type { CanvasItem } from '$lib/types';
	import { COLLAPSED_CARD } from '$lib/stores/canvas-session.svelte';
	import { DESK_SPACE_KEY, spaceTitleForKey } from '$lib/stores/spaces.svelte';

	export type SpacePreviewRect = {
		x: number;
		y: number;
		w: number;
		h: number;
	};

	interface Props {
		sessionId?: string;
		openKeys: string[];
		activeKey: string;
		/** Live items for the active canvas (avoids a redundant fetch). */
		activeItems: CanvasItem[];
		onClose: () => void;
		onSwitch: (key: string) => void;
		onCloseSpace: (key: string) => void;
	}

	let { sessionId, openKeys, activeKey, activeItems, onClose, onSwitch, onCloseSpace }: Props =
		$props();

	let previews = $state<Record<string, SpacePreviewRect[]>>({});
	let loading = $state(false);

	function rectsFromItems(items: CanvasItem[]): SpacePreviewRect[] {
		return items.map((item) => ({
			x: item.x,
			y: item.y,
			w: item.w ?? COLLAPSED_CARD.w,
			h: item.h ?? COLLAPSED_CARD.h
		}));
	}

	function previewBounds(rects: SpacePreviewRect[]) {
		if (rects.length === 0) {
			return { minX: 0, minY: 0, width: 400, height: 240 };
		}
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		for (const r of rects) {
			minX = Math.min(minX, r.x);
			minY = Math.min(minY, r.y);
			maxX = Math.max(maxX, r.x + r.w);
			maxY = Math.max(maxY, r.y + r.h);
		}
		const pad = 24;
		return {
			minX: minX - pad,
			minY: minY - pad,
			width: Math.max(120, maxX - minX + pad * 2),
			height: Math.max(80, maxY - minY + pad * 2)
		};
	}

	async function loadPreviews() {
		const keys = untrack(() => [...openKeys]);
		const current = untrack(() => activeKey);
		const items = untrack(() => activeItems);
		loading = true;
		const next: Record<string, SpacePreviewRect[]> = { [current]: rectsFromItems(items) };
		try {
			await Promise.all(
				keys
					.filter((key) => key !== current)
					.map(async (key) => {
						try {
							const canvas = await getOrCreateFolderCanvas(key, sessionId);
							const canvasItems = await getCanvasItems(canvas.id);
							next[key] = rectsFromItems(canvasItems);
						} catch {
							next[key] = [];
						}
					})
			);
			previews = next;
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		void loadPreviews();
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

<div
	class="mash-dialog-backdrop mash-spaces-backdrop"
	role="presentation"
	onclick={(e) => {
		if (e.target === e.currentTarget) onClose();
	}}
>
	<div
		use:focusTrap={{ initialFocus: '[data-dialog-initial-focus]' }}
		class="mash-dialog-panel mash-spaces-dialog"
		role="dialog"
		aria-modal="true"
		aria-labelledby="mash-spaces-title"
	>
		<div class="mash-spaces-header">
			<div class="min-w-0 flex-1">
				<div class="flex items-center gap-2.5">
					<img
						src="/icons/mash-screenplay-mascot.png"
						alt=""
						width="44"
						height="44"
						class="mash-spaces-header-mascot"
						draggable="false"
					/>
					<div class="min-w-0">
						<h2
							id="mash-spaces-title"
							class="mash-display text-base font-semibold tracking-tight"
							style="color: var(--mash-ink);"
						>
							Open desks
						</h2>
						<p class="mash-dialog-subtitle">
							Screenplay — open folder boards; click to switch
							{#if loading}
								<span class="opacity-60"> · loading…</span>
							{/if}
						</p>
					</div>
				</div>
			</div>
			<button
				data-dialog-initial-focus
				type="button"
				class="mash-peel-icon-btn"
				onclick={onClose}
				aria-label="Close open desks"
			>
				<X class="h-3.5 w-3.5" strokeWidth={2} />
			</button>
		</div>

		<div class="mash-spaces-grid" role="list">
			{#each openKeys as key (key === '' ? '__desk__' : key)}
				{@const rects = previews[key] ?? []}
				{@const bounds = previewBounds(rects)}
				{@const isActive = key === activeKey}
				{@const title = spaceTitleForKey(key)}
				{@const canClose = key !== DESK_SPACE_KEY}
				<div class="mash-spaces-card-wrap" role="listitem">
					<button
						type="button"
						class="mash-spaces-card"
						class:is-active={isActive}
						aria-current={isActive ? 'true' : undefined}
						aria-label={`Switch to ${title}`}
						onclick={() => onSwitch(key)}
					>
						<div class="mash-spaces-preview" aria-hidden="true">
							<svg
								viewBox="{bounds.minX} {bounds.minY} {bounds.width} {bounds.height}"
								preserveAspectRatio="xMidYMid meet"
								class="mash-spaces-preview-svg"
							>
								{#each rects as r, i (i)}
									<rect
										x={r.x}
										y={r.y}
										width={r.w}
										height={r.h}
										rx="10"
										ry="10"
										class="mash-spaces-sil"
									/>
								{/each}
								{#if rects.length === 0}
									<text
										x={bounds.minX + bounds.width / 2}
										y={bounds.minY + bounds.height / 2}
										text-anchor="middle"
										dominant-baseline="middle"
										class="mash-spaces-empty-label"
									>
										Empty
									</text>
								{/if}
							</svg>
						</div>
						<div class="mash-spaces-card-meta">
							<span class="mash-spaces-card-title mash-display">{title}</span>
							<span class="mash-spaces-card-count"
								>{rects.length} note{rects.length === 1 ? '' : 's'}</span
							>
						</div>
					</button>
					{#if canClose}
						<button
							type="button"
							class="mash-spaces-close"
							aria-label={`Close ${title} board`}
							onclick={(e) => {
								e.stopPropagation();
								e.preventDefault();
								onCloseSpace(key);
							}}
						>
							<X class="h-3 w-3" strokeWidth={2.5} />
						</button>
					{/if}
				</div>
			{/each}
		</div>
	</div>
</div>
