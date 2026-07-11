# MASH consolidated Finish experience

Status: Implemented and release-verified
Owner: Product and engineering
Updated: 2026-07-11

## Outcome

Finish becomes the clear end of Mash's core loop:

1. Choose the useful material.
2. Take it away in the appropriate format.
3. Decide what should remain on this device.
4. Receive a plain-language confirmation.

A user should be able to complete this loop without opening Settings, understanding the database model, organizing folders, or naming the desk.

## Why this is the next slice

Mash already supports scratch and kept desks, recovery, copy/export commands, operation results, PDF output, sync bundles, and local storage health. Those capabilities are currently distributed across the selection bar, canvas, command palette, Settings, and the early Finish dialog.

The current Finish dialog provides Copy desk as Markdown, Keep desk, and Clear now. It does not yet provide:

- A clear choice between selected cards, active results, and the whole desk.
- Download Markdown, PDF, board image, and MASH bundle exports in the same flow.
- Keep takeaway as a durable subset while leaving or clearing the remaining ingredients.
- An explicit leave-as-scratch choice.
- A completion receipt that says exactly what left Mash and what remains locally.

This slice should consolidate existing capabilities before adding more operators or organizational features.

## Product principles

### Finish is a checkpoint, not a wizard

Keep the experience in one responsive dialog or sheet. The user may perform more than one export without moving through sequential pages. Local-retention choices are committed only when the user presses the final Finish button.

### Export and storage are separate decisions

Taking content away does not silently keep it or clear it. Keeping content does not imply that it has been backed up elsewhere.

### The useful subset comes first

Finish should default to the material most likely to be the result:

1. Selected cards, when a selection exists.
2. Active operation results, when no cards are selected and results exist.
3. The whole desk otherwise.

The default remains visible and changeable.

### Destructive outcomes are explicit

Clear now must state how many cards will move to recovery and whether the takeaway will be kept. It must never be triggered by an export action.

### The result is understandable in ordinary language

Use phrases such as `Copied 3 cards` and `This scratch desk stays for 12 more days`. Avoid sync, scope, tombstone, session ID, and persistence jargon in primary copy.

## Scope

### Included

- A unified Finish surface for desktop and mobile.
- Takeaway scope: Selected, Results, or Whole desk.
- Copy Markdown.
- Download Markdown.
- Print/save as PDF.
- Export board image.
- Export local MASH bundle.
- Keep takeaway on this device.
- Leave desk as scratch.
- Keep entire desk.
- Clear now into seven-day recovery.
- Accurate completion and error messaging.
- Keyboard, screen-reader, reduced-motion, zoom, and touch support.
- Automated unit and end-to-end coverage.
- Performance protection for image/PDF export tooling.

### Not included

- Cloud accounts or remote storage.
- Sharing links or collaboration.
- Scheduled or automatic exports.
- CSV/TSV export.
- New AI features.
- Redesigning the desk switcher.
- Replacing the existing scratch/kept/recovery policy.

## Proposed experience

### Entry

Finish remains a primary dock action. Opening it preserves the current canvas selection.

The header reads:

- Title: `Finish this desk`
- Supporting copy: `Take the useful part with you, then decide what stays here.`

If the active desk has unsaved in-memory writes, Finish waits for the existing write flush. If storage remains unavailable, the export portion stays usable and the retention controls explain that local changes cannot yet be committed.

### Section 1: Takeaway

Show a compact scope control before the export actions.

| Scope      | Availability                                            | Meaning                                                                                  |
| ---------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Selected   | Enabled when cards are selected                         | The current ordered selection                                                            |
| Results    | Enabled when non-reverted operation outputs still exist | Current result cards, newest results first while preserving each result's internal order |
| Whole desk | Always enabled                                          | Every card placed on the active desk in spatial reading order                            |

Each option includes a live count, for example `Selected · 4`.

When the scope changes, show a concise preview line such as:

`4 cards · Interview themes, Open questions, Next steps…`

#### Export actions

| Action            | Scope behavior                       | Completion behavior                                                                                   |
| ----------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Copy Markdown     | Uses the chosen scope                | Mark as completed and announce the count                                                              |
| Download Markdown | Uses the chosen scope                | Download one `.md` file and mark completed                                                            |
| Print / save PDF  | Uses the chosen scope                | Open the existing printable note flow                                                                 |
| Board image       | Uses Selected or Whole desk          | Download a PNG of the cards and relationships; Results uses the result cards' current board positions |
| MASH bundle       | Always exports the whole active desk | Label this exception directly: `Whole desk + result history`                                          |

Copy Markdown remains the visually strongest action because it is immediate and broadly useful. Other formats appear as equal secondary actions, not hidden in an overflow menu.

Exports execute immediately and do not close Finish. A user can copy Markdown and also download a bundle before deciding what remains.

### Section 2: What stays here

Storage is expressed as two related choices.

#### Keep the takeaway

For a scratch desk and a subset scope, show:

`Keep these {n} cards on this device`

When enabled, the scoped notes are promoted to kept work transactionally. They remain visible on the current desk until that desk is cleared, and remain available in the kept collection afterward.

Hide this checkbox when:

- The entire desk is already kept.
- Whole desk is selected and `Keep entire desk` is chosen.
- No scoped cards are available.

#### Desk disposition

Use a mutually exclusive choice:

1. `Leave as scratch` — default for a scratch desk; show the calculated expiration date.
2. `Keep entire desk` — remove expiration and keep all current cards locally.
3. `Clear now` — move the desk to Recently cleared for seven days.

For an already-kept desk:

- Replace `Leave as scratch` with `Keep desk as it is`.
- Do not offer conversion back to scratch in this slice.
- Allow Clear now, with recovery, after confirmation.

If Clear now is selected while Keep takeaway is off, show:

`All {n} cards will leave your active desks. You can restore them for 7 days.`

If Keep takeaway is on, show:

`Keep {x} cards. Move the remaining {y} cards to Recently cleared for 7 days.`

### Footer and commit

The footer contains:

- Secondary: `Back to desk`
- Primary: `Finish`

The primary label becomes `Finish and clear` when Clear now is selected. Pressing it opens one compact confirmation only for clearing. Export actions never trigger that confirmation.

Commit order:

1. Flush pending card edits.
2. Promote the takeaway if requested.
3. Apply the desk disposition in one transaction where possible.
4. Refresh search, canvas, sessions, storage health, and result history.
5. Close Finish and announce the receipt.

When clearing creates no active desk, open a clean scratch desk automatically. When leaving or keeping the desk, return to the current desk.

### Completion receipt

Show a persistent-enough toast and matching live-region announcement. Example:

`Copied 4 cards · Kept 4 cards · “Research synthesis” moved to Recently cleared for 7 days.`

The receipt is built from completed facts, not intended choices. A failed export is never reported as successful.

## Interaction states

### Empty desk

- Scope is Whole desk with `0 cards`.
- Content exports are disabled with `Add or import something first.`
- Leave, Keep desk, and Clear remain available.

### No selection

- Selected is disabled.
- Default to Results when valid results exist, otherwise Whole desk.

### Selection changes while Finish is open

- Snapshot the selection when the dialog opens.
- Do not let background state changes silently alter the takeaway.
- Reopening Finish creates a new snapshot.

### Reverted or deleted results

- Exclude reverted operation outputs.
- Exclude notes that no longer exist.
- If no outputs remain, disable Results and fall back to Whole desk.

### Export failure

- Keep Finish open.
- Mark only that action as failed.
- Provide Retry and, when appropriate, Copy Markdown as a fallback.
- Preserve all local-retention selections.

### Storage failure

- Keep content exports enabled.
- Disable Finish when it would mutate local lifecycle state.
- Explain: `Mash could not update local storage. Copy or download your work, then retry.`
- Reuse the existing in-memory retry path and storage-health refresh.

### Browser capability gaps

- Clipboard unavailable: keep Download Markdown available.
- Print blocked: explain how to retry rather than claiming PDF success.
- Canvas/image export unsupported: disable Board image with a short reason.
- Persistent-storage request denied: kept work still remains local, with browser-managed wording.

## Information architecture and responsive behavior

### Desktop

- Maximum width around 640–720 px.
- Scope and preview at top.
- Export actions in a two-column grid.
- Retention choices below a clear divider.
- Footer remains visible while content scrolls.

### Mobile

- Bottom sheet or near-full-height dialog respecting safe-area insets.
- Single-column export actions.
- Sticky footer with 44 px minimum targets.
- No horizontally scrolling scope tabs; use wrapping segmented buttons or a select-like group.
- The sheet must remain usable at 390 × 844 and at 200% zoom.

### Keyboard and assistive technology

- Reuse the existing focus trap and restore focus to Finish on close.
- Give the dialog one accessible name and concise description.
- Implement scope and disposition controls as native radio groups.
- Keep takeaway uses a native checkbox.
- Every export has visible busy, success, and failure states.
- Announce scope changes, export results, and final lifecycle outcome.
- Escape closes only when no destructive confirmation is active.
- Honor reduced motion; status changes do not depend on animation.

## Data and domain contract

Introduce explicit Finish types rather than passing a growing list of callbacks through the panel.

```ts
type FinishScope = 'selected' | 'results' | 'desk';
type FinishExportKind = 'copy-markdown' | 'download-markdown' | 'pdf' | 'board-image' | 'bundle';
type FinishDisposition = 'leave' | 'keep-desk' | 'clear';

interface FinishSnapshot {
	sessionId: string;
	canvasId: string;
	selectedNoteIds: string[];
	resultNoteIds: string[];
	deskNoteIds: string[];
	openedAt: number;
}

interface FinishDraft {
	scope: FinishScope;
	keepTakeaway: boolean;
	disposition: FinishDisposition;
}

interface FinishReceipt {
	exported: Array<{ kind: FinishExportKind; noteCount: number }>;
	keptNoteCount: number;
	disposition: FinishDisposition;
	recoveryUntil?: number;
}
```

### Ordering rules

- Selected uses the user's ordered selection.
- Results sorts operation receipts newest first, then preserves each receipt's output order, removing duplicates.
- Whole desk uses stable top-to-bottom, left-to-right spatial order.
- Bundle format preserves stored IDs and operation ordering rather than display ordering.

### Keep takeaway behavior

Add one transactional repository operation:

```ts
promoteNotesToKept(sessionId: string, noteIds: string[], keptAt: number): Promise<number>
```

It must:

- Update only notes belonging to the active session.
- Set `scope: 'kept'` and `keptAt` idempotently.
- Preserve content, source metadata, operation ID, links, and current placement.
- Prevent later scratch cleanup from deleting promoted notes.
- Refresh search inclusion immediately.

Clearing a scratch desk after promotion removes its canvas placements but not the promoted note records.

## Engineering structure

### New modules

- `src/lib/finish-model.ts`
  - Pure scope resolution, ordering, defaults, counts, and receipt copy.
- `src/lib/finish-service.ts`
  - Export orchestration, edit flush, promotion, disposition commit, and structured errors.
- `src/lib/components/FinishPanel.svelte`
  - Presentational responsive Finish UI.
- `src/lib/board-image-export.ts`
  - Lazy board-image renderer isolated from the initial bundle.

### Existing modules to extend

- `src/lib/db.ts`
  - Transactional note promotion and safe clear behavior.
- `src/lib/stores/sessions.svelte.ts`
  - Commit disposition and return a structured lifecycle result.
- `src/lib/stores/note-library.svelte.ts`
  - Resolve and refresh promoted notes; expose Markdown export without UI side effects.
- `src/lib/components/SessionPanel.svelte`
  - Retain desk-switcher responsibility and delegate Finish to `FinishPanel`.
- `src/routes/+page.svelte`
  - Create the Finish snapshot and pass a small service boundary instead of format-specific callbacks.
- `src/lib/action-registry.ts`
  - Register Finish/export actions so palette and selection surfaces call the same definitions.

### Reuse before adding code

- Existing Markdown serialization and download functions.
- Existing printable note/PDF path.
- Existing sync bundle v4 generation and result provenance.
- Existing session keep, clear, recovery, storage persistence, toast, and announcement behavior.
- Existing spatial reading-order helpers.

### Board image strategy

Board image is the only materially new export engine.

- Render only the scoped board bounds, not the entire infinite canvas.
- Include card content, color, relative placement, and visible relationships.
- Exclude transient selection handles, menus, overlays, and editor chrome.
- Add a reasonable pixel and memory ceiling; downscale large boards with a disclosed message.
- Load the renderer dynamically after Board image is pressed.
- Keep it out of the PWA precache and add it to the performance budget assertion.

The implementation spike should compare a lightweight DOM-to-image dependency with a purpose-built canvas renderer. Choose based on fidelity, cross-browser reliability, bundle size, and support for current CSS variables and fonts.

## Delivery slices

Implementation checkpoint (2026-07-11): All five slices are complete and release-verified. The shipped experience includes the snapshot/scope model, scoped Copy and Download Markdown, scoped Print/save PDF, whole-desk MASH bundle export, transactional Keep takeaway, the global Kept takeaways collection, Leave/Keep desk/Clear dispositions, cleanup-safe operation provenance, completion receipts, storage rollback coverage, and a purpose-built lazy board-image renderer. Final hardening added a safe-area-aware mobile sheet, fixed action footer, 200% text-size reflow, native keyboard completion, modal isolation from canvas shortcuts, named live regions, focus restoration, forced-color focus treatment, export retry without lost choices, storage-failure Copy fallback, and a complete browser release matrix.

### Slice 1: Finish model and snapshot

Deliver:

- Finish types and pure scope-resolution functions.
- Selection, result, and whole-desk ordering.
- Default-scope logic.
- Empty, deleted, duplicate, and reverted-result handling.
- Presentational FinishPanel shell using current tokens and focus behavior.

Tests:

- Unit tests for every scope and fallback.
- Component checks for accessible radio groups and disabled states.

Exit:

- Opening Finish always shows an accurate, stable takeaway count.
- No export or retention mutation is implemented inside the component.

### Slice 2: Existing exports consolidated

Deliver:

- Copy Markdown by scope.
- Download Markdown by scope.
- PDF by scope using the existing lazy PDF path.
- Whole-desk MASH bundle with clear scope labeling.
- Per-action busy, success, error, and retry state.

Tests:

- Serialization/order unit tests.
- Browser tests for Copy and Download Markdown.
- PDF regression coverage.
- Bundle includes desk and operation provenance.

Exit:

- All existing takeaway formats are accessible from Finish.
- Performing multiple exports never changes lifecycle state or closes the dialog.

### Slice 3: Keep takeaway and lifecycle commit

Deliver:

- Transactional `promoteNotesToKept`.
- Keep takeaway checkbox.
- Leave scratch, Keep entire desk, and Clear now dispositions.
- Clear confirmation with exact counts.
- Automatic clean scratch desk after clearing the final active desk.
- Structured completion receipt.

Tests:

- Promotion is idempotent and session-scoped.
- Promoted notes survive permanent scratch cleanup.
- Unselected scratch notes retain expiration.
- Kept desk is never shortened by retention changes.
- Storage failure preserves the export path and prevents false confirmation.

Exit:

- A user can keep only the useful subset and safely discard or defer the rest.
- Every Finish outcome states what remains and for how long.

### Slice 4: Board image

Deliver:

- Renderer spike and documented choice.
- Selected, Results, and Whole desk PNG output.
- Relationship rendering and bounded export dimensions.
- Lazy loading and recoverable errors.

Tests:

- Stable bounds and ordering fixtures.
- Empty and oversized board behavior.
- Browser download smoke test.
- Initial-load performance assertion proves renderer code is deferred.

Exit:

- The exported image is recognizable, readable, and free of application chrome.
- No board-image code enters the critical path or PWA precache.

### Slice 5: Responsive, accessibility, and end-to-end hardening

Deliver:

- Desktop and mobile layout polish.
- 200% zoom and 390 × 844 verification.
- Keyboard-only completion.
- Screen-reader announcements and focus restoration.
- Reduced-motion and high-contrast verification.
- Complete first-run-to-Finish browser flow.

Tests:

- Selected → Copy → Keep takeaway → Clear rest.
- Results → Download Markdown → Leave scratch.
- Whole desk → Bundle → Keep desk.
- Export failure → retry without losing choices.
- Storage failure → Copy fallback.
- Mobile and keyboard flows.

Exit:

- Finish works without Settings, pointer input, or prior knowledge of Mash storage.
- All automated checks and performance budgets pass.

## Test matrix

| Area                          | Unit          | Component       | Browser                           |
| ----------------------------- | ------------- | --------------- | --------------------------------- |
| Scope resolution and ordering | Required      | —               | Smoke                             |
| Markdown serialization        | Required      | —               | Copy/download                     |
| PDF scope                     | Required      | —               | Existing reader/export regression |
| Bundle scope and provenance   | Required      | —               | Download smoke                    |
| Board image bounds            | Required      | —               | Visual/download smoke             |
| Keep takeaway transaction     | Required      | —               | Survives clear and reload         |
| Leave/keep/clear disposition  | Required      | State rendering | Full lifecycle                    |
| Storage/export failure        | Required      | Error states    | Recovery path                     |
| Accessibility                 | —             | Semantics       | Keyboard/focus/announcements      |
| Mobile/reflow                 | —             | —               | 390 × 844 and 200% zoom           |
| Performance                   | Budget script | —               | Initial-resource assertion        |

## Analytics without surveillance

Mash is local-first and should not introduce remote tracking for this flow. If product learning is needed, use an opt-in local diagnostic summary that the user can export manually.

Useful aggregate fields would be:

- Finish opened count.
- Scope chosen.
- Export kinds attempted/succeeded.
- Disposition chosen.
- Export and storage error categories.

Do not record note titles, bodies, filenames, tags, URLs, or source content.

## Risks and mitigations

### Too many choices make Finish feel heavy

Mitigation: choose a sensible scope automatically, keep Copy prominent, group formats tightly, and keep storage decisions visually separate.

### Keep takeaway conflicts with scratch cleanup

Mitigation: implement promotion and clear in tested database transactions; cleanup deletes session-scoped notes only.

### Board images add weight and browser inconsistency

Mitigation: isolate behind a dynamic import, cap dimensions, test both themes, and preserve Markdown as the universal fallback.

### Export success is confused with durable backup

Mitigation: receipts name the actual action and separately state local retention. A copy action never says backed up.

### Result scope becomes stale

Mitigation: snapshot valid operation outputs on open and exclude reverted, deleted, or duplicate outputs.

### The modal becomes too tall on mobile

Mitigation: use one scroll region, compact action rows, a sticky footer, and no nested dialogs except destructive confirmation.

## Release and rollback

- Preserve current Copy, export, Keep desk, and Clear functions until the new service passes all tests.
- Keep the database migration additive and idempotent.
- Do not change sync bundle format solely for Finish.
- Ship behind a local feature flag only if promotion/cleanup changes cannot be safely isolated.
- Rollback must leave promoted notes marked kept and must not reinterpret them as expiring scratch content.

## Definition of done

The consolidated Finish slice is complete when:

- Selected, Results, and Whole desk scopes are accurate and understandable.
- Copy Markdown, Download Markdown, PDF, Board image, and MASH bundle are available from Finish.
- The user can keep the takeaway, keep the whole desk, leave it as scratch, or clear it into recovery.
- Export and retention decisions never silently affect one another.
- Success and failure receipts report completed facts.
- Promoted notes survive scratch cleanup and remain searchable.
- The full flow works on mobile, keyboard, screen reader, and 200% zoom.
- Storage failure leaves a safe Copy/Download escape path.
- Initial-load and PWA performance budgets continue to pass.
- Unit, migration, component, and browser test suites pass.

## Recommended implementation order

Start with Slice 1 and Slice 2 together as the first reviewable checkpoint. This creates the complete takeaway portion with no database lifecycle risk. Then implement Slice 3 as a separately reviewed persistence change, followed by Board image and final hardening.
