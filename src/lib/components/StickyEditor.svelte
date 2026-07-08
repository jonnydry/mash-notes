<script lang="ts">
	/**
	 * Sticky-native editor for canvas bubbles.
	 * Lightweight by design — feels like writing on a note, not opening an IDE.
	 */
	interface Props {
		body: string;
		noteId: string;
		autofocus?: boolean;
		onBodyChange: (body: string) => void;
	}

	let {
		body,
		noteId,
		autofocus = true,
		onBodyChange
	}: Props = $props();

	let bodyEl: HTMLTextAreaElement | undefined = $state();
	let focusedNoteId: string | null = null;

	$effect(() => {
		// Focus body only when expanding a different sticky (don't steal title focus).
		if (autofocus && noteId !== focusedNoteId) {
			focusedNoteId = noteId;
			requestAnimationFrame(() => bodyEl?.focus());
		}
	});
</script>

<div class="flex h-full min-h-0 flex-col" data-no-drag>
	<textarea
		bind:this={bodyEl}
		value={body}
		placeholder="Write here…"
		class="mash-sticky-body min-h-0 flex-1 resize-none bg-transparent px-3 py-2 text-[13px] leading-relaxed outline-none"
		style="color: var(--mash-card-ink);"
		oninput={(e) => onBodyChange((e.currentTarget as HTMLTextAreaElement).value)}
		onpointerdown={(e) => e.stopPropagation()}
	></textarea>
</div>

<style>
	.mash-sticky-body {
		font-family: var(--mash-font-ui, 'IBM Plex Sans', sans-serif);
		caret-color: var(--mash-accent, #4f7a3e);
	}
	.mash-sticky-body::placeholder {
		color: var(--mash-card-muted, #6b5e4e);
		opacity: 0.7;
	}
</style>
