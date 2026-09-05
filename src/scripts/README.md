Scripts: the only composer module — it may import `src/domain`, `src/sample`, `src/repository`, and `src/render` together, wiring them into runnable entry points (e.g. the local dev generation script). No other module may import from `src/scripts`.

The package is ESM (`"type": "module"` in package.json) so that `tsx` loads `@react-pdf/renderer` through its `import` export conditions; the CommonJS path fails with `ERR_PACKAGE_PATH_NOT_EXPORTED` on `@react-pdf/hyphenate/en-us`. Scripts run with `tsx` (`npm run generate`), never with plain `node`.

## `generate`: local dev end-to-end Quiz generation

Loads the pool and exclusions for one billing email from the local database, samples a Composition, renders all four Deliverables, writes them to an output folder, and persists the Composition. This is the manual end-to-end check for the whole engine (spec #1) before any storefront exists.

```sh
npx tsx src/scripts/generate.ts --locale nl|en --mode mixed|single_category --difficulty easy|medium|hard|mixed --email <billing email> [--pick <slot>=<categoryId>]... [--seed <int>] [--out <dir>]
```

`npx tsx src/scripts/generate.ts ...` is the canonical invocation and works the same everywhere. `npm run generate -- ...` is a shortcut for the same command, but on Windows with npm 11 a single `--` does not reliably forward flags to the script (npm swallows them; you'd see e.g. `Unknown argument "nl"`) -- use a second `--` there: `npm run generate -- -- --locale nl ...`.

- `--pick <slot>=<categoryId>` assigns a Category id (the stringified bigint id from the database) to one of the 8 slots (0-7). Repeatable. `single_category` mode takes exactly one `--pick` (used for every slot); `mixed` mode honours each given pick and randomizes the rest.
- `--seed` defaults to a random 32-bit integer and is always printed -- on both success and failure -- so any run can be reproduced exactly.
- `--out` defaults to `content/generated/<yyyymmdd-hhmmss>-<locale>/` (`content/` is gitignored — generated output never enters git).
- Connects using `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` from the environment, falling back to running `supabase status -o env` itself (`resolveLocalStackConfig`, re-exported from `src/repository`, documented there as local-dev only). Requires the local stack to be up and seeded: `supabase start && npm run db:reset` (see `supabase/README.md`).

### Example commands

```sh
npx tsx src/scripts/generate.ts --locale nl --mode mixed --difficulty mixed --email demo-nl@example.com --seed 42
npx tsx src/scripts/generate.ts --locale en --mode single_category --pick 0=1 --difficulty mixed --email demo-en@example.com --seed 42
```

### Output

On success, four fixed-name files plus one inspection file, all written to `--out`:

- `quizmaster.pdf`, `picture-handout.pdf`, `answer-sheet.pdf`, `music-round.mp3` — the four Deliverables.
- `composition.json` — the persisted `CompositionRecord` plus its `compositionId`, for inspection.

The Composition is persisted last, after every Deliverable has been written, so a render or write failure never consumes Items that a customer could otherwise still receive.

### Failure behaviour

If the request can't be filled — not enough eligible Items for a slot, or (in `mixed` mode) not enough distinct Categories left to assign — generation hard-fails: two lines to stderr,

```
Generation failed: slot <n>, Category <name or id, or "none">, shortfall <k>
Seed: <seed>
```

exit code 1, nothing written to `--out`, and no Composition persisted.

### File layout

- `generate.ts` — entry point: parse argv, run, print, set the exit code. Owns the file-writing boundary (`writeDeliverables`) and hands it to `generateQuiz`. No pipeline logic lives here.
- `cli-args.ts` — pure `parseGenerateArgs(argv): GenerateOptions` (a `QuizRequest` plus `seed`/`out`).
- `assemble-quiz-content.ts` — pure `assembleQuizContent(composition, locale, entriesById, downloads): Promise<QuizContent>`, where `downloads` is the `{ picture(path); music(path) }` boundary the repository's Storage downloads are injected through.
- `generate-quiz.ts` — `generateQuiz(options, repository, writeDeliverables): Promise<GenerateQuizResult>`, the orchestration: load pool + exclusions → sample → assemble → render all four → `writeDeliverables(files)` → persist. Persisting is literally the last effect: if `writeDeliverables` rejects, `persistComposition` is never called. No `process.exit` here.

### Tests

- `cli-args.test.ts`, `assemble-quiz-content.test.ts`, `generate-quiz.test.ts` — unit, no DB (`npm test`). `generate-quiz.test.ts` proves the write-before-persist ordering by injecting a failing `writeDeliverables` and asserting `persistComposition` was never called; it renders for real (including the ffmpeg-driven music round), so it skips like `src/render/music-round-mp3.test.ts` does when `resolveFfmpeg()` is `null`.
- `generate.integration.test.ts` — runs against the real local stack (`npm run test:integration`, after `supabase start && npm run db:reset`), including one real CLI invocation (spawned via `node --import tsx`) so the argv path and exit codes are exercised for real. Deletes every Composition it creates in `afterEach`. ffmpeg-dependent assertions skip the same way `src/render/music-round-mp3.test.ts` does when `resolveFfmpeg()` is `null`.
