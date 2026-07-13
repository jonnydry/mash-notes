<script lang="ts">
	import './fonts.css';
	import './layout.css';
	import { theme } from '$lib/stores/theme.svelte';
	import { typography } from '$lib/stores/typography.svelte';

	let { children } = $props();

	// Ensure suite tokens apply on first paint (store constructor also applies).
	void typography.suiteId;
</script>

<svelte:head>
	<title>Mash · local-first scratch workbench</title>
	<meta
		name="description"
		content="Turn messy text and files into useful, portable results on a private local-first workbench."
	/>
	<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png" />
	<meta name="theme-color" content={theme.metaColor} />
	<meta
		http-equiv="content-security-policy"
		content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; manifest-src 'self'; base-uri 'self'; form-action 'self'; object-src 'none';"
	/>
</svelte:head>
{@render children()}
