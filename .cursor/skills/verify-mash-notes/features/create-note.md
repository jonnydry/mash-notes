# Create a note

Create a note lets a person add a titled sticky on the desk and see that same sticky after a reload.

## Sub-features

- `create-open` opens a sticky from the `New note` button.
- `create-save` stores the title and body in IndexedDB `mashdb-notes-v1`.
- `create-reload` shows the note in Ingredients after a reload.

## How to get to it (user POV)

- Choose `New note` in the Mash dock.
- Press Ctrl+N, or Command+N on macOS, while the desk is open.
- Type a letter while the page body has focus. That starts a sticky whose body begins with that letter. It is not the path this file drives.

## Driving it with verify-mash-notes

Preconditions:

- Doctor reports `http://127.0.0.1:4183`.
- The profile is new, so Ingredients contains `Hi — I'm Scoop` and does not contain `Release checklist`.

- **Open the desk.** Run `node .cursor/skills/verify-mash-notes/scripts/drive.mjs --feature create-note`. The Mash dock is visible and Ingredients shows `Hi — I'm Scoop`. `create-note-boot.png` shows that desk.
- **Check the control.** `New note` is inside the 1280 by 800 viewport and is at least 44 by 44 CSS pixels. The script clicks it.
- **Enter the note.** The expanded card title becomes `Release checklist` and the body becomes `Tag and publish`.
- **Confirm the write.** IndexedDB `mashdb-notes-v1` contains that title and body before the card collapses. The canvas group name contains `Release checklist`. `create-note-saved.png` shows the card.
- **Reload.** The script reloads the origin, opens Desk, and finds an Ingredients option containing `Release checklist`. IndexedDB still has the same title and body. `create-note-reloaded.png` shows that list.
- **Report.** `create-note.json` has `"ok": true`, empty console, page, and network errors, and one aborted host, `example.com`.

## Gotchas

- A fresh profile seeds `Hi — I'm Scoop`. That note is not `Release checklist`.
- The title reaches IndexedDB on a short debounce. Wait for the stored note, not for the input you just filled.
- The group accessible name can include `, selected`. Match the title as a substring.
- Phone widths do not show `New note`. Use the phone notice feature for 375 and 390.
