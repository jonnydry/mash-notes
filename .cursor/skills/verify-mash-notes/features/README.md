# Mash verification map

This directory is the maintained source for verifying Mash from the user's point of view. Read this index, then use the matching feature file.

## Baseline preconditions

- The repo is `mash-notes` and the working directory is the repository root.
- Node.js is 22 or newer. Dependencies came from `npm ci`.
- `npm run build` has written `build/index.html`.
- `node .cursor/skills/verify-mash-notes/scripts/launch.mjs` is serving `http://127.0.0.1:4183`.
- `node .cursor/skills/verify-mash-notes/scripts/doctor.mjs` printed `doctor ok` for that pid.
- Mash has no account and no server database. A drive creates a new Chromium profile under `/tmp/verify-mash-notes/profiles/` and deletes it before the process exits. IndexedDB `mashdb-notes-v1` starts empty except for the seeded welcome note `Hi — I'm Scoop`.
- Do not drive a preview this run did not start.

## Driving conventions

- Start from the baseline state unless the feature file says otherwise.
- Prefer the accessible names in the feature file. Use a test id only where the file names one.
- Run one feature command at a time. Each command uses its own profile.
- A phone width is not a small desk. At 375 and 390 the app shows the desktop notice and hides the dock.
- Leave files in `.cursor/skills/verify-mash-notes/runs/`, or in `VERIFY_MASH_NOTES_EVIDENCE_DIR` when that variable is set. Cleanup removes `/tmp/verify-mash-notes` only.

## Proof and skip reporting

- Capture the action and the state after it. A final screenshot alone is not proof.
- For a saved note, show the card, then show that note again after reload, and read the title back from IndexedDB.
- Record the feature id on the json report written beside the screenshots.
- If a command cannot run, report the command and the unmet precondition. Do not mark a different feature as a substitute.

## Feature entry contract

Each feature file starts with an H1 and one paragraph. It then uses these H2 sections in order.

1. `Sub-features`
2. `How to get to it (user POV)`
3. `Driving it with verify-mash-notes`
4. `Gotchas`

## Features

- [Create a note](./create-note.md) saves a title and body and shows them again after reload.
- [Search notes](./search.md) finds the welcome note and shows an empty result.
- [Mash a selection](./mash-selection.md) combines two notes into one card.
- [Finish the desk](./finish.md) opens the finish dialog and closes it.
- [Phone notice](./mobile-notice.md) checks 375 and 390 with touch emulation.
