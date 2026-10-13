/** Shown on the Import desk bundle button while its chunk is loading. */
export const DESK_BUNDLE_IMPORT_BUSY_LABEL = 'Importing…';

export const DESK_BUNDLE_IMPORT_IDLE_LABEL = 'Import desk bundle…';

/** First offline visit has not cached the import chunk yet. */
export const DESK_BUNDLE_IMPORT_OFFLINE_MESSAGE = 'Import needs a connection the first time';

type DeskBundleImportHandlers = {
	loadChunk: () => Promise<unknown>;
	onBusy: () => void;
	onIdle: () => void;
	onOffline: (message: string) => void;
	onReady: () => void;
};

/**
 * Click handler for Import desk bundle.
 * Marks the button busy before the dynamic import resolves, ignores a second
 * click while that load is in flight, and does not open the file picker when
 * the chunk fails.
 */
export function createDeskBundleImport(handlers: DeskBundleImportHandlers): () => Promise<void> {
	let busy = false;
	return async function startDeskBundleImport() {
		if (busy) return;
		busy = true;
		handlers.onBusy();
		let loaded = false;
		try {
			await handlers.loadChunk();
			loaded = true;
			handlers.onReady();
		} catch (error) {
			if (!loaded) handlers.onOffline(DESK_BUNDLE_IMPORT_OFFLINE_MESSAGE);
			else throw error;
		} finally {
			busy = false;
			handlers.onIdle();
		}
	};
}
