# Mash directional refinements plan

Date: 2026-07-20

This plan turns the four ideas in `next-steps.md` into product decisions and implementation slices that build on Mash's current canvas, editor stage, mascot rotation, Finish flow, and lazy-loaded export tools.

## Direction at a glance

1. Make **Sequence** describe the outcome—an ordered set of pages—and make each next step visible while the user builds one.
2. Keep editing **on the desk by default** in a compact sticky. Treat the editor stage as an explicit maximize or split-view action.
3. Make the **potato holding the notebook** every user's first empty-desk character, then rotate the other characters on later reloads without immediate repeats.
4. Turn export into a shared **presentation system**: one template picker and one document model, with matching PDF and DOCX renderers.

Two assumptions shape the plan:

- “Mini window” means Mash's existing expanded in-canvas sticky, currently 280 × 220 board pixels. A second floating-window system is not needed.
- “Rotating logos” means the empty-desk mascot/character. The dock logo and wordmark should remain stable so Mash retains a recognizable brand anchor.

## 1. Make Sequence easier to understand

### Outcome

A first-time user should be able to turn three cards into pages 1–3, understand the resulting order, change that order, and find export without learning Mash-specific terminology.

### Current baseline

Mash already has the hard parts:

- A selection operator sequences cards in spatial reading order and packs them left-to-right.
- A board mode lets the user click a source card and keep adding the next page.
- Cards show page badges, sequence arrows can be removed, invalid chains can be repaired, and the sequence end cap owns select, unstitch, PDF, print, and outline actions.
- Sequence mutations participate in layout undo/redo.

The comprehension issue comes from presentation. “Sequence” currently names both an immediate arrange action and a board mode, the inactive tooltip starts with “click last page,” and the active button cycles through terse states such as “Pick next…” and “Done.” The result becomes clearest only after links and page badges already exist.

### Product behavior

#### Give the two entry points distinct jobs

- In the selection/Transform surface, label the action **Sequence selected** with the subtitle **Orders cards top-to-bottom, then left-to-right**.
- In the board toolbar, label the mode **Set page order**. This is the manual path for choosing a precise order one page at a time.
- Keep **Sequence** as the name of the finished object: “Sequence 1 · 4 pages.”

This preserves both current workflows without making one word mean two different commands.

#### Make manual ordering self-explanatory

When the user enters Set page order:

1. Show a small, non-modal coach near the toolbar: **Choose the first page**.
2. The first clicked card receives a provisional **1** badge and the toolbar changes to **Choose page 2**.
3. Each successful click creates the link, keeps the new page as the source, and changes the prompt to **Choose page N**.
4. Hovering or focusing a valid target previews the next page badge before commit.
5. Invalid targets remain uncommitted and explain the reason in the existing status/toast surface: already in this sequence, would create a cycle, or already has a previous/next page.
6. Keep **Done** visible beside the instruction after page 2 exists. Escape cancels the pending page first and exits the mode second, preserving the current interaction contract.

Do not introduce a blocking tutorial. The live badge and verb should teach the interaction in context.

#### Clarify the completed object

- Replace the end-cap trigger `Seq`/`S1` with a wider label such as **Sequence 1 · 4** when space allows; retain a compact accessible label at small zoom levels.
- Keep page badges visible outside ordering mode. Use `1`, `2`, `3` for one sequence and `1.1`, `1.2` only when multiple sequences make the prefix necessary.
- Rename **Unstitch** to **Remove page order** in user-facing copy. “Unstitch” can remain an internal action/undo label if useful.
- Group end-cap actions into **Edit order**, **Select pages**, **Export…**, and **Remove page order**. Put print, PDF, DOCX, and outline choices behind Export instead of growing the end cap horizontally.
- On completion, use a receipt such as **Sequence created · 4 pages · Undo** rather than only “Sequenced 4 cards.”

#### Make rearrangement obvious

For the first version, preserve spatial reading order for **Sequence selected**. Do not add ordered-selection state.

- The selection action should briefly preview or state the resolved order before/after commit: **Ordered top-to-bottom, then left-to-right**.
- Manual Set page order remains the precise alternative.
- In a follow-up slice, support dragging a page within an existing packed row to reorder it. Treat this as a new sequence edge transaction with one undo entry; do not infer order continuously from every canvas move.

### Delivery slices

#### Slice 1 — Copy and visible state (small)

- Rename the two entry points and replace the current “click last page” guidance.
- Add the provisional first-page badge and explicit **Choose page N** state.
- Expand end-cap accessible labels and completion receipts.
- Update `docs/canvas-interaction-spec.md` before changing behavior.

Likely touchpoints: `CanvasChrome.svelte`, `CanvasBoard.svelte`, `operator-kitchen.ts`, `selection-operators.ts`, and the canvas interaction spec.

#### Slice 2 — Completed-sequence controls (small–medium)

- Replace terse end-cap actions with the clearer grouped menu.
- Add **Edit order**, which enters Set page order with the sequence's last page as the active source.
- Route **Export…** to the shared export picker described in section 4.

#### Slice 3 — Direct reorder (medium, optional follow-up)

- Add drag-to-reorder inside a packed sequence.
- Rebuild links, repack the affected sequence, and create one undo receipt.
- Do not ship this slice until the simpler Set page order flow has been usability-tested; it may not be needed.

### Acceptance criteria

- A user can create a three-page sequence from the toolbar without reading documentation.
- The interface visibly answers “what do I click next?” at every step.
- Sequence selected still uses stable spatial order and remains one undoable action.
- Keyboard users can choose the first/next page and finish or cancel the mode.
- Multiple sequences remain distinguishable at normal board zoom.
- Existing cycle, predecessor, successor, repair, persistence, and undo safeguards still pass.
- In a five-person lightweight usability check, at least four people can create and export a three-page sequence on the first attempt and accurately describe its order.

### Tests to add or update

- Unit tests for prompt state and next-page numbering.
- E2E coverage for first page → page 2 → page 3 → Done, including keyboard-only operation.
- E2E coverage for Sequence selected and the stated spatial order.
- Accessibility assertions for active instructions, provisional badges, invalid-target feedback, and the end-cap menu.
- Regression coverage in `canvas-relationships.spec.ts`, `operators.spec.ts`, `board-chrome.spec.ts`, and `accessibility.spec.ts`.

## 2. Make compact sticky editing the default

### Outcome

Opening a note should feel like opening a macOS Sticky: compact, spatial, and close to the card's board context. The large editor remains available when the user asks for focus or comparison.

### Current baseline

- New note already opens as an expanded 280 × 220 in-canvas sticky.
- Expanded stickies already have an explicit **Open large editor** button.
- Double-clicking or pressing Enter on a collapsed card currently opens the screen-space editor stage maximized.
- Opening a note from the Ingredients tray also defaults to the maximized stage.
- The stage has mature maximize, edge snap, two-pane split, divider resizing, focus management, and drag-to-snap behavior. That should be preserved.
- In-canvas cards already persist dimensions, support resize bounds, push overlapping neighbors away while expanded, and restore the surrounding layout on collapse.

### Product behavior

#### One default, explicit escalation

| User action                                                     | New behavior                                              |
| --------------------------------------------------------------- | --------------------------------------------------------- |
| New note                                                        | Open as an in-canvas sticky and focus the body, unchanged |
| Double-click a collapsed canvas card                            | Expand it in place                                        |
| Press Enter on a focused collapsed card                         | Expand it in place                                        |
| Open a note that is already on the desk from Ingredients/search | Reveal and expand its existing card                       |
| Open a note not yet on the desk from Ingredients/search         | Place it near the visible center, then expand it          |
| Click **Open large editor**                                     | Maximize in the editor stage                              |
| Drag a card to an editor-stage edge                             | Preserve current snap/maximize behavior                   |
| Open two selected notes together                                | Preserve the current split-stage behavior                 |

The stage is not removed or simplified. Its role becomes legible: focus, split, and compare.

#### Content-aware compact sizing

Use a one-time, measured growth pass after the editor renders rather than guessing from character count.

1. Open at the existing 280 × 220 minimum so short notes remain sticky-sized.
2. Measure the editor's intrinsic body height after fonts and content render.
3. Grow height first, snapped to the existing 24-pixel grid, up to roughly 480 board pixels.
4. If the body would still be heavily clipped, grow width toward roughly 400 board pixels and remeasure.
5. Respect the existing hard bounds of 280 × 220 through 640 × 720 and also cap the result to the visible desk so the title bar and controls stay reachable.
6. Keep scrolling for content beyond the cap; do not make very long notes consume the whole board.

The exact 400/480 breakpoints should be tuned against the existing typography themes, not hard-coded from character counts.

#### Preserve user intent

- Add an optional canvas-item sizing mode: `sizeMode?: 'auto' | 'manual'`.
- Existing items with canonical dimensions can default to auto. Existing items with non-canonical dimensions should migrate in memory as manual.
- An explicit resize sets manual mode. Reopening never overrides manual dimensions.
- Auto sizing may grow when content clearly overflows, but it should not shrink on every edit or make the card pulse while typing.
- Provide a small **Fit to content** action in the expanded sticky menu so a manually sized note can opt back into a measured fit.
- Persist the final auto size once and reuse the current neighbor-bump, framing, and layout persistence paths.

### Delivery slices

#### Slice 1 — Unify open behavior (small)

- Change canvas double-click and Enter from `openInStage(..., 'maximize')` to in-place expansion.
- Change tray/search open behavior to place/reveal and expand in place.
- Keep maximize available from the existing button and stage snap gestures.
- Update helper comments and E2E expectations that currently describe the stage as the default open destination.

Likely touchpoints: `CanvasBoard.svelte`, `canvas-session.svelte.ts`, `+page.svelte`, `canvas-interaction-spec.md`, and the editor/card E2E helpers.

#### Slice 2 — Auto-size utility (medium)

- Add a pure sizing policy in `canvas-card-sizing.ts` and keep DOM measurement in the component layer.
- Add sizing-mode persistence or a compatibility-safe equivalent.
- Reuse `bumpNeighborsAround`, `frameNoteForEditing`, Snap-grid rounding, and existing expanded bounds.
- Debounce content-driven growth and run at most once per open unless the user explicitly chooses Fit to content.

#### Slice 3 — Polish and accessibility (small)

- Make **Open large editor** text available in the title/button tooltip and accessible name; the icon alone should not carry the distinction.
- Confirm that collapse restores focus to the originating card and maximize moves focus into the stage.
- Verify every typography theme because font metrics affect the measured size.

### Acceptance criteria

- New note, double-click, Enter, tray, and search all produce the same compact editing model on desktop.
- Maximizing is always available in one explicit action.
- Short notes open at the compact minimum; long notes grow enough to reveal materially more content without exceeding the visible desk or hard bounds.
- Manually resized notes retain their dimensions across collapse, reopen, reload, and theme changes.
- Opening a note never leaves its title bar or close/maximize controls off-screen.
- Split editing and drag-to-snap behavior remain unchanged.

### Tests to add or update

- Pure sizing tests for short, medium, long, image-led, and empty notes.
- E2E tests for double-click/Enter → expanded sticky and explicit maximize → stage.
- E2E tests for long-note growth, manual-size preservation, neighbor bumps, and Fit to content.
- Cross-theme checks for Editor, Atelier, Napkin, Terminal, Workshop, and Kitchen typography.
- Regression coverage in `type-to-start.spec.ts`, `dock.spec.ts`, `canvas-mechanics`, and `editor-stage.spec.ts`.

## 3. First-show potato, then rotate characters

### Outcome

Every new user meets Mash through the original potato holding up the mint notebook. Later reloads keep the empty desk playful by rotating through the character set without an immediate repeat.

### Current baseline

- `DEFAULT_EMPTY_CANVAS_MASCOT` is already the correct potato/notebook asset: `/icons/mash-empty-mascot@2x.png`.
- The current visit chooser randomly selects from 22 rotating assets on the very first load and only prevents the immediately previous random index from repeating.
- The empty-state renderer already falls back to the default mascot if a rotating image fails.
- E2E coverage already checks per-visit stability, rotation after reload, and broken-asset recovery.

### Product behavior

Use a small explicit state machine:

1. **Never shown:** return `DEFAULT_EMPTY_CANVAS_MASCOT`.
2. **First mascot successfully displayed:** persist a local `hasSeenDefaultMascot` marker.
3. **Later page loads:** choose from the rotating character set, excluding the core duplicate if it points to the same artwork and excluding the immediately previous character.
4. **Rotating asset fails:** fall back to the potato without advancing or corrupting rotation state.

Persist the “first shown” marker only after the image's successful `load` event. That makes the guarantee about what the user actually saw, not merely what the app selected during startup.

Use local storage for the first-show marker so a new tab does not reset onboarding. Keep failure handling defensive: if storage is blocked, show the default potato safely and allow the app to continue.

The dock logo, favicon, wordmark, pinned mascot, settings mascot, and document-specific mascots stay deterministic.

### Delivery slices

#### Slice 1 — Selection policy (small)

- Split the chooser into first-show and rotating states.
- Give the default mascot a stable identity rather than treating it as an out-of-band error fallback only.
- Remove the duplicate potato artwork from the later rotation pool if visual inspection confirms it is identical.
- Continue choosing once per page initialization so ordinary rerenders never reshuffle the character.

#### Slice 2 — Successful-display acknowledgment (small)

- Add an `onload` acknowledgment from the empty-state image back to the chooser/storage utility.
- Only acknowledge while the default first-show mascot is active.
- Preserve the current `onerror` fallback behavior.

### Acceptance criteria

- A clean browser profile always shows the potato/notebook mascot first.
- Reloading after that first successful display shows a rotating character.
- Consecutive reloads never show the same rotating character twice.
- Board interaction and rerenders do not change the character during a page visit.
- Blocked storage and missing rotating assets still produce a visible potato mascot.
- The dock/product logo does not rotate.

### Tests to add or update

- Unit test: no persisted marker → default mascot regardless of random input.
- Unit test: default is not marked seen until display acknowledgment.
- Unit test: persisted marker → rotating pool with immediate-repeat protection.
- E2E test: clean profile first load → potato; reload → rotating path; second reload → no immediate repeat.
- Preserve startup-recovery coverage for aborted rotating image requests.

## 4. Stylized PDF templates and matching DOCX export

### Outcome

Users can turn selected cards, results, a whole desk, or a sequence into a presentable document—not just a technically valid export—and can choose the same presentation intent for PDF or Word.

### Current baseline

Mash currently has two PDF paths:

- A lazy-loaded `pdf-lib` path builds a direct PDF download for selections and sequences. It supports pagination and embedded local/data images, but flattens most Markdown and replaces unsupported non-Latin characters because it uses a standard WinAnsi font.
- The Finish flow opens a styled HTML print document that preserves more rendered Markdown and relies on the system print dialog for Save as PDF.

Finish already owns scope selection and export status. The sequence end cap already owns ordered page export. DOCX import uses `mammoth`, but there is no DOCX writer.

The first architectural task is to avoid adding a third unrelated export path.

### Product behavior

#### One export picker

- Replace **Print / save PDF** in Finish with **Export PDF** and add **Export Word (.docx)**.
- Both open the same Export sheet with the requested format preselected.
- Change the completed-sequence action from **PDF** to **Export…** and pass its exact sequence order into the same sheet.
- Preserve Finish scope: Selected, Results, or Whole desk. Sequence exports use their page order and do not silently fall back to spatial order.
- Remember the last-used template and page size locally per format; default safely to Clean if the preference is missing or stale.

#### Three templates for v1

| Template        | Presentation                                                                                | Best for                                 |
| --------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------- |
| **Clean**       | Neutral typography, restrained metadata, one clear section per note                         | General handoff and printing             |
| **Editorial**   | Optional cover, strong section titles, running footer/page numbers, continuous reading flow | Briefs, essays, and synthesized research |
| **Sticky deck** | One note per page inside a Mash-colored card with generous whitespace                       | Storyboards, workshops, and sequences    |

Keep the first release intentionally small. Template differences should be structural and visible, not a list of minor color variants.

#### Focused options

For v1, expose only options shared meaningfully by both formats:

- Letter or A4.
- Optional cover page.
- Include or hide folders/tags.
- Include or hide page numbers.
- Document title.

Do not expose low-level font pickers, margins, arbitrary colors, or separate PDF/DOCX-only settings until real usage shows a need.

#### Preview before export

- Show template cards and a live preview of the first two or three output pages/sections.
- Render the preview from the shared document model as safe local HTML. Do not generate a new binary PDF or DOCX for every option change.
- Clearly state the scope and count above the preview: **Sequence 1 · 6 pages** or **Selected · 3 cards**.
- Preserve the user's choices if export fails so retry is one action.

### Shared export architecture

#### 1. Create a format-neutral document model

Add a module such as `export-document.ts` that converts ordered `Note[]` plus scope metadata into a normalized model:

- Document title and source label.
- Ordered note sections.
- Title, alignment, folder, tags, and optional source metadata.
- Blocks for paragraphs, headings, lists, blockquotes, code, links, line breaks, and embedded images.
- Safe plain-text fallbacks for unsupported Markdown nodes.

This becomes the only place that decides note order and interprets note content for presentation exports.

#### 2. Define templates as semantic tokens

Add `export-templates.ts` with stable template IDs and tokens for:

- Page size and margins.
- Heading/body/meta typography roles.
- Color, border, spacing, card treatment, cover treatment, headers, and footers.
- Flow mode: continuous sections or one note per page.

PDF, DOCX, and HTML preview should consume the same template and document model. Each renderer may translate a token differently, but should not redefine the template's meaning.

#### 3. Refactor PDF behind one adapter

- Move the direct PDF builder and print HTML to a shared `pdf-export` boundary.
- Preserve lazy loading so the startup bundle and PWA precache budgets do not regress.
- Add a bundled Unicode-capable font path so titles and bodies no longer degrade unsupported characters to `?`.
- Keep long-note pagination, alignment, and local embedded images.
- Decide explicitly whether **Export PDF** downloads bytes directly or opens print. Recommendation: direct download is the primary action; keep **Print** as a secondary action that uses the same template.

#### 4. Add a lazy DOCX adapter

- Add a client-side DOCX writer only in the lazy export chunk. `mammoth` remains the import reader and should not be stretched into export work.
- Map the shared roles to named Word styles so users can edit the result naturally after export.
- Use real headings, lists, links, page breaks, headers/footers, and embedded local images rather than flattening everything into paragraphs.
- Verify output in Microsoft Word and Apple Pages, then smoke-test Google Docs or LibreOffice import.
- Treat unresolved remote images as links/alt text in v1; do not make silent network requests during export.

#### 5. Route every presentation export through the same service

- Finish export.
- Selection quick export.
- Completed-sequence export.
- Any later share/publish feature.

The existing MASH bundle, board image, Markdown copy, and Markdown download flows remain separate because their purpose is portability or spatial fidelity, not document presentation.

### Delivery slices

#### Slice 1 — Model, templates, and preview (medium)

- Define the normalized document model and three template definitions.
- Build the Export sheet with format, template, shared options, scope/count, and HTML preview.
- Keep export buttons behind a temporary feature flag until at least one binary adapter is complete.

#### Slice 2 — PDF parity and consolidation (medium–large)

- Move selection, sequence, and Finish PDF through the shared model.
- Implement all three templates, Unicode, long-note pagination, embedded-image fitting, and direct download.
- Keep Print as a secondary action using the same template selection.
- Remove or deprecate duplicated formatting logic only after parity tests pass.

#### Slice 3 — DOCX export (medium–large)

- Add the lazy DOCX writer and named-style mapping.
- Implement template parity, shared options, images, lists, code, links, page breaks, and headers/footers.
- Add `.docx` download status and retry behavior to Finish and sequence export.

#### Slice 4 — Hardening and defaults (small–medium)

- Persist last-used template/page size per format.
- Add cross-application compatibility checks and sample fixtures.
- Re-run build, PWA precache, startup, and performance budgets.
- Document the supported Markdown and image behavior.

### Acceptance criteria

- PDF and DOCX expose the same three template names and shared options.
- The same scope produces the same note count and order in preview, PDF, and DOCX.
- Sequence export preserves page order exactly.
- Long notes paginate without clipped or overlapping content.
- Unicode, headings, lists, links, code, alignment, and local embedded images survive both formats to the supported level.
- DOCX content remains editable with named styles rather than positioned text boxes or flattened images.
- Export does not fetch remote assets or expose internal note IDs by default.
- Export failures preserve the draft choices and leave the desk unchanged.
- No PDF/DOCX generator code enters the initial application graph or default PWA precache.

### Tests to add or update

- Unit fixtures for the normalized document model and every supported Markdown block.
- Template-token snapshots that are independent of renderer implementation.
- PDF tests for page count, metadata, Unicode, pagination, alignment, image fitting, and each template.
- DOCX tests that unzip the package and assert document XML, styles, relationships, media, page breaks, and headers/footers.
- E2E download tests from Finish, selection, and a completed sequence.
- Cross-application manual matrix for Word, Pages, and one cloud/alternate office suite.
- Performance tests asserting that PDF and DOCX chunks load only after export intent.

## Recommended rollout

| Order | Refinement                                        | Why this order                                                                   | Rough size   |
| ----- | ------------------------------------------------- | -------------------------------------------------------------------------------- | ------------ |
| 1     | First-show potato                                 | Independent, low risk, and immediately resolves the first-impression requirement | Small        |
| 2     | Compact sticky default                            | High-frequency behavior change using systems that already exist                  | Small–medium |
| 3     | Sequence copy and visible state                   | Makes the current workflow easier before deeper controls change                  | Small        |
| 4     | Sequence end-cap and ordering refinements         | Establishes a clear handoff into presentation export                             | Medium       |
| 5     | Shared export model, picker, and PDF templates    | Creates the foundation and consolidates existing PDF paths                       | Medium–large |
| 6     | DOCX renderer and compatibility hardening         | Reuses the proven model/templates instead of inventing a parallel export feature | Medium–large |
| 7     | Drag-to-reorder sequences, if testing supports it | Optional enhancement after the simpler ordering model is validated               | Medium       |

The independent mascot and compact-editor work can ship in the same release. Sequence should establish its clearer finished-object menu before the export picker is connected. PDF templates should ship before or alongside DOCX so the template model is proven once before the second renderer is hardened.

## Definition of done across all four refinements

- The behavioral contract and user-facing copy are updated with the code.
- Keyboard, focus, reduced-motion, 200% text size, and forced-color behavior remain usable.
- Existing local-first guarantees remain intact; no export or mascot choice requires a server.
- New heavy code stays lazy and performance budgets pass.
- User-facing actions produce specific, reversible receipts or retryable status.
- The four changes feel like one direction: playful first impression, spatial everyday editing, legible ordering, and polished takeaways.
