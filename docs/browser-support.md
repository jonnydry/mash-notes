# Browser support

Mash is a static progressive web app. Baseline workflows rely on broadly available browser APIs, while installation, folder picking, clipboard behavior, and operating-system integration vary by browser.

## Support policy

| Surface                     | Policy                                                                          |
| --------------------------- | ------------------------------------------------------------------------------- |
| Current Chromium desktop    | Primary automated E2E target                                                    |
| Current Firefox desktop     | Automated core smoke flow plus documented manual fallbacks                      |
| Current Safari desktop      | Automated WebKit core smoke flow; file and clipboard capabilities may differ    |
| Installed Chromium PWA      | Supported where installability criteria are met                                 |
| Mobile Safari and Chromium  | Responsive intake and desk workflows; large spatial tasks are better on desktop |
| Embedded or in-app browsers | Best effort                                                                     |

"Current" means a browser version still supported by its vendor. Security fixes and correctness take priority over compatibility with obsolete versions.

## Baseline fallbacks

- If clipboard write is unavailable, Download Markdown remains available.
- If folder picking is unavailable, import individual files or a supported exported folder selection.
- If print is blocked, retry through the browser's print UI or use Markdown export.
- If installation is unavailable, Mash remains usable as an ordinary website.
- If persistent storage cannot be granted, kept work remains browser-local and export remains the durable escape path.
- If offline assets have not been cached yet, the first load still requires access to the static host.

## Release smoke flow

Before a tagged release, verify at minimum:

1. Open a clean desk.
2. Paste multi-line text and create multiple cards.
3. Drop or pick one supported document and one supported image.
4. Select, transform, undo, and redo or Unmash.
5. Copy and download Markdown.
6. Export and re-import a desk bundle, then create and preview a workspace backup.
7. Reload after the application has been cached and confirm the desk remains available.
8. Exercise storage and export failure fallbacks where the browser permits simulation.

CI runs the complete end-to-end suite in Chromium and the core create → Mash → export → import smoke flow in Firefox and WebKit.
