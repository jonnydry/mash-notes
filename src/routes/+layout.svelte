<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<title>Mash • quick notes</title>
	<link rel="icon" href="/icons/favicon-32.png" />
</svelte:head>
{@render children()}
