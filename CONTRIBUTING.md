# Contributing to Mash

Thanks for helping make Mash a dependable utility. Contributions should preserve its core promise: fast local intake, transparent manipulation, portable output, and no obligation to maintain another cloud workspace.

## Before proposing a feature

Describe the workflow step the change improves:

1. What material is the person bringing in?
2. What do they need to do with it?
3. What useful result should leave Mash?
4. Can the feature remain local, reversible, and lightweight?

Features that primarily turn Mash into a cloud notes service, collaboration suite, or permanent knowledge hierarchy are unlikely to fit the project direction.

## Local setup

Mash requires Node.js 22 or newer.

```bash
git clone https://github.com/jonnydry/mash-notes.git
cd mash-notes
npm ci
npm run dev
```

## Quality gates

Run the complete gate before opening a pull request:

```bash
npm run ci
```

For focused development:

```bash
npm run lint
npm run check
npm test
npm run build
npm run perf:budget
npm run test:e2e
```

Add regression tests for behavior changes. Importers and bundle parsers should include malformed, oversized, and boundary fixtures. User-facing flows should include keyboard and failure-state coverage where practical.

## Project map

- `src/routes/+page.svelte` — main application composition and workflow entry points.
- `src/lib/components/` — canvas, readers, panels, dialogs, and editing surfaces.
- `src/lib/stores/` — local application and persistence orchestration.
- `src/lib/*-import.ts` — bounded import and parsing logic.
- `src/lib/sync-file.ts` — portable bundle schema and compatibility parsing.
- `e2e/` — Playwright workflows.
- `docs/` — architecture, product behavior, and format documentation.

Read [Architecture](docs/architecture.md) before changing persistence, session lifecycle, file parsing, or the operation model.

## Pull requests

- Keep the scope narrow enough to review.
- Explain the user workflow and trade-offs, not only the implementation.
- Avoid unrelated dependency or formatting churn.
- Include screenshots for visible changes.
- State the checks that passed.
- Call out migrations, bundle-format changes, storage changes, or new network behavior explicitly.

By contributing, you agree that your contribution is licensed under the project's [MIT License](LICENSE).
