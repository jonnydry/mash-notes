<script lang="ts">
	import { onMount } from 'svelte';
	import { pwaInfo } from 'virtual:pwa-info';
	import './fonts.css';
	import './layout.css';
	import { theme } from '$lib/stores/theme.svelte';
	import { typography } from '$lib/stores/typography.svelte';

	let { children } = $props();

	// Ensure suite tokens apply on first paint (store constructor also applies).
	void typography.suiteId;

	onMount(async () => {
		if (!pwaInfo) return;

		const { registerSW } = await import('virtual:pwa-register');
		registerSW({
			immediate: true,
			onRegisterError(error) {
				console.error('Mash offline support could not start', error);
			}
		});
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
{@render children()}
