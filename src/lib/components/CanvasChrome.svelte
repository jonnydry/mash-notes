<script lang="ts">
	/**
	 * Board chrome: desktop Free/Snap · Sequence · Fit · Undo · View,
	 * mobile Fit/Organize/More tools, and pan/zoom pad.
	 */
	import { MoreHorizontal } from 'lucide-svelte';

	interface Props {
		snapEnabled: boolean;
		flowMode: boolean;
		flowConnecting: boolean;
		flowFromItemId: string | null;
		scale: number;
		altHeld: boolean;
		itemCount: number;
		selectedCount: number;
		allBoardNotesSelected: boolean;
		canUndo: boolean;
		canRedo: boolean;
		desktopViewOpen: boolean;
		mobileToolsOpen: boolean;
		onOpenShortcuts?: () => void;
		toggleSnap: () => void;
		toggleFlowMode: () => void;
		zoomToFit: (selectionOnly?: boolean) => void;
		organizeToSnap: () => void;
		toggleSelectAllOnBoard: () => void;
		resetView: () => void;
		zoomFromCenter: (factor: number) => void;
		panBy: (dx: number, dy: number) => void;
		onUndo?: () => void;
		onRedo?: () => void;
	}

	let {
		snapEnabled,
		flowMode,
		flowConnecting,
		flowFromItemId,
		scale,
		altHeld,
		itemCount,
		selectedCount,
		allBoardNotesSelected,
		canUndo,
		canRedo,
		desktopViewOpen = $bindable(false),
		mobileToolsOpen = $bindable(false),
		onOpenShortcuts,
		toggleSnap,
		toggleFlowMode,
		zoomToFit,
		organizeToSnap,
		toggleSelectAllOnBoard,
		resetView,
		zoomFromCenter,
		panBy,
		onUndo,
		onRedo
	}: Props = $props();

	function setDesktopViewOpen(open: boolean) {
		desktopViewOpen = open;
	}
	function setMobileToolsOpen(open: boolean) {
		mobileToolsOpen = open;
	}
</script>

<div
	data-canvas-chrome
	class="mash-canvas-chrome-top pointer-events-none absolute top-3 right-3 z-10 flex flex-col items-end gap-1.5"
>
	<div class="pointer-events-auto flex flex-wrap items-center justify-end gap-1.5">
		<div class="mash-board-chip flex items-center rounded-full p-0.5 text-[10px]">
			<button
				type="button"
				class="mash-board-chip-btn rounded-full px-2.5 py-1 {!snapEnabled ? 'is-active' : ''}"
				onclick={(e) => {
					e.stopPropagation();
					if (snapEnabled) toggleSnap();
				}}
				title="Free placement — cards stay where you drop them"
			>
				Free
			</button>
			<button
				type="button"
				class="mash-board-chip-btn rounded-full px-2.5 py-1 {snapEnabled ? 'is-active' : ''}"
				onclick={(e) => {
					e.stopPropagation();
					if (!snapEnabled) toggleSnap();
				}}
				title="Snap drags to the grid (does not clear overlaps — use Organize in View). Alt flips temporarily"
			>
				Snap
			</button>
		</div>
		<button
			type="button"
			class="mash-board-chip mash-board-chip-btn rounded-full px-2.5 py-1 text-[10px] {flowMode
				? 'is-active'
				: ''}"
			onclick={(e) => {
				e.stopPropagation();
				setDesktopViewOpen(false);
				toggleFlowMode();
			}}
			title={flowMode
				? flowConnecting
					? 'Linking pages…'
					: 'Done — exit sequence mode'
				: 'Link pages in order: click last page, then next (keeps chaining)'}
			aria-pressed={flowMode}
			aria-busy={flowConnecting}
			data-testid="board-sequence"
		>
			{flowMode
				? flowConnecting
					? 'Linking…'
					: flowFromItemId
						? 'Pick next…'
						: 'Done'
				: 'Sequence'}
		</button>
		<button
			type="button"
			class="mash-board-chip mash-board-chip-btn rounded-full px-2.5 py-1 text-[10px]"
			onclick={(e) => {
				e.stopPropagation();
				zoomToFit(false);
			}}
			title="Fit all cards (⌘1)"
		>
			Fit
		</button>
		<button
			type="button"
			class="mash-board-chip mash-board-chip-btn rounded-full px-2.5 py-1 text-[10px] disabled:opacity-35"
			disabled={!canUndo}
			onclick={(e) => {
				e.stopPropagation();
				onUndo?.();
			}}
			title="Undo layout (⌘Z)"
		>
			Undo
		</button>
		<button
			type="button"
			class="mash-board-chip mash-board-chip-btn rounded-full px-2.5 py-1 text-[10px] {desktopViewOpen
				? 'is-active'
				: ''}"
			onclick={(e) => {
				e.stopPropagation();
				setDesktopViewOpen(!desktopViewOpen);
			}}
			title="View and board tools"
			aria-label="View board tools"
			aria-haspopup="menu"
			aria-expanded={desktopViewOpen}
			data-testid="board-view-toggle"
		>
			View
		</button>
	</div>

	{#if desktopViewOpen}
		<div
			class="mash-board-view-menu pointer-events-auto grid w-52 grid-cols-1 gap-0.5 rounded-2xl border p-2 shadow-xl"
			style="border-color: var(--mash-panel-border); background: var(--mash-panel); backdrop-filter: blur(10px);"
			role="menu"
			aria-label="Board view tools"
			data-testid="board-view-menu"
		>
			<p
				class="px-2 pb-1 text-[9px] font-semibold tracking-wide uppercase"
				style="color: var(--mash-ink-muted);"
			>
				{Math.round(scale * 100)}%{altHeld ? ' · Alt' : ''}
			</p>
			<button
				type="button"
				role="menuitem"
				class="mash-btn-ghost rounded-lg px-2.5 py-1.5 text-left text-[11px]"
				disabled={itemCount === 0}
				onclick={(e) => {
					e.stopPropagation();
					organizeToSnap();
					setDesktopViewOpen(false);
				}}
			>
				Organize to grid
			</button>
			<button
				type="button"
				role="menuitem"
				class="mash-btn-ghost rounded-lg px-2.5 py-1.5 text-left text-[11px]"
				disabled={itemCount === 0}
				onclick={(e) => {
					e.stopPropagation();
					toggleSelectAllOnBoard();
					setDesktopViewOpen(false);
				}}
			>
				{allBoardNotesSelected ? 'Deselect all' : 'Select all'}
			</button>
			{#if selectedCount > 0}
				<button
					type="button"
					role="menuitem"
					class="mash-btn-ghost rounded-lg px-2.5 py-1.5 text-left text-[11px]"
					onclick={(e) => {
						e.stopPropagation();
						zoomToFit(true);
						setDesktopViewOpen(false);
					}}
				>
					Fit selection
				</button>
			{/if}
			<button
				type="button"
				role="menuitem"
				class="mash-btn-ghost rounded-lg px-2.5 py-1.5 text-left text-[11px] disabled:opacity-35"
				disabled={!canRedo}
				onclick={(e) => {
					e.stopPropagation();
					onRedo?.();
					setDesktopViewOpen(false);
				}}
			>
				Redo layout
			</button>
			<button
				type="button"
				role="menuitem"
				class="mash-btn-ghost rounded-lg px-2.5 py-1.5 text-left text-[11px]"
				onclick={(e) => {
					e.stopPropagation();
					resetView();
					setDesktopViewOpen(false);
				}}
			>
				Reset pan & zoom
			</button>
			{#if onOpenShortcuts}
				<button
					type="button"
					role="menuitem"
					class="mash-btn-ghost rounded-lg px-2.5 py-1.5 text-left text-[11px]"
					onclick={(e) => {
						e.stopPropagation();
						setDesktopViewOpen(false);
						onOpenShortcuts();
					}}
				>
					Keyboard shortcuts
				</button>
			{/if}
		</div>
	{/if}
</div>

<div
	data-canvas-chrome
	class="mash-canvas-chrome-mobile pointer-events-none absolute top-3 right-3 z-20"
>
	<div class="mash-board-chip pointer-events-auto flex items-center gap-1 rounded-xl p-1 shadow">
		<button
			type="button"
			class="mash-mobile-chrome-btn"
			onclick={(e) => {
				e.stopPropagation();
				zoomToFit(false);
			}}
			disabled={itemCount === 0}
		>
			Fit
		</button>
		<button
			type="button"
			class="mash-mobile-chrome-btn"
			onclick={(e) => {
				e.stopPropagation();
				organizeToSnap();
			}}
			disabled={itemCount === 0}
		>
			Organize
		</button>
		<button
			type="button"
			class="mash-mobile-chrome-icon-btn"
			aria-label="More canvas tools"
			aria-haspopup="menu"
			aria-expanded={mobileToolsOpen}
			onclick={(e) => {
				e.stopPropagation();
				setMobileToolsOpen(!mobileToolsOpen);
			}}
		>
			<MoreHorizontal size={20} strokeWidth={2} aria-hidden="true" />
		</button>
	</div>

	{#if mobileToolsOpen}
		<div
			class="mash-mobile-tools-menu pointer-events-auto mt-2 grid grid-cols-2 gap-1 rounded-2xl p-2 shadow-xl"
		>
			<button
				type="button"
				class:active={!snapEnabled}
				onclick={() => {
					if (snapEnabled) toggleSnap();
					setMobileToolsOpen(false);
				}}>Free placement</button
			>
			<button
				type="button"
				class:active={snapEnabled}
				onclick={() => {
					if (!snapEnabled) toggleSnap();
					setMobileToolsOpen(false);
				}}>Snap to grid</button
			>
			<button
				type="button"
				disabled={itemCount === 0}
				onclick={() => {
					toggleSelectAllOnBoard();
					setMobileToolsOpen(false);
				}}>{allBoardNotesSelected ? 'Deselect all' : 'Select all'}</button
			>
			<button
				type="button"
				class:active={flowMode}
				onclick={() => {
					toggleFlowMode();
					setMobileToolsOpen(false);
				}}>{flowMode ? 'End sequence' : 'Sequence'}</button
			>
			<button
				type="button"
				disabled={!canUndo}
				onclick={() => {
					onUndo?.();
					setMobileToolsOpen(false);
				}}>Undo</button
			>
			<button
				type="button"
				disabled={!canRedo}
				onclick={() => {
					onRedo?.();
					setMobileToolsOpen(false);
				}}>Redo</button
			>
			<button
				type="button"
				onclick={() => {
					resetView();
					setMobileToolsOpen(false);
				}}>Reset view</button
			>
			{#if onOpenShortcuts}
				<button
					type="button"
					onclick={() => {
						onOpenShortcuts();
						setMobileToolsOpen(false);
					}}>Shortcuts</button
				>
			{/if}
		</div>
	{/if}
</div>

<!-- Pan / zoom pad -->
<div
	data-canvas-chrome
	class="mash-canvas-chrome-pan pointer-events-auto absolute right-3 bottom-3 z-10 flex flex-col items-center gap-1"
>
	<div class="mash-board-chip grid grid-cols-3 gap-0.5 rounded-lg p-1 shadow">
		<span class="col-start-2">
			<button
				type="button"
				class="mash-pan-btn"
				aria-label="Pan up"
				onclick={(e) => {
					e.stopPropagation();
					panBy(0, 80);
				}}
			>
				↑
			</button>
		</span>
		<button
			type="button"
			class="mash-pan-btn col-start-1"
			aria-label="Pan left"
			onclick={(e) => {
				e.stopPropagation();
				panBy(80, 0);
			}}
		>
			←
		</button>
		<button
			type="button"
			class="mash-pan-btn"
			aria-label="Recenter on content"
			title="Fit all"
			onclick={(e) => {
				e.stopPropagation();
				zoomToFit(false);
			}}
		>
			⌖
		</button>
		<button
			type="button"
			class="mash-pan-btn"
			aria-label="Pan right"
			onclick={(e) => {
				e.stopPropagation();
				panBy(-80, 0);
			}}
		>
			→
		</button>
		<span class="col-start-2">
			<button
				type="button"
				class="mash-pan-btn"
				aria-label="Pan down"
				onclick={(e) => {
					e.stopPropagation();
					panBy(0, -80);
				}}
			>
				↓
			</button>
		</span>
	</div>
	<div class="mash-board-chip flex items-center gap-0.5 rounded-lg p-1 shadow">
		<button
			type="button"
			class="mash-pan-btn"
			aria-label="Zoom out"
			onclick={(e) => {
				e.stopPropagation();
				zoomFromCenter(1 / 1.1);
			}}
		>
			−
		</button>
		<button
			type="button"
			class="mash-pan-btn"
			aria-label="Zoom in"
			onclick={(e) => {
				e.stopPropagation();
				zoomFromCenter(1.1);
			}}
		>
			+
		</button>
	</div>
</div>
