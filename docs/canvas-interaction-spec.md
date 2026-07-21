# Canvas interaction contract

This document is the behavioral contract for Mash's canvas. It describes how
selection, direct manipulation, navigation, sequencing, and mashing resolve so
future changes preserve the same fast and predictable feel.

## Experience principles

1. The object under the pointer wins. Dragging or resizing a card makes that
   card part of the active selection.
2. Intent must be clear before state changes. Pointer travel under 4 screen
   pixels remains a click, not a drag or resize.
3. Continuous gestures are optimistic and frame-coalesced. Durable storage and
   undo history update once, at gesture end.
4. Zoom never changes the user's focal point. Cursor zoom keeps the board point
   beneath the cursor fixed; button and keyboard zoom use the viewport center.
5. Destructive-looking combinations explain their outcome and remain
   reversible through Unmash.
6. Modes are explicit. Set page order changes card clicks from selection to
   linking, advertises the next expected page, and exits with Escape or Done.

## Gesture priority

When gestures overlap, resolve in this order:

1. Dialogs and card controls (buttons, inputs, editor content)
2. Resize handle
3. Sequence-mode card click
4. Card drag
5. Card-local scrolling
6. Empty-board Space/middle-button pan
7. Empty-board marquee selection
8. Canvas wheel pan or modified-wheel zoom

Pointer cancellation never commits a move or resize. The optimistic layout is
restored to the gesture's starting snapshot.

## Selection

### Pointer

- Plain click selects one card and makes it the primary keyboard target.
- Command/Ctrl-click toggles one card without discarding the rest.
- Shift-click selects the spatial range from the primary card to the clicked
  card. Spatial order is top-to-bottom, then left-to-right.
- Empty-board click clears selection.
- Empty-board drag creates a marquee. Any intersecting card counts, including a
  partially enclosed card. Shift/Command/Ctrl-marquee adds; it never toggles
  existing cards off.
- A 4-screen-pixel threshold separates clicks from drags at every zoom level.
- Dragging an unselected card selects it when the threshold is crossed. A plain
  drag makes it the only selection; Command/Ctrl-drag adds it and moves the
  resulting group.
- Resizing an unselected card selects it immediately.

### Keyboard and focus

- One selected card has `tabindex=0`; the rest use `-1`.
- Enter opens the focused or primary selected card as an in-desk sticky. The
  sticky's explicit maximize control opens the large editor.
- Arrow keys nudge the selection. Shift+arrow uses a 4x step.
- In Snap mode, the nudge step is one grid unit (24 board pixels); otherwise it
  is one board pixel.
- Command/Ctrl+A toggles all cards on the current board when the pointer is over
  the board.
- Escape first cancels a pending page, then exits Set page order.

## Moving cards

- Pointer deltas are converted from screen pixels to board units using the
  current zoom, so the card tracks the pointer at every scale.
- Selected cards move as one rigid group. Their relative positions do not
  change during the gesture.
- Move updates are coalesced to one animation frame and remain in memory until
  release. IndexedDB and layout undo receive one final transaction.
- Snap is applied on release, not continuously, to prevent magnetic jitter.
- Alt temporarily inverts the saved Snap preference.
- Snap only affects dragged cards. It does not unexpectedly move neighbors;
  Organize is the explicit action for clearing overlap.
- If snapped cards overlap a stationary neighbor, show the existing
  “Overlapping — Organize to tidy” feedback.
- Dragging one card to an editor-stage edge previews left, right, bottom, or
  maximize. Dropping into an empty split half fills that half. Group drags do
  not open the editor stage.
- A valid mash target takes priority over an editor-edge target.

## Resizing cards

- Resize begins from the bottom-right handle and uses scale-correct board
  deltas.
- Collapsed bounds: 160×96 minimum, 360×240 maximum.
- Expanded bounds: 280×220 minimum, 640×720 maximum.
- In Snap mode, final width and height land on the 24-pixel grid.
- A resize creates one undo entry and one persistence write.
- Expanded-card resizing may bump overlapping neighbors after release; the
  expanded card remains the fixed anchor.

## Pan and zoom

### Pan

- Trackpad/mouse wheel pans the board in both axes.
- A scrollable card preview or textarea consumes the wheel only while it can
  still scroll in that direction. At its boundary, the same gesture pans the
  board.
- Space+primary drag and middle-button drag pan the board directly.
- Arrow controls pan by 80 screen pixels per press.

### Zoom

- Command/Ctrl+wheel and trackpad pinch zoom toward the cursor.
- Zoom is exponential for consistent sensitivity across mouse wheels and
  high-resolution trackpads.
- Zoom range is 40%–200%.
- Plus/minus controls and Command/Ctrl + / − zoom around the viewport center.
  The in/out factors are mathematical inverses, so one step each returns to the
  starting scale.
- Fit all and Fit selection use 56 screen pixels of padding.
- Command/Ctrl+1 fits all. Command/Ctrl+0 resets to 100% at pan 0,0.
- Viewport state is saved per canvas after 200 ms of inactivity and restored on
  return.

## Creating and organizing cards

- New cards spawn near the visible center, on the Snap lattice, with a light
  cascade and overlap avoidance.
- New notes, canvas double-click/Enter, Ingredients, and search all open the
  same in-desk sticky editor. The large stage is reserved for explicit
  maximize, split edit, or edge-snap gestures.
- An opened sticky measures its rendered content once. Short notes keep the
  compact 280×220 default; overflowing notes grow vertically, then widen up to
  400×480 before retaining internal scroll. It does not resize continuously
  while the user types.
- External note drops are converted from client to board coordinates and obey
  the current Snap mode.
- Organize snaps every card and resolves overlap in one undoable action.
- Align operations require two cards; distribution requires three. Alignments
  preserve a 24-pixel minimum gap.
- Fit and Organize remain explicit, separate actions: one changes the camera;
  the other changes content positions.

## Page sequences

- **Sequence selected** is an immediate selection action. It orders cards
  top-to-bottom, then left-to-right, and creates one undoable sequence.
- **Set page order** is the precise manual mode. Entering it clears ordinary
  selection so Mash/Align actions cannot be confused with link creation.
- The toolbar coach begins with **Choose the first page**. The first chosen card
  receives a provisional `1` badge, then the coach advances to **Choose page 2**.
- After a successful link, the new page remains the source, its committed badge
  stays visible, and the coach advances to **Choose page N**.
- Hovering or focusing a valid target previews the next badge before commit.
- After page 2 exists, **Done** remains visible beside the live instruction.
- Only linear chains are allowed: one predecessor, one successor, no self-link,
  no cycle. Rejected targets explain the reason in the status surface.
- While a link is being stored and laid out, the Sequence control reports
  “Linking…” and ignores duplicate card input.
- Linking packs the affected sequence left-to-right using real card sizes and
  moves obstacles out of the sequence corridor.
- Existing sequences repack on entry to Set page order.
- Page badges show `1`, `2`, `3` for one sequence. Multiple independent
  sequences add the sequence prefix, such as `1.1`, `1.2`, and `2.1`.
- The completed end cap identifies the object and its size, such as
  **Sequence 1 · 4**, and offers Edit order, Select pages, export actions, and
  Remove page order. Invalid stored graphs expose repair controls and cannot
  export as valid sequences.
- Linking, unlinking, unstitching, and sequence packing participate in layout
  undo/redo.

## Mashing notes

- Drag-mash applies to a single card only. Group drags never mash.
- A target activates when overlap reaches 28% of the smaller card. If multiple
  cards qualify, the highest-overlap target wins.
- The target gets a lifted highlight and “Drop to mash” label before release.
- First use shows a focused confirmation naming both notes and explaining that
  one combined sticky replaces both cards; Unmash restores the originals.
- After the teaching confirmation has been accepted once, drag-mash completes
  immediately for speed.
- Cancel places the source beside the target so the user is not left with an
  ambiguous pile.
- The selection-bar Mash action always confirms and lists a preview of the
  selected note titles because it can combine more than two notes.
- Source notes stay in the library but leave the canvas. The mash note stores
  their IDs in `mashedFrom`; Unmash deletes the mash note and restores available
  sources near its position.

## Performance budget

- Pointermove work: at most one layout state update per animation frame.
- Persistence: zero writes during move; one batch at release.
- Card culling: enabled at 40+ cards with a 280-screen-pixel overscan. Selected,
  dragged, resized, expanded, and mash-partner cards always remain mounted.
- Board dimensions come from ResizeObserver rather than a forced layout read on
  every pan frame.
- Editor edge bounds are captured once at drag start.
- Link summaries are built once per notes update in O(notes + links), not once
  per card with repeated backlink scans.
- The current linear mash-target scan is appropriate for normal boards. Add a
  spatial index only if profiling shows frame misses on several hundred cards.

## Accessibility and motion

- Selection, focus, drag, sequence source, mash target, and pending confirmation
  each require distinct visible states in both themes.
- The mash confirmation is an alert dialog, receives initial focus, traps Tab,
  and supports Escape.
- All canvas toolbar and pan/zoom actions have accessible names and keyboard
  equivalents where practical.
- Focus rings must remain visible above the selected-card treatment.
- Motion should communicate settling and lift, never delay input. Reduced-motion
  users should receive the same state changes without nonessential animation.

## Verification checklist

- Click without movement selects; 1–3 px jitter still selects.
- Dragging an unselected card updates selection and moves only the intended set.
- Command/Ctrl-drag adds and moves a group.
- Resize, move, Organize, link, and unlink undo and redo cleanly.
- Wheel over a short card preview pans; wheel over a long preview scrolls until
  the boundary, then pans.
- Zoom retains the cursor focal point and never exceeds 40%–200%.
- Set page order rejects self, cycle, second predecessor, and second successor.
- First drag-mash confirms with titles; cancel separates cards; confirm can be
  reversed through Unmash.
- 40+ card boards cull offscreen cards without unmounting active ones.
- Keyboard-only selection, opening, nudging, fitting, zooming, and mode exit work.

## Known follow-up areas

- Validate touch-specific card dragging, card-preview scrolling, and pinch zoom
  on iPad/phone hardware; desktop pointer and trackpad behavior is the current
  reference implementation.
- Run a screen-reader pass to settle the ideal semantic role for focusable,
  multi-selectable cards that also contain interactive descendants.
- Profile 200+ card boards before adding a spatial index or direct DOM transform
  path; complexity should follow measured frame misses, not speculation.
