<script lang="ts">
	/**
	 * Renders a note image from mash-blob: or legacy data: URL.
	 * Manages object-URL lifecycle for blob refs.
	 */
	import { isMashBlobRef, releaseDisplayUrl, resolveDisplayUrl } from '$lib/note-blobs';

	interface Props {
		src: string;
		alt?: string;
		class?: string;
		style?: string;
	}

	let { src, alt = '', class: className = '', style = '' }: Props = $props();

	let displaySrc = $state<string | null>(null);

	$effect(() => {
		const next = src;
		let cancelled = false;
		let held: string | null = null;

		if (!next) {
			displaySrc = null;
			return;
		}
		if (!isMashBlobRef(next) && next.toLowerCase().startsWith('data:image/')) {
			displaySrc = next;
			return;
		}

		void resolveDisplayUrl(next).then((url) => {
			if (cancelled) {
				if (url && isMashBlobRef(next)) releaseDisplayUrl(next);
				return;
			}
			held = next;
			displaySrc = url;
		});

		return () => {
			cancelled = true;
			if (held && isMashBlobRef(held)) releaseDisplayUrl(held);
		};
	});
</script>

{#if displaySrc}
	<img src={displaySrc} {alt} class={className} {style} draggable="false" />
{/if}
