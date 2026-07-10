# Canvas mechanics audit

## Verdict

The canvas already had a strong interaction model: optimistic moves, persistent
per-board camera state, undoable layout operations, snap/organize separation,
linear page flows, and reversible mashing. The polish pass focused on ambiguity
at gesture boundaries and repeated work during high-frequency updates.

## Captured flow

1. **Empty canvas — healthy.** The empty state explains how to place and open
   notes, while the persistent toolbar exposes placement and camera controls.
   Evidence: [01-initial.png](01-initial.png)
2. **Rapid card creation — usable, but intentionally dense.** New cards cascade
   around the viewport center and can still overlap enough to read as a stack.
   Organize is the clear escape hatch; the product should keep this density only
   if “gather first, arrange later” remains the intended model. Evidence:
   [02-three-card-stack.png](02-three-card-stack.png)
3. **Organize — healthy.** One action clears overlap, preserves card sizes, and
   enables layout undo. Evidence: [03-organized-cards.png](03-organized-cards.png)
4. **Direct manipulation — improved and healthy.** Dragging an unselected card
   now selects it, 1–3 px pointer jitter remains a click, and a real drag is
   committed once on release. Evidence: [05-drag-selects-card.png](05-drag-selects-card.png)
5. **Zoom — healthy.** Cursor zoom keeps its focal point; button zoom uses the
   center; one zoom-in plus one zoom-out returns to exactly 100%.
6. **Sequence creation — healthy.** The mode clears normal selection, prompts for
   the next page, keeps chaining, guards the async link, lays out pages, labels
   page order, and exposes link/sequence controls. Evidence:
   [06-sequence-linked.png](06-sequence-linked.png)
7. **Drag-mash — improved and healthy.** The target is explicit, first-use
   confirmation names both notes, the copy explains replacement and Unmash, and
   Cancel separates the cards. Evidence:
   [07-mash-confirmation.png](07-mash-confirmation.png)

## Highest-impact changes made

- Added a 4-screen-pixel click/drag/resize threshold at every zoom level.
- Made selection follow dragged and resized cards, including additive group drag.
- Restored optimistic positions on pointer cancellation instead of committing a
  partial gesture.
- Let card previews consume wheel input only while they can scroll, then hand the
  same direction back to canvas panning.
- Made zoom-in and zoom-out symmetric and added Command/Ctrl +/- shortcuts.
- Cached board size and editor-edge bounds to remove layout reads from hot pan
  and drag paths.
- Built link summaries once per note update instead of repeating full-library
  backlink scans for every rendered card.
- Locked Sequence input while a link is being stored and laid out.
- Added note titles and reversibility guidance to first-use drag-mash.
- Added reduced-motion fallbacks and a durable interaction specification.

## Evidence limits and remaining risks

- Screenshots prove visual state, not assistive-technology behavior. The current
  build still reports existing ARIA-role warnings for focusable canvas cards and
  a few neighboring components; a dedicated screen-reader semantics pass is
  still warranted.
- Desktop mouse, trackpad, keyboard, selection, sequence, and mash-cancel flows
  were exercised. Touch dragging, card scrolling, and pinch zoom still need
  iPad/phone hardware validation.
- The 40+ card culling and one-pass link summaries are covered by code paths and
  unit checks, but a measured 200+ card frame-time profile was outside this run.
- The browser test used local IndexedDB sample notes. It did not confirm the Mash
  action itself to avoid replacing the captured source cards; confirmation and
  cancel were verified, while Unmash behavior remains covered by existing app
  logic and tests.
