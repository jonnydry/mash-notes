<script lang="ts">
	import '@fontsource/ibm-plex-sans/400.css';
	import '@fontsource/ibm-plex-sans/500.css';
	import '@fontsource/ibm-plex-sans/600.css';
	import '@fontsource/fraunces/500.css';
	import '@fontsource/fraunces/600.css';
	import './layout.css';
	import { theme } from '$lib/stores/theme.svelte';

	let { children } = $props();
</script>

<svelte:head>
	<title>Mash · where notes become useful</title>
	<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png" />
	<meta name="theme-color" content={theme.metaColor} />
	<meta
		http-equiv="content-security-policy"
		content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; manifest-src 'self'; base-uri 'self'; form-action 'self'; object-src 'none';"
	/>
</svelte:head>
{@render children()}
