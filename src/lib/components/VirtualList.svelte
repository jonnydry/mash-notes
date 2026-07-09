<script lang="ts">
	import { onMount, onDestroy, type Snippet } from 'svelte';

	interface Props<T> {
		items: T[];
		itemHeight?: number;
		overscan?: number;
		children?: Snippet<[T, number]>; // snippet for rendering each item as children(note, index)
	}

	let { items = [], itemHeight = 78, overscan = 5, children }: Props<any> = $props();

	let container: HTMLDivElement | undefined = $state();
	let scrollTop = $state(0);
	let containerHeight = $state(0);

	const totalHeight = $derived(items.length * itemHeight);

	const startIndex = $derived(Math.max(0, Math.floor(scrollTop / itemHeight) - overscan));

	const endIndex = $derived(
		Math.min(
			items.length,
			Math.ceil((scrollTop + Math.max(containerHeight, itemHeight)) / itemHeight) + overscan
		)
	);

	const visibleItems = $derived(items.slice(startIndex, endIndex));
	const offsetY = $derived(startIndex * itemHeight);

	function handleScroll() {
		if (container) {
			scrollTop = container.scrollTop;
		}
	}

	function updateHeight() {
		if (container) {
			containerHeight = container.clientHeight;
		}
	}

	let resizeObserver: ResizeObserver | undefined;

	onMount(() => {
		if (container) {
			updateHeight();
			container.addEventListener('scroll', handleScroll, { passive: true });

			resizeObserver = new ResizeObserver(() => {
				updateHeight();
			});
			resizeObserver.observe(container);
		}
	});

	onDestroy(() => {
		if (container) {
			container.removeEventListener('scroll', handleScroll);
		}
		if (resizeObserver) {
			resizeObserver.disconnect();
		}
	});
</script>

<div
	bind:this={container}
	class="mash-virtual-list min-h-0 flex-1 overflow-y-auto overscroll-contain"
	onwheel={(e) => e.stopPropagation()}
>
	<div style="height: {totalHeight}px; position: relative; width: 100%;">
		<div style="transform: translateY({offsetY}px); position: absolute; top: 0; left: 0; right: 0;">
			{#each visibleItems as item, i (item.id ?? i)}
				<div style="height: {itemHeight}px; width: 100%;">
					{@render children?.(item, startIndex + i)}
				</div>
			{/each}
		</div>
	</div>
</div>
