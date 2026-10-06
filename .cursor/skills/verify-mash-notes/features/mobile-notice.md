# Phone notice

At phone widths Mash shows a notice that the desk is for a larger screen. The dock is not mounted.

## Sub-features

- `mobile-375` checks a 375 by 812 viewport with touch emulation.
- `mobile-390` checks a 390 by 844 viewport with touch emulation.
- `mobile-fit` requires no horizontal overflow and keeps the heading inside the viewport.

## How to get to it (user POV)

- Open Mash in a browser whose CSS width is 960px or less. 375 and 390 are the widths this file drives.

## Driving it with verify-mash-notes

Preconditions:

- Doctor reports `http://127.0.0.1:4183`.
- The drive creates a new profile for each width.

- **Open both widths.** Run `node .cursor/skills/verify-mash-notes/scripts/drive.mjs --feature mobile`.
- **375.** The viewport is 375 by 812 with `hasTouch` and `isMobile`. The element `mobile-desktop-notice` is visible. The heading reads `Mash is currently optimized for desktop use.` The Mash dock is absent. The heading and the notice card sit inside the viewport. `scrollWidth` is not greater than `clientWidth`. The script taps the heading and the heading remains. `mobile-375.png` shows the notice.
- **390.** The same checks run at 390 by 844. `mobile-390.png` shows the notice.
- **Controls.** Every visible button, link, or field must be inside the viewport and at least 44 by 44 CSS pixels. This notice has none. `mobile.json` records `controlCount` as `0` for each width.
- **Report.** `mobile.json` has `"ok": true`. Each width records the probe abort for `example.com` and no other aborted host.

## Gotchas

- Do not look for `New note` at these widths. The desk is not mounted.
- A landscape check is a different size. This file drives portrait 375 by 812 and 390 by 844.
- Touch emulation is required. A desktop mouse at a narrow width is not this proof.
