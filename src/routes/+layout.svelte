<script lang="ts">
	import { onMount } from 'svelte';
	import { pwaInfo } from 'virtual:pwa-info';
	import './fonts.css';
	import './layout.css';
	import { preloadMarkedAfterPaint } from '$lib/markdown-nodes';
	import { theme } from '$lib/stores/theme.svelte';
	import { typography } from '$lib/stores/typography.svelte';
	import MobileDesktopNotice from '$lib/components/MobileDesktopNotice.svelte';

	let { children } = $props();
	const mobileOnly =
		typeof window !== 'undefined' && window.matchMedia('(max-width: 960px)').matches;

	// Ensure suite tokens apply on first paint (store constructor also applies).
	void typography.suiteId;

	onMount(() => {
		const cancelPreload = mobileOnly ? () => {} : preloadMarkedAfterPaint();
		if (pwaInfo) {
			void import('virtual:pwa-register').then(({ registerSW }) => {
				registerSW({
					immediate: true,
					onRegisterError(error) {
						console.error('Mash offline support could not start', error);
					}
				});
			});
		}
		return cancelPreload;
	});
</script>

<svelte:head>
	<title>Mash · local-first scratch workbench</title>
	<meta
		name="description"
		content="Turn messy text and files into useful, portable results on a private local-first workbench."
	/>
	<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png" />
	<meta name="theme-color" content={theme.metaColor} />
</svelte:head>
{#if mobileOnly}
	<MobileDesktopNotice />
{:else}
	{@render children()}
{/if}
