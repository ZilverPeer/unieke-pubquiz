Scripts: the only composer module — it may import `src/domain`, `src/sample`, `src/repository`, and `src/render` together, wiring them into runnable entry points (e.g. the local dev generation script). No other module may import from `src/scripts`.

`--retry-quiz`/`--composition` (ticket #42, below) are a deliberate, narrow exception: `generate.ts` also imports `@/worker` (pg-boss lifecycle, to re-enqueue a Quiz's job the same way the worker's own sweep does) and `@/deliver` (the pinned `Deliverer` interface, to re-attach re-rendered Deliverables). `src/worker` already imports from `src/scripts` the other way (`generate-quiz.ts`, see its own README "the one module allowed to cross those boundaries"), so this adds a second, equally narrow crossing rather than a new kind of coupling.

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

- `generate.ts` — entry point: parse argv (`parseScriptArgs`), dispatch to one of the three commands below, print, set the exit code. Owns the file-writing boundary (`writeDeliverables`) for `generate` and hands it to `generateQuiz`. No pipeline logic lives here.
- `cli-args.ts` — pure `parseGenerateArgs(argv): GenerateOptions` (a `QuizRequest` plus `seed`/`out`), and `parseScriptArgs(argv): ScriptCommand`, which dispatches to `{ kind: "generate" | "retry-quiz" | "composition" }` -- `parseGenerateArgs` stays the single-command entry point existing callers use directly.
- `assemble-quiz-content.ts` — pure `assembleQuizContent(composition, locale, entriesById, downloads): Promise<QuizContent>`, where `downloads` is the `{ picture(path); music(path) }` boundary the repository's Storage downloads are injected through.
- `generate-quiz.ts` — `generateQuiz(options, repository, writeDeliverables): Promise<GenerateQuizResult>`, the orchestration: load pool + exclusions → sample → assemble → render all four → `writeDeliverables(files)` → persist. Persisting is literally the last effect: if `writeDeliverables` rejects, `persistComposition` is never called. No `process.exit` here. Also exports `renderQuizFiles(quizContent): Promise<GeneratedQuizFiles>`, the rendering step alone, reused by `recompose-quiz.ts` for `--composition` (no sampling, no persisting).
- `retry-quiz.ts` — `retryQuiz(quizId, deps): Promise<RetryQuizResult>`, ticket #42's `--retry-quiz` flag. See below.
- `recompose-quiz.ts` — `recomposeQuiz(compositionId, deps): Promise<RecomposeQuizResult>`, ticket #42's `--composition` flag. See below.

## `--retry-quiz <id>`: move a `failed` Quiz back to `pending` and re-enqueue it

```sh
npx tsx src/scripts/generate.ts --retry-quiz <quiz id>
```

Looks the Quiz up, refuses (exit code 1, nothing changed) if it isn't currently `failed`, otherwise transitions it to `pending` (`transitionQuizStatus`) and sends its generation job to the `quiz-generation` queue with the Quiz id as `singletonKey` -- exactly like the worker's own startup sweep (`src/worker/sweep.ts`), so a job that already exists (e.g. the worker hasn't picked up the `failed → pending` transition's own path yet) is never duplicated. Starts and gracefully stops its own pg-boss instance (`@/worker`'s `startBoss`/`stopBoss`) around the one `send()` call; the worker process, if running, picks the job up on its own next poll.

`retryQuiz` itself takes an injected `enqueue(quizId): Promise<string | null>` rather than a `PgBoss` instance directly, so tests can drive it without a running queue.

## `--composition <id>`: re-render an existing Composition's Deliverables

```sh
npx tsx src/scripts/generate.ts --composition <composition id>
```

Loads the Composition by id (`getCompositionById` — no re-sampling, no new `compositions` row), finds the Quiz that owns it (`getQuizByCompositionId`), re-renders all four Deliverables through the same `assembleQuizContent` → `renderQuizFiles` path `generateQuiz` uses, re-uploads them to `deliverables/<quiz id>/<file>` (overwriting the prior ones, `upsert: true` — see `src/repository/README.md`), and re-attaches them via the pinned `Deliverer` interface, rebuilding each file's download URL from the Quiz's own (still-valid) download token.

Refuses (exit code 1, nothing uploaded) when the Composition doesn't exist, has no owning Quiz, or the Quiz's download token has already been cleared by the daily pruning job (ticket #42's `prune.ts`) -- there's no valid download URL to hand the deliverer in that case; re-delivering a pruned Quiz is out of scope here.

`createDeliverer()` (`src/deliver`, ticket #41) still throws until that ticket lands. The real invocation calls it lazily -- only after the upload has already succeeded -- and catches specifically that "not implemented yet" error to print a message instead of crashing, so `--composition` is already usable today for re-rendering and re-uploading even though delivery isn't wired up yet. Tests inject a fake `Deliverer` directly instead (`recomposeQuiz`'s `createDeliverer` dependency).

### Tests

- `cli-args.test.ts`, `assemble-quiz-content.test.ts`, `generate-quiz.test.ts`, `retry-quiz.test.ts`, `recompose-quiz.test.ts` — unit, no DB (`npm test`). `generate-quiz.test.ts` proves the write-before-persist ordering by injecting a failing `writeDeliverables` and asserting `persistComposition` was never called; it renders for real (including the ffmpeg-driven music round), so it skips like `src/render/music-round-mp3.test.ts` does when `resolveFfmpeg()` is `null`. `retry-quiz.test.ts`/`recompose-quiz.test.ts` only exercise the pure decision logic (status checks, refusal paths) against fakes -- no rendering, so no ffmpeg dependency.
- `generate.integration.test.ts` — runs against the real local stack (`npm run test:integration`, after `supabase start && npm run db:reset`), including one real CLI invocation (spawned via `node --import tsx`) so the argv path and exit codes are exercised for real. Deletes every Composition it creates in `afterEach`. ffmpeg-dependent assertions skip the same way `src/render/music-round-mp3.test.ts` does when `resolveFfmpeg()` is `null`.
- `recompose-quiz.integration.test.ts` — `recomposeQuiz` driven directly (not through the CLI) against the real stack and a fake `Deliverer`, so it can assert the fake was called once with all four files, without waiting on ticket #41.
- `reprocess-cli.integration.test.ts` — `--retry-quiz`/`--composition` driven through the real spawned CLI process, including the real (still-throwing) `createDeliverer()` for `--composition`, proving the "uploaded, delivery not implemented yet" message end to end.
