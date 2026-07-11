import type { Action } from 'svelte/action';

/** Move a node under `document.body` (or another target) so fixed overlays escape transformed ancestors. */
export const portal: Action<HTMLElement, HTMLElement | string | undefined> = (
	node,
	target = 'body'
) => {
	function mount(next: HTMLElement | string | undefined) {
		const parent =
			typeof next === 'string'
				? document.querySelector(next)
				: (next ?? document.body);
		parent?.appendChild(node);
	}

	mount(target);

	return {
		update(next) {
			mount(next);
		},
		destroy() {
			node.remove();
		}
	};
};
