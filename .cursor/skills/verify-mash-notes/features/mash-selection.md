# Mash a selection

Mash a selection combines two stickies into one card and stores that card in IndexedDB.

## Sub-features

- `mash-select` selects two notes from Ingredients.
- `mash-confirm` asks `Mash these notes?` and completes the combine.
- `mash-stored` shows the combined card and stores its title.

## How to get to it (user POV)

- Select at least two notes, then choose `Mash` on the selection bar.
- With two notes selected and focus outside a field, press Ctrl+M or Command+M. This file drives the button.

## Driving it with verify-mash-notes

Preconditions:

- Doctor reports `http://127.0.0.1:4183`.
- The profile does not already contain `Smoke Alpha` or `Smoke Beta`.

- **Create the inputs.** Run `node .cursor/skills/verify-mash-notes/scripts/drive.mjs --feature mash`. The script creates `Smoke Alpha` with body `Alpha body` and `Smoke Beta` with body `Beta body`.
- **Select.** It opens Desk and selects those two Ingredients options. The page shows `2 selected`.
- **Mash.** It clicks the button with test id `selection-mash`. The alertdialog heading reads `Mash these notes?`. It clicks the dialog button named `Mash`.
- **Confirm.** A canvas group whose name matches `Smoke Alpha + Smoke Beta` is visible. IndexedDB contains that title. `mash-result.png` shows the card.
- **Report.** `mash.json` has `"ok": true` and the only aborted host is `example.com`.

## Gotchas

- `Mash` on the selection bar is hidden until two notes are selected. The dialog has its own `Mash` button. The script uses test id `selection-mash` for the bar and the dialog button name for the confirm.
- The welcome note is not one of the two inputs.
- Wait for the combined group. The dialog stays up until the write finishes.
