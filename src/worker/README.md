The pg-boss worker (spec #36, ticket #40): turns a `pending` Quiz into its four Deliverables. Started from `src/instrumentation.ts` when `PUBQUIZ_WORKER=1`. May import `src/domain`, `src/repository`, `src/scripts/generate-quiz` and `src/deliver`'s interface -- the one module in the codebase allowed to cross those boundaries (CLAUDE.md "Orthogonal pipeline"). No WooCommerce knowledge lives here.

## Files

- `boss.ts` -- pg-boss instance lifecycle: `startBoss`/`stopBoss`, the `quiz-generation` queue (`createQuizQueue`), and `resolveDatabaseUrl()` (`DATABASE_URL`, falling back to the local Supabase stack's Postgres port).
- `quiz-job.ts` -- `handleQuizJob`, the job handler. Pure with respect to pg-boss: takes a `QuizJobLike` (the small subset of a pg-boss job it needs) and a `QuizJobDeps` bag, so it can be driven directly in tests without a running queue.
- `sweep.ts` -- `sweepPendingQuizzes`, the startup sweep.
- `index.ts` -- the composition root: `startWorker()` wires the repository, the deliverer and pg-boss together, registers the handler, and runs the sweep once.
- `quiz-job.integration.test.ts` -- see "Testing" below.

## The queue

One queue, `quiz-generation` (`QUIZ_QUEUE`), policy `exclusive` with the Quiz id as the job's `singletonKey`: at most one queued-or-active job per Quiz at any time, so a retry and a sweep-enqueued duplicate for the same Quiz can never coexist (`send()` returns `null` for the duplicate instead of creating a second row). Default retry policy: 3 retries, exponential backoff, 5 second base delay -- overridable per-call (`QuizQueueOverrides`) for tests.

## State machine and retry policy

A job carries just `{ quizId }`; everything else is looked up from the repository. `handleQuizJob`:

1. Loads the Quiz. If it's already `"delivered"` (a retry landing after a prior attempt's `deliverQuiz` call failed -- see step 3), skip straight to step 3, re-deriving the same file URLs from the already-recorded download token. `"delivered"` has no outgoing edge in `QUIZ_STATUS_TRANSITIONS`, so generation is never repeated once it has succeeded once.
2. Otherwise: transitions `pending` (or `failed`, on a retry after `failed`) -> `generating`, looks up the order for the billing email `generateQuiz` needs, and runs `generateQuiz` unchanged with a write callback that uploads the four Deliverables to `deliverables/<quiz id>/<file>` as they're produced. Two outcomes:
   - **Terminal failure** -- an unsatisfiable checkout configuration (`InvalidQuizConfigError`, mirrors `cli-args.ts`'s own `single_category` validation) or a sampler shortfall (`QuizShortfallError`, wrapping `generateQuiz`'s `{ok: false}` result, same "slot N, Category X, shortfall Y" wording as `scripts/generate.ts`). The Quiz moves to `failed` with that message as the reason, `deliverer.noteFailure` is called, and the job completes successfully (pg-boss never retries a terminal failure).
   - **Any other thrown error** -- treated as retryable. On any attempt before the last, the Quiz moves back to `pending` and the error is rethrown so pg-boss retries it. On the final attempt, the Quiz moves to `failed` (with the error's message) and `noteFailure` is called instead of rethrowing, so the job still completes successfully.
   - **Success** -- a crypto-random URL-safe download token is generated (`randomBytes(32).toString("base64url")`) and recorded together with the Composition id via `recordDelivery`, which also moves the Quiz to `delivered`.
3. Calls `deliverer.deliverQuiz({ quizId, files })`, `files` being the four Deliverables with URLs `<APP_BASE_URL>/download/<token>/<file>`. `deliverQuiz` is contractually idempotent (`src/deliver/index.ts`), so retrying only this step is safe. If it throws:
   - Before the last attempt: rethrow, so pg-boss retries. The Quiz stays `delivered` throughout -- only `deliverQuiz` is retried, generation is never repeated.
   - On the last attempt: log and return. The Quiz stays `delivered` with no further state change; the order the Quiz belongs to won't complete. Deciding what (if anything) reconciles that is out of scope for #40 -- see ticket #43.

### Known limitation: a crash mid-generation

If the worker process is killed (not a thrown/caught exception) while a Quiz is `generating`, and that job is later retried, `handleQuizJob` will try to transition `generating` -> `generating`, which is not a listed edge in `QUIZ_STATUS_TRANSITIONS` and throws `IllegalQuizTransitionError`. Only the `pending`-on-retry and `delivered`-on-retry cases are handled; a stale-`"generating"` reaper (e.g. treat a `generating` Quiz older than the job's `expireInSeconds` as retryable) is not part of this ticket's acceptance criteria and is left for a follow-up.

## Startup sweep

Inserting a Quiz row (the webhook, #39) and enqueueing its job are not one transaction -- the webhook uses supabase-js, pg-boss uses its own `pg` connection. `sweepPendingQuizzes` runs once at worker startup and enqueues a job for every `pending` Quiz that doesn't already have one; the queue's `exclusive` policy plus the per-job `singletonKey` makes this safe to call even when a job already exists (`send()` returns `null` for it instead of creating a duplicate).

## Environment variables

- `DATABASE_URL` -- the Postgres connection string pg-boss uses as its own store (raw `pg`, not PostgREST). Falls back to the local Supabase stack's default (`postgresql://postgres:postgres@127.0.0.1:45322/postgres`, see `supabase/config.toml`) when unset.
- `APP_BASE_URL` -- the base URL the download route is served from, used to build each Deliverable's URL. Falls back to `http://localhost:3000`.
- `PUBQUIZ_WORKER` -- set to `1` to start the worker from `src/instrumentation.ts`. Unset (the default) for `next build`, plain `next dev`, and every test suite, so none of them hold open a live pg-boss connection.

## The `pgboss` schema

pg-boss stores its own state (jobs, queues, schedules) in a `pgboss` schema it creates on first `start()`, in the *same* Postgres database as the app (`DATABASE_URL`) -- but reached over the raw `pg` wire protocol, not through Supabase's PostgREST layer the rest of the app uses. It is a separate, self-managing schema: nothing in `supabase/migrations` creates or touches it, and no repository code reads from it. `npm run db:reset` (which only replays `supabase/migrations`) does not affect it; pg-boss recreates/migrates its own schema the next time `start()` runs against the same database.

## Composition root and the deliver module

`startWorker()` (`index.ts`) calls `createDeliverer()` (`src/deliver`, ticket #41 -- not yet implemented, currently always throws) *lazily*, once per job about to run, inside the `boss.work()` callback -- never at startup. This means starting the worker never depends on #41 being done: a thrown error from `createDeliverer()` today just fails that one job, retryably, exactly like any other thrown error in the handler.

## Testing

`quiz-job.integration.test.ts` runs against the real local Supabase stack and the real engine -- nothing about sample/render is mocked. Only the pinned `Deliverer` interface is stubbed (an in-memory recorder, or a hand-written stub per test), since WooCommerce delivery is out of scope for #40.

- The deterministic cases (success, terminal shortfall) drive `handleQuizJob` directly with a hand-built `QuizJobLike`, no queue involved.
- The retry and sweep cases run a real `PgBoss` instance against a `quiz-generation` queue re-created with a fast retry policy (`retryDelay: 1`, `retryBackoff: false`) so the suite stays quick, and poll on the deliverer's own call count rather than Quiz status: `recordDelivery` moves the Quiz to `delivered` on the very first attempt, before `deliverQuiz` -- let alone its retries -- has run even once, so status alone can't signal "every retry has happened".
- Requires ffmpeg (`resolveFfmpeg()`, same skip-guard as `scripts/generate.integration.test.ts`) since it runs the real render pipeline.

Run with `npm run test:integration` (needs the local stack running and seeded, see the repository README).
