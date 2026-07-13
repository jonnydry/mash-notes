# Bowl drag interaction audit

## Audit scope

The distinction between moving an entire bowl and rearranging one card inside it, tested in the Mash in-app browser at 1159 × 831.

## User goal and accessibility target

Users should predict which objects will move before beginning a pointer drag. The same surfaces should have descriptive names and visible cursor/hover cues.

## Steps and evidence

1. **Current bowl — needs clarification**  
   Evidence: `01-current.png`  
   The bowl can be selected, but moving it requires the indirect sequence “select bowl, then drag a selected card.” The card and bowl surfaces do not communicate different movement scopes.

2. **Refined resting state — healthy**  
   Evidence: `02-refined.png`  
   A grip appears in the bowl label and the empty bowl surface uses a grab cursor. Cards retain their established card affordance.

3. **Bowl engaged — healthy**  
   Evidence: `03-hover-guidance.png`  
   A concise guidance chip states the rule: empty bowl space moves all cards; dragging a card rearranges it.

4. **Whole bowl dragged — healthy**  
   Evidence: `04-bowl-moved.png`  
   All three cards translate by the same delta and preserve their arrangement. The bowl bounds follow them.

5. **Card dragged inside bowl — healthy**  
   Evidence: `05-card-rearranged.png`  
   Only the grabbed card moves; the other members remain fixed and the bowl reshapes around the new arrangement.

## Strengths

- Spatial gesture mapping is now direct: bowl surface means bowl movement, card surface means card movement.
- The grip, grab/grabbing cursors, title text, and guidance chip reinforce the same rule.
- Existing selection, rename, dissolve, and layout controls remain unchanged.

## Accessibility risks and limits

- Pointer semantics and accessible labels were inspected, but screenshots alone cannot prove keyboard-equivalent spatial movement or screen-reader announcement quality.
- The guidance chip is supplementary and intentionally hidden from assistive technology; the bowl control itself carries the full drag instruction in its accessible name and title.
- Color contrast was visually checked against the existing Mash theme, not measured as a full WCAG conformance claim.

## Recommendation

Keep this two-surface rule stable across future bowl actions. If keyboard movement is added later, expose it from the bowl label rather than overloading card keyboard behavior.
