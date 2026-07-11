# MASH ephemeral sessions implementation plan

Status: Proposed

## Product direction

MASH should be a local-first session workbench, not a permanent knowledge base by default.

The primary loop is:

1. Bring material in.
2. Shape and manipulate a set.
3. Produce a useful result.
4. Take the result elsewhere.
5. Clear the desk automatically or deliberately.

Local persistence remains important, but it should be intentional. The compromise is:

- **Scratch desks** persist locally for crash recovery and repeat visits, but expire after inactivity.
- **Kept desks and kept results** persist locally until the user deletes them.
- **Exports** remain the durable, portable handoff.
- MASH never silently deletes kept work.

## Lifecycle decision

### Default policy

- A new desk is a `scratch` desk.
- Scratch desks expire after **14 days of meaningful inactivity**.
- Expired desks move to **Recently cleared** for a **7-day recovery window**.
- After the recovery window, MASH permanently deletes the desk and its session-only content.
- Activity extends the expiration date; merely opening or viewing a desk does not.
- A user can choose `Keep desk` or `Keep selected` at any time. Kept work does not expire.

Fourteen days is long enough to survive weekends and interrupted projects while still making accumulation feel temporary. The 7-day recovery window protects trust without turning recovery into another permanent archive.

### User-adjustable scratch retention

Offer these local preferences:

- 1 day
- 7 days
- 14 days — default
- 30 days

Do not offer `Never` for scratch desks. Users who want indefinite local persistence use `Keep desk`. This preserves a clear distinction between accidental accumulation and intentional storage.

Changing the preference should update expiration for active scratch desks from their last meaningful activity. It must not shorten or delete kept desks.

### Meaningful activity

The following extend a scratch desk's expiration:

- Creating, editing, moving, resizing, grouping, sequencing, or deleting a card.
- Importing or pasting material.
- Applying, undoing, or redoing a set operation.
- Renaming the desk.

These do not extend expiration:

- Opening or switching to a desk.
- Searching, panning, zooming, or changing theme.
- Copying or exporting without changing the desk.

### Storage pressure

- Use `navigator.storage.estimate()` to show local usage when available.
- Consider requesting persistent browser storage only when the user first keeps a desk, with a plain explanation.
- At high storage usage, remove permanently expired recovery data first.
- Never automatically remove kept desks or the active scratch desk.
- If a write fails, preserve the in-memory edit, show a persistent error, and offer Copy/Export immediately.

## Core terminology

Use plain language in primary controls and retain the playful MASH vocabulary as flavor:

- **Desk** — one working session.
- **Scratch desk** — expires after inactivity.
- **Kept desk** — remains on this device.
- **Ingredients** — cards available to place or manipulate; replaces unexplained uses of `Peel` in primary copy.
- **Mash** — combine or transform selected cards.
- **Finish** — take the result and decide what remains.
- **Recent desks** — current scratch and kept desks; replaces `Screenplay` as the primary label. `Screenplay` can remain a visual subtitle or mode name.

## Target user flows

### Starting MASH

If there is an active recent scratch desk:

- Primary action: `Continue desk`.
- Secondary action: `New scratch desk`.
- Show kept desks and other recent desks below.

If there is no active desk:

- Open a clean scratch desk immediately.
- Place an intake prompt in the canvas: `Paste text, drop files, or start typing.`
- Do not ask for a name or folder.

### Working in a scratch desk

- Show a subtle lifecycle indicator in the desk switcher, such as `Scratch · clears in 12 days`.
- Do not display a constant countdown on the canvas.
- When the desk is within 24 hours of expiration, show one calm, dismissible notice: `This scratch desk clears tomorrow. Keep it if you want it to stay.`
- Never block work with an expiration modal.

### Keeping work

`Keep desk`:

- Converts the desk and all current cards to kept local work.
- Offers an optional name, prefilled from the most prominent card or `Untitled desk`.
- Removes the expiration date.
- May request persistent browser storage after explaining that the work remains on this device.

`Keep selected`:

- Promotes selected cards to kept notes/results.
- Leaves unselected ingredients in the scratch desk.
- Makes kept results available in search and the kept collection.

### Finishing a session

Add a primary `Finish` action with:

1. **Take it with you**
   - Copy selected/result as Markdown.
   - Download Markdown.
   - Print/save as PDF.
   - Export a board image.
   - Export a local MASH bundle.
2. **What should remain?**
   - Keep selected.
   - Keep entire desk.
   - Leave as scratch until its expiration date.
   - Clear now.
3. **Confirmation**
   - State what was copied/exported.
   - State what will remain locally and for how long.

`Clear now` moves the desk to Recently cleared rather than permanently deleting immediately.

### Restoring recently cleared work

- Show a small `Recently cleared` section in the desk switcher only when it contains items.
- Each entry shows its remaining recovery period.
- `Restore` returns it to scratch and resets expiration from the restore time.
- `Delete now` permanently removes it after confirmation.

## Data model

Implement the lifecycle without immediately splitting the editor across separate note and fragment tables. Extend the current model first, then revisit physical separation if product usage demands it.

```ts
type SessionMode = 'scratch' | 'kept';
type SessionStatus = 'active' | 'recovering';

interface Session {
	id: string;
	title: string;
	mode: SessionMode;
	status: SessionStatus;
	created: number;
	modified: number;
	lastMeaningfulActivityAt: number;
	expiresAt?: number;
	recoveryUntil?: number;
	activeCanvasId?: string;
}

interface Note {
	// Existing fields remain.
	sessionId?: string;
	scope: 'session' | 'kept';
	keptAt?: number;
}

interface Canvas {
	// Existing fields remain during migration.
	sessionId: string;
}

interface Operation {
	id: string;
	sessionId: string;
	type: string;
	inputNoteIds: string[];
	outputNoteIds: string[];
	payload?: Record<string, unknown>;
	created: number;
	revertedAt?: number;
}
```

### Index changes

- Add `sessions` and `operations` tables.
- Add `sessionId`, `scope`, and `keptAt` indexes to notes.
- Replace the global unique canvas-folder index with a session-scoped index such as `&[sessionId+folder]`.
- Keep viewport and dismissal preferences keyed by canvas ID; cascade-delete those keys when a session is permanently removed.

### Why reuse `Note` initially

Using `scope: 'session' | 'kept'` lets the current editor, Markdown renderer, search, links, imports, and Mash behavior continue to operate. A dedicated fragment table would duplicate large parts of that stack before the product behavior is validated.

Search should index session notes only while their desk is active and index kept notes globally. Session notes should not clutter global kept-note results after a desk enters recovery.

## Migration strategy

Existing users must not experience current data as newly expiring scratch work.

On database upgrade:

1. Create one kept session named `My existing MASH desk`.
2. Attach existing root, folder, and pinned canvases to that kept session.
3. Mark all existing notes as `scope: 'kept'`.
4. Preserve existing placements, links, edges, tags, folders, viewport state, dismissals, and tombstones.
5. Set a local migration-complete flag and make the process idempotent.
6. Show a one-time notice: `Your existing work was kept on this device. New desks will be temporary unless you keep them.`

Seed welcome content on a fresh install should belong to the initial scratch desk and should not become permanent kept content automatically.

## Sync and export policy

The current sync bundle assumes MASH is a durable notes store. Update the meaning carefully:

- Sync bundles include kept desks and kept notes by default.
- The active scratch desk is included only when the user chooses `Include current scratch desk`.
- Recovering desks are never included automatically.
- Importing a scratch desk creates a new scratch session with a fresh expiration date and records its original timestamp as provenance.
- Session deletion needs tombstones only for sessions that were previously included in a sync bundle.
- JSON/Markdown exports remain content exports and do not need lifecycle metadata unless exporting a full MASH bundle.

## Universal intake

### Empty-desk input

The empty state should include:

- An inline quick-capture field.
- `Paste` guidance.
- A `Drop files` target.
- `Import` as a secondary action.

### Paste interpretation

When pasted text contains multiple meaningful blocks, show a lightweight choice:

- One card.
- One card per line.
- One card per paragraph.

Remember the last choice for the current session only. Never interrupt a simple one-line paste.

Add CSV/TSV support later, after text splitting is validated.

### Source provenance

Cards created from a file, PDF, URL, or import should retain compact source metadata. Provenance should be visible on demand and included in exported Markdown when requested.

## Set operations

### First operator set

Ship deterministic operations before optional AI:

- Combine.
- Split by headings, paragraphs, or lines.
- Stack/group.
- Sort manually, alphabetically, or by creation time.
- Deduplicate exact or normalized duplicates.
- Sequence.
- Shuffle.

### Second operator set

- Compare.
- Rank and vote.
- Cluster by tags or simple text similarity.
- Convert a group into a checklist, outline, or table.

### Operation behavior

- Every operation creates an `Operation` receipt.
- Inputs and outputs remain traceable.
- Undo must restore content and layout, not only card positions.
- Chained Mash results should preserve provenance through the operation graph rather than only a flat `mashedFrom` array.
- The UI should show only the operators relevant to the current selection.

## UI simplification

### Desktop canvas chrome

Default visible controls:

- Placement mode.
- `View` menu.
- `Finish`.

Selection bar:

- Mash/Transform.
- Group.
- Sequence.
- Copy/Export.
- Keep.
- Delete.

`View` menu:

- Organize.
- Fit all.
- Reset view.
- Snap setting.
- Undo/redo status.
- Help.

### Mobile

- Auto-fit once when opening a desk or crossing into the mobile breakpoint.
- Do not auto-fit after every edit or card move.
- Replace the wrapped top toolbar with a single overflow control.
- Remove the directional pan pad; use gestures and a single recenter/fit action.
- Bottom navigation prioritizes Desks, Ingredients, New, and Finish.
- Move Settings and less-common collections into overflow.
- Ensure safe-area padding and 44 px minimum touch targets.

## Engineering decomposition

Before the second operator set, reduce the largest interaction files.

### Shared action registry

Create one typed action registry used by:

- Command palette.
- Selection bar.
- Context menus.
- Keyboard shortcuts.
- Future recipes.

Each action should declare:

- ID and label.
- Availability predicate.
- Keyboard shortcut.
- Whether it mutates content, layout, or session lifecycle.
- Confirmation requirements.
- Execution and undo behavior.

### Extract controllers

From `CanvasBoard.svelte`:

- Viewport controller.
- Card gesture controller.
- Selection controller.
- Sequence controller.
- Drop/import controller.
- Spatial keyboard controller.

From `+page.svelte`:

- Session lifecycle service.
- Finish/export service.
- Command registry wiring.
- Import routing.
- Dialog/toast coordination.

Keep Svelte components focused on rendering and event forwarding.

## Performance work

- Dynamically import `PdfReader` and PDF tooling when the user opens a PDF.
- Verify the PDF worker is not required in the initial PWA precache.
- Limit Fontsource imports to required Latin subsets unless other scripts are intentionally supported.
- Set performance budgets for the initial application shell and lazy feature chunks.
- Measure cold start, time to first editable card, and time to interactive on a mid-range mobile device.

Suggested budgets:

- Initial compressed JavaScript under 250 KB where practical.
- First editable card available within 1 second on a warm load and 2.5 seconds on a representative cold mobile load.
- No PDF code in the critical path.

## Accessibility work

- Add reusable focus trapping and focus restoration for dialogs.
- Ensure every spatial card operation has a keyboard-accessible alternative.
- Provide screen-reader announcements for selection changes, Mash results, session expiration changes, restore, and export completion.
- Increase canvas control text and hit targets.
- Verify contrast in both themes rather than relying only on token intent.
- Test 200% zoom and mobile reflow.
- Respect reduced-motion preferences for settling, drag-target, and drop animations.

## Delivery plan

### Milestone 0 — lock product rules

Deliverables:

- Approve the scratch/kept/recovery lifecycle.
- Approve default 14-day inactivity plus 7-day recovery.
- Approve migration and sync behavior.
- Create low-fidelity flows for Start, Desk switcher, Keep, Finish, and Restore.

Exit criteria:

- No unresolved behavior around expiration, recovery, or existing user data.
- Copy is understandable without explaining internal storage concepts.

### Milestone 1 — session foundation

Deliverables:

- Database migration and session repository.
- Scratch and kept session creation.
- Meaningful-activity timestamps.
- Expiration and recovery state transitions.
- Session-aware canvas loading.
- Recently cleared restore and permanent cleanup.
- Existing-data migration to a kept session.

Exit criteria:

- Existing users lose no data or layout.
- A scratch desk survives reload and browser restart.
- A simulated expired desk moves to recovery and can be restored.
- Kept work is never selected by automatic cleanup.
- Cleanup is transactional and retry-safe.

### Milestone 2 — start and finish loop

Deliverables:

- Clean initial scratch desk.
- Continue/New desk entry states.
- Desk switcher with scratch, kept, and recently cleared sections.
- Keep desk and Keep selected.
- Finish flow with Copy, Markdown, PDF, bundle, leave-as-scratch, keep, and clear.
- Session-aware export messaging.

Exit criteria:

- A new user can create, manipulate, export, and clear a desk without opening Settings.
- The product clearly states what remains locally.
- Finishing never requires folders, tags, or a desk name.

### Milestone 3 — universal intake

Deliverables:

- Inline quick capture.
- Clipboard paste handling.
- Line and paragraph splitting.
- Unified drag/drop messaging.
- Source provenance display.

Exit criteria:

- A user can turn a copied list into cards in two interactions or fewer.
- Simple one-line capture remains instant.
- Import failure never destroys the existing desk.

### Milestone 4 — mobile and accessibility correction

Deliverables:

- Mobile auto-fit on entry/breakpoint change.
- Condensed toolbar and bottom navigation.
- Removed mobile pan pad.
- Focus trap/restore primitive.
- Larger targets, contrast fixes, announcements, and reduced-motion support.

Exit criteria:

- Existing cards are visible when opening a desk at 390 × 844.
- No canvas chrome overlaps the dock or selection bar.
- Core capture, selection, Mash, Finish, Keep, and Restore flows work by touch and keyboard.

### Milestone 5 — action architecture and first operator set

Deliverables:

- Shared action registry.
- Extracted canvas controllers.
- Operation receipts and content-aware undo.
- Combine, split, group, sort, deduplicate, sequence, and shuffle.
- Contextual operator menu.

Exit criteria:

- Palette, menus, shortcuts, and selection bar invoke the same action definitions.
- Every operator is reversible.
- Provenance survives chained operations.

### Milestone 6 — performance and release hardening

Deliverables:

- Lazy PDF loading.
- Font subset reduction.
- Storage quota handling.
- Session sync-bundle updates.
- Full migration, retention, accessibility, mobile, and performance test passes.

Exit criteria:

- Performance budgets pass.
- Storage failures have a recoverable user path.
- Sync never revives expired scratch content unexpectedly.
- Release can roll back without invalidating existing user data.

## Test plan

### Unit tests

- Expiration calculation for all retention options.
- Meaningful versus non-meaningful activity.
- Scratch-to-kept conversion.
- Active-to-recovering-to-deleted transitions.
- Restore behavior.
- Transactional cascade deletion.
- Search inclusion rules.
- Sync inclusion rules.
- Operation receipts and undo.

Use an injected clock for all retention tests; do not depend on real timers or dates.

### Migration tests

- Fresh database.
- Every supported prior Dexie schema version.
- Existing folder, root, and pinned canvases.
- Existing mashed notes, links, tombstones, sync metadata, dismissals, and viewports.
- Interrupted migration and retry.

### End-to-end flows

- First run to finished session.
- Continue a scratch desk after reload.
- Keep a desk before expiration.
- Expire, recover, and restore.
- Expire and permanently clean up.
- Paste a list into cards.
- Finish with selected output and discard ingredients.
- Mobile open, auto-fit, manipulate, and finish.
- Storage write failure with Copy/Export recovery.

### Manual research

Run five short usability sessions around these questions:

- Do users understand that scratch desks persist temporarily?
- Do they trust the expiration and recovery behavior?
- Can they distinguish Keep from Export?
- Can they complete a session without discovering Settings or the command palette?
- Does the time limit feel focusing rather than threatening?

## Success criteria

The direction is working when:

- A first-time user can paste material and create a useful output in under three minutes.
- Most sessions finish through Copy/Export rather than accumulating indefinitely.
- Users can accurately explain what is scratch, what is kept, and what leaves the device.
- Returning same-machine users can continue active work without managing files.
- Expiration produces no surprise permanent loss in usability testing.
- Mobile users see and can act on their cards immediately.

## Explicit non-goals for this plan

- Cloud accounts or automatic cloud sync.
- Real-time collaboration.
- Replacing dedicated long-term knowledge bases.
- Making every scratch card globally searchable forever.
- Shipping AI before the deterministic session loop is excellent.
- Preserving every desktop canvas control on mobile.

## Recommended first implementation slice

Build one vertical slice before the full migration:

1. Create a scratch session.
2. Track meaningful activity and show `clears in 14 days` in the desk switcher.
3. Implement Keep desk.
4. Implement Finish with Copy Markdown and Clear now.
5. Move cleared desks into a recoverable state using a short test clock.
6. Validate the language and trust model with users.

This slice proves the compromise before investing in operators, new intake formats, or broad component refactors.
