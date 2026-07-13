# Globe Mode: Product and Technical Exploration

## Recommendation

Build Globe as a **non-destructive alternate view** of the current canvas, using a small, isolated Three.js renderer. Keep the flat canvas as the canonical layout and editing surface. On the globe, represent notes as compact pins or seeds, bowls as soft territories, and only show a full note in a normal screen-space panel after selection.

The recommended product direction is a **constellation globe**: at a distance it reads as a calm dotted planet; as the user zooms in, bowls, note titles, sequences, and selected notes progressively reveal themselves. This is more useful and more performant than wrapping full DOM note cards around a sphere.

## Why it fits Mash

Mash already has most of the domain model Globe needs:

- `CanvasItem.x/y` provide stable source positions.
- Bowls provide explicit, named grouping rather than requiring clustering to be guessed.
- Sequences provide optional edges that can become arcs on the globe.
- The board already supports pan, zoom, fit, selection, and persisted per-canvas view state.
- The current canvas renders ordinary DOM cards in one transformed plane, so Globe can remain a separate renderer without changing note storage or layout operations.

The important product boundary is that Globe should initially be for **viewing, navigating, selecting, and opening**, not for editing text or freely rearranging notes in 3D.

## Three visual directions

### 1. Seed Planet

The sphere is made from Mash's existing dot matrix. Each note replaces one grid dot with a slightly larger warm seed/pin. Selected notes glow with the existing green accent. Hovering a seed reveals a small title label; clicking opens the note in the current editor stage.

This is the purest novelty direction and the easiest to understand. It works beautifully with 20–300 notes, but provides less visible structure for large sets unless level-of-detail behavior is added.

### 2. Bowl Archipelago

Each bowl becomes a translucent, irregular region on the sphere, like a continent or atmospheric patch. Bowl labels sit just above the surface with a count. Notes within a bowl appear as local settlements; ungrouped notes become small satellites or isolated points.

This makes the existing bowl concept feel surprisingly natural. The risk is visual metaphor overload: literal continents, borders, flags, or map styling would fight Mash's quiet paper-and-ink personality. Regions should therefore be soft washes, not geography.

### 3. Constellation Globe (recommended)

At the far zoom level, each bowl is a larger cluster marker and ungrouped notes are individual points. As the user approaches, clusters bloom into note pins, labels fade in, and sequence links appear as restrained arcs above the surface. The selected note receives a small screen-space preview, while double-click/Enter opens the existing stage editor.

This direction gracefully handles both small playful canvases and the rare huge canvas that motivated the idea. It also gives a clear performance strategy: render detail only when it is useful.

## Interaction model

### Entry

Add **Globe** to the existing View menu. It should be an explicit view toggle, not a third permanent top-level canvas mode beside Free and Snap.

On entry:

1. Existing note cards soften, shrink toward their centers, and fade.
2. Matching globe pins rise from those centers while the dot grid bends toward a sphere.
3. The camera eases back slightly as the final sphere settles.

The transition should take about 700–900 ms and be interruptible. With reduced motion enabled, use a short crossfade with no spatial morph.

### Navigation

- Drag: rotate the globe with gentle inertia.
- Wheel or pinch: zoom toward the pointer.
- Double-click/tap a region: focus that bowl or cluster.
- Click/tap a pin: select and show its title/compact preview.
- Double-click or Enter on a selected pin: open the note in the existing stage editor.
- Escape: close preview, then exit focused region, then exit Globe.
- `Fit`: restore the whole globe.
- Optional slow idle drift starts only after a few seconds and stops immediately on interaction.

Do not allow unconstrained camera pan in the first version. Rotation plus dolly keeps the sphere from getting lost and avoids conflicting with the flat canvas gesture model.

### Exit

Reverse the same mapping. Globe pins travel toward the current flat-card centers, the sphere relaxes into the dot plane, and the DOM cards fade back in. Preserve globe rotation/zoom separately from the current flat viewport so switching modes never disturbs either view.

## Node and region design

### Notes

Use a shared low-poly seed, rounded pin, or shallow puck geometry. Avoid tiny full note cards: text becomes unreadable on the back half of the sphere, DOM/textured cards are expensive, and the result quickly resembles a 3D file browser rather than Mash.

State can be expressed without adding new visual language:

- Normal note: warm neutral seed.
- Selected: existing Mash green halo.
- Pinned: brighter cap or tiny top notch.
- Mash result: subtle double ring, echoing the current `◎` marker.
- Kept vs desk scope: a quiet material/value shift, visible only near the globe.
- Image/source notes: optional small center glyph at the nearest level of detail.

### Bowls

Use one of two representations depending on zoom:

- Far: a single larger bowl marker with name and count.
- Near: a soft translucent cap/wash beneath its member notes.

The first implementation should derive each region from its members rather than building arbitrary polygonal continents. A spherical convex hull or a set of overlapping translucent discs is enough to create the territory effect.

### Sequences

Render sequence edges only when a sequence is selected or the camera is close. Use thin arcs lifted slightly above the surface with restrained arrowheads. Showing all edges at all times would turn the globe into a hairball.

## Mapping the flat canvas to the sphere

The flat layout stays authoritative. Normalize item centers within the overall canvas bounds:

```text
u = (centerX - minX) / width
v = (centerY - minY) / height
longitude = (u - 0.5) * 2π
latitude  = (0.5 - v) * π * 0.82

x = R * cos(latitude) * sin(longitude)
y = R * sin(latitude)
z = R * cos(latitude) * cos(longitude)
```

The `0.82` latitude factor leaves breathable polar caps and reduces crowding. This mapping preserves broad left/right and top/bottom relationships, but it introduces a longitude seam. Pick the seam through the largest empty horizontal gap in the source layout rather than fixing it at the canvas edge.

For a bowl, compute the spherical center from the normalized centroid of its members. At far zoom, collapse members toward that center; at near zoom, interpolate them back to their mapped positions. This produces the cluster “bloom” without changing stored coordinates.

For extremely sparse or pathological layouts, fall back to deterministic Fibonacci-sphere distribution while keeping bowl members adjacent. The mapping mode must remain deterministic for a given canvas so notes do not jump between visits.

## Rendering options

| Approach | Strengths | Weaknesses | Verdict |
|---|---|---|---|
| CSS 3D transforms | Reuses DOM and Svelte event handling; quick for a tiny spike | Poor occlusion, many composited layers, awkward back-face behavior, full cards become illegible | Useful only for an early visual experiment |
| Canvas 2D with custom sphere projection | Small dependency footprint; total visual control | Manual depth sorting, picking, camera math, clipping, and effects; becomes a home-grown 3D engine | Not worth the maintenance |
| PixiJS | Excellent high-volume 2D rendering and custom shaders | Its perspective mesh is still fundamentally 2D; true orbiting, depth, and spherical picking require custom work | Better for a warped-disc illusion, not this feature |
| Three.js directly | Mature camera, raycasting, instancing, lines, shaders, and controls; easy to isolate | Imperative lifecycle must be bridged carefully into Svelte | **Recommended** |
| Threlte on Three.js | Svelte-native composition and interactivity; attractive if 3D becomes a product platform | Adds an abstraction and more packages for one isolated scene; may encourage component-per-node rendering | Reconsider if Globe grows beyond one renderer |

Three.js already supplies the pieces this concept needs: `OrbitControls` for rotation/dolly, `Raycaster` for picking, `InstancedMesh` for many repeated note nodes, and `Points` for the background dot sphere. Its WebGL renderer now targets WebGL 2. Threlte is compatible with Svelte 5 and wraps the same scene graph, but the current Mash canvas is already interaction-heavy and imperative; a direct adapter is the smaller architectural commitment.

Official references:

- https://threejs.org/docs/pages/OrbitControls.html
- https://threejs.org/docs/pages/InstancedMesh.html
- https://threejs.org/docs/pages/Raycaster.html
- https://threejs.org/docs/pages/Points.html
- https://threejs.org/docs/pages/WebGLRenderer.html
- https://threlte.xyz/docs/learn/getting-started/introduction
- https://pixijs.com/8.x/guides/components/scene-objects/mesh

## Proposed architecture

Keep 3D concerns outside `CanvasBoard.svelte`:

```text
CanvasBoard
  ├─ FlatCanvasLayer (current cards, bowls, flows)
  ├─ GlobeCanvasLayer (lazy-loaded, WebGL)
  └─ CanvasChrome (view toggle and shared actions)

GlobeCanvasLayer
  ├─ globe-layout.ts       flat → spherical deterministic layout
  ├─ globe-scene.ts        renderer, camera, controls, materials
  ├─ globe-picking.ts      raycast instance → canvas item
  ├─ globe-transition.ts   plane/sphere interpolation
  └─ GlobeOverlay.svelte   selected-note label/preview and a11y surface
```

`GlobeCanvasLayer` receives plain data (`items`, `bowls`, `edges`, note display metadata, selection) and emits semantic events (`select`, `open`, `focusBowl`). It must not write note or canvas positions in the first version.

Lazy-load Three.js only when Globe is first entered so the normal note-taking path pays no bundle or initialization cost. Pause the render loop when Globe is hidden, the tab is backgrounded, and the scene is settled. Render on demand during interaction/animation rather than running at 60 fps forever.

## Level of detail and scale

The renderer should have three distance bands:

| Distance | Visible detail |
|---|---|
| Orbit | Dot sphere, bowl clusters/counts, selected pin |
| Explore | Individual note pins, bowl washes, hovered title |
| Inspect | Nearby labels, selected preview, relevant sequence arcs |

Use one `InstancedMesh` per visual class/material, not one Three.js mesh per note. `Raycaster` reports the selected `instanceId`, which maps back to a canvas item. Use a point cloud for ambient grid dots. Keep text in a sparse DOM overlay rather than generating a texture for every title.

Suggested initial targets, to be validated on desktop and mobile:

- 1,000 notes at 60 fps during orbit on a normal laptop.
- 5,000 note pins with labels disabled and cluster LOD active.
- No more than a handful of live DOM labels at once.
- One draw call per node visual class plus a small number for regions/arcs.
- Respect `prefers-reduced-motion` and a user-facing “Reduce globe effects” fallback if needed.

## Accessibility and fallback

WebGL is not a semantic UI. Keep an off-screen/list-based representation of the visible or selected nodes for keyboard and assistive technology use. Arrow keys can rotate, `+/-` can zoom, Tab can move among visible bowl clusters, and Enter can open the focused selection.

If WebGL 2 initialization fails, keep the flat canvas active and disable Globe with a brief explanation. Never make Globe the only way to reach or edit content.

On small screens, begin with bowl/cluster navigation and reveal individual pins only after focusing a region. This is more usable than trying to tap thousands of tiny points.

## Delivery plan

### Phase 0 — Throwaway visual spike (1–2 days)

- Add no persistence and no production toggle.
- Render 100–1,000 generated pins on a dotted sphere.
- Test drag rotation, pinch/wheel zoom, raycast selection, and dark/day themes.
- Compare direct Three.js with a minimal Threlte scene only if lifecycle integration feels unusually awkward.
- Decide the final node silhouette, globe radius, and morph timing from a recorded prototype.

Exit criterion: the globe feels like Mash, selection is reliable, and 1,000 nodes orbit smoothly.

### Phase 1 — Read-only Globe MVP (3–5 days)

- Add the View → Globe toggle and lazy load.
- Deterministically map real canvas items to the sphere.
- Implement rotate, zoom, fit, hover, selection, and open-in-stage.
- Persist `{rotation, cameraDistance}` separately per canvas.
- Add reduced-motion entry/exit and WebGL fallback.
- Add unit tests for layout determinism, seam selection, and item-instance mapping.

Exit criterion: users can enter, find a note, open it, and return without any flat layout movement or lost selection.

### Phase 2 — Bowls and the useful version (3–5 days)

- Add far-zoom bowl cluster markers and near-zoom region washes.
- Implement focus-bowl and cluster bloom.
- Add sparse, collision-aware DOM labels.
- Tune small-screen gestures and hit areas.

Exit criterion: a several-hundred-note canvas is easier to navigate by bowl than in the fully fitted flat view.

### Phase 3 — Sequences and polish (2–4 days)

- Add selected/nearby sequence arcs.
- Refine card-to-pin morph and reverse transition.
- Add idle drift, only if it remains calm and stops instantly.
- Capture performance budgets and end-to-end interaction tests.
- Add a debug overlay for draw calls, visible instances, and frame time in development only.

### Later, only if Globe proves useful

- Drag a note between bowl regions using ray-to-sphere intersection.
- Search that rotates/focuses the matching note.
- Optional semantic clustering for un-bowled notes.
- Shareable globe orientation or guided “tour” of selected notes.

Do not start with these. Editing spatial membership on a sphere introduces much harder undo, discoverability, and accessibility problems than viewing does.

## Decisions to lock before implementation

1. **Node metaphor:** seed/pin is recommended over miniature card.
2. **Primary direction:** constellation LOD is recommended over showing every note equally at all times.
3. **Editing boundary:** read/select/open only for MVP.
4. **Renderer:** direct Three.js, lazy-loaded.
5. **Position source:** deterministic projection of existing `CanvasItem.x/y`; no new globe coordinates in storage.
6. **Bowls:** cluster marker at distance, soft region nearby.
7. **Sequences:** contextual arcs only.

## Main risks

- **The seam splits a bowl.** Choose the seam from the largest empty gap and allow a bowl-aware adjustment.
- **The globe becomes visual noise.** Enforce distance-based detail and contextual edges.
- **DOM and WebGL gestures fight.** Globe owns the surface while active; screen-space overlay controls must stop propagation.
- **The normal app gets heavier.** Lazy-load the renderer and keep Three.js out of the initial route chunk.
- **The morph looks disconnected.** Begin each pin at the actual screen-space center of its source card and crossfade during the projection change.
- **Accessibility regresses.** Treat the WebGL scene as visualization and preserve semantic keyboard/list access beside it.

## Suggested first prototype

Prototype the recommended Constellation Globe with three real states in one scene:

1. Whole-globe orbit with bowl counts.
2. Focused bowl with individual pins and a few labels.
3. Selected note with a compact screen-space preview and Open action.

That single prototype will answer the highest-risk questions—whether it feels like Mash, whether bowls make sense as regions, whether the node representation is legible, and whether the novelty survives contact with hundreds of notes—before production architecture is committed.
