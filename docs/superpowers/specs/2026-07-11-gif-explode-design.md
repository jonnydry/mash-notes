# GIF explode (frame cards)

**Date:** 2026-07-11  
**Status:** Implementation  
**Product:** Mash notes PWA  
**Sequel to:** Image visual stickies

## Product

When an **animated** GIF is dropped, pasted, or opened:

1. Show a dialog (paste-split energy): **One still** vs **N frame cards**
2. Frames land as a multi-card set; titles `name · f. k`; source title includes `f. k/total`
3. Cap **36** frames with even sampling when longer
4. Multiple animated GIFs in one batch → stills each + toast to drop one at a time for explode
5. Single-frame GIFs skip the dialog (normal image path)

## Tech

- `gifuct-js` parse + decompress patches
- Composite disposal onto full canvas; export PNG data URLs via soft max-edge
- `src/lib/gif-explode.ts`, `GifExplodeDialog.svelte`

## Non-goals

- Playback on a sticky
- Per-frame delay / timeline export
- Unlimited frames
