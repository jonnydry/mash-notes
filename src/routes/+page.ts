// Disable SSR — this app uses IndexedDB (Dexie) at module level,
// which only exists in the browser. All rendering must be client-side.
export const ssr = false;
export const prerender = false;
