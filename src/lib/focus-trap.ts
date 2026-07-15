export type FocusTrapOptions = {
	initialFocus?: string;
};

const FOCUSABLE_SELECTOR = [
	'button:not([disabled])',
	'[href]',
	'input:not([disabled])',
	'select:not([disabled])',
	'textarea:not([disabled])',
	'[tabindex]:not([tabindex="-1"])'
].join(',');

export function wrappedFocusIndex(index: number, length: number, backwards: boolean): number {
	if (length <= 0) return -1;
	if (index < 0) return backwards ? length - 1 : 0;
	return backwards ? (index - 1 + length) % length : (index + 1) % length;
}

function focusableElements(root: HTMLElement): HTMLElement[] {
	return [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
		(element) =>
			!element.hasAttribute('disabled') &&
			element.getAttribute('aria-hidden') !== 'true' &&
			(element.getClientRects().length > 0 || element === document.activeElement)
	);
}

/** Trap keyboard focus inside a modal and restore it to the opener when unmounted. */
export function focusTrap(node: HTMLElement, options: FocusTrapOptions = {}) {
	const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	const originalTabIndex = node.getAttribute('tabindex');
	let initialFrame = requestAnimationFrame(() => {
		initialFrame = 0;
		// A quick keyboard or pointer interaction can move focus into the dialog
		// before this deferred initial-focus pass runs. Preserve that explicit
		// choice instead of stealing focus back to the configured default.
		if (document.activeElement instanceof HTMLElement && node.contains(document.activeElement)) {
			return;
		}
		const requested = options.initialFocus
			? node.querySelector<HTMLElement>(options.initialFocus)
			: null;
		const target = requested ?? focusableElements(node)[0] ?? node;
		if (target === node && !node.hasAttribute('tabindex')) node.tabIndex = -1;
		target.focus({ preventScroll: true });
	});

	function onKeydown(event: KeyboardEvent) {
		if (event.key !== 'Tab') return;
		const modalStack = [...document.querySelectorAll<HTMLElement>('[aria-modal="true"]')];
		if (modalStack.length > 0 && modalStack[modalStack.length - 1] !== node) return;
		const focusable = focusableElements(node);
		if (focusable.length === 0) {
			event.preventDefault();
			node.focus({ preventScroll: true });
			return;
		}
		const activeIndex = focusable.indexOf(document.activeElement as HTMLElement);
		const nextIndex = wrappedFocusIndex(activeIndex, focusable.length, event.shiftKey);
		const atBoundary =
			activeIndex < 0 ||
			(!event.shiftKey && activeIndex === focusable.length - 1) ||
			(event.shiftKey && activeIndex === 0);
		if (!atBoundary) return;
		event.preventDefault();
		focusable[nextIndex]?.focus({ preventScroll: true });
	}

	document.addEventListener('keydown', onKeydown, true);

	return {
		destroy() {
			if (initialFrame) cancelAnimationFrame(initialFrame);
			document.removeEventListener('keydown', onKeydown, true);
			if (originalTabIndex === null) node.removeAttribute('tabindex');
			else node.setAttribute('tabindex', originalTabIndex);
			queueMicrotask(() => {
				if (opener?.isConnected) opener.focus({ preventScroll: true });
			});
		}
	};
}
