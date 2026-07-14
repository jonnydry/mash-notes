// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import 'vite-plugin-pwa/client';
import 'vite-plugin-pwa/info';

declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	interface Window {
		/** E2E hook: import a sync-bundle JSON string without a file input. */
		__mashImportSync?: (text: string) => Promise<{
			ok: boolean;
			message: string;
			added?: number;
			updated?: number;
		}>;
	}
}

export {};
