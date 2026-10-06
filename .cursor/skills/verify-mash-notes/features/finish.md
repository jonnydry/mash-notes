# Finish the desk

Finish opens the desk panel that describes what can leave the desk, then closes without exporting.

## Sub-features

- `finish-open` opens the dialog named `Finish this desk`.
- `finish-close` dismisses it with `Close desk panel`.

## How to get to it (user POV)

- Choose `Finish` in the header while a desk is active.

## Driving it with verify-mash-notes

Preconditions:

- Doctor reports `http://127.0.0.1:4183`.
- The seeded desk is active, so `Finish` is in the header.

- **Open.** Run `node .cursor/skills/verify-mash-notes/scripts/drive.mjs --feature finish`. The script clicks `Finish`. The dialog named `Finish this desk` is visible. `finish-open.png` shows it.
- **Close.** The script clicks `Close desk panel`. The dialog is hidden.
- **Report.** `finish.json` has `"ok": true` and the only aborted host is `example.com`.

## Gotchas

- This path does not download a file. An export would be a different proof.
- `Finish` is omitted when no desk is active. Wait for the welcome note before looking for the button.
