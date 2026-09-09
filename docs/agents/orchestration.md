# Orchestration playbook

How the main session runs a ticket from dispatch to merge. Written after the spec #1 retrospective (`docs/logbook/2026-09-06-retrospective-spec-1.md`); every rule here traces to a measured cost or a caught defect. The main session designs, dispatches, reviews and merges. Sonnet subagents write code and run reviews. Review depth is not negotiable; verification churn is.

## Roles

| Role | Model | Owns |
|---|---|---|
| Orchestrator (main session) | user's model | ticket brief, interface pinning, stack lifecycle, merge, logbook |
| Implementer | Sonnet | one ticket on one branch in one worktree (`../Pubquiz-wt-<n>`), the PR, every fix round on that PR |
| Standards reviewer | Sonnet | read-only review of the diff against CLAUDE.md, CONTEXT.md, sibling modules |
| Spec reviewer | Sonnet | empirical reproduction of the ticket's acceptance criteria, in PowerShell |

## Before dispatching a wave

1. Pin on master whatever two tickets could otherwise both invent: interfaces, stub files, message keys, fixtures, shared dependencies. One commit, before any brief goes out.
2. Run the smallest real command each integrating ticket will need (a `tsx` import, a render, a stack query). Fix environment blockers on master first.
3. Decide which tickets touch the local Supabase stack. At most one of those is in flight at a time.
4. Start the stack once (`npx supabase start && npm run db:reset`) if any ticket in the wave needs it. The orchestrator stops it at the end of the wave. Agents never start, stop or reset it unless the brief says so.
5. Create the worktree and branch, claim the issue, then dispatch. Parallel dispatches go out in one message. Tickets that touch the shop (wp-env) run one at a time and share one worktree path, `../Pubquiz-wt-shop`: wp-env keys its containers to the directory it starts from, so a fresh worktree costs a full WordPress, plugin and theme download (about six minutes for #56) while a reused one restarts in about thirty seconds. Note that the start is not the main cost: each WP-CLI call against the container takes about 14 s on Windows (bind-mounted files), so setup and review scripts batch WordPress work into as few `wp` invocations as possible (ticket #61). The orchestrator removes and recreates the worktree between shop tickets; the wp-env instance survives that because it lives under `~/.wp-env`.

## Implementer brief (template)

Every brief contains, in this order:

- Ticket number, worktree path, and "work only there". The orchestrator creates the worktree with a full `.env.local` copied from the main checkout (`shop:up` writes only the WooCommerce lines; nothing writes the Supabase and admin lines) and says so in the brief. Note that every `shop:up` or `scripts/shop/setup.ts` run rotates the WooCommerce REST key into the `.env.local` of the directory it runs in: an app started from any other directory then fails delivery with a 401 until it is restarted from a file carrying the new key.
- Fixed file layout: which files to create, which to touch, which are off limits.
- Named tdd seams (what gets a red test first) and which boundaries may be faked. Renderers and the sampler are never mocked.
- Acceptance criteria restated as checks the Spec reviewer will run. For renderer tickets the visual criteria are numbers (row pitch, minimum image height, margins), never "pick what fits"; the implementer rasterises the worst-case fixture (`pdftoppm -png -r 100`) and reports the PNG paths (wave 4: #27 needed three fix rounds without this).
- Verification budget (see below).
- Stack rule for this ticket: "the stack is running and seeded, use it, do not start/stop/reset it" or "this ticket does not need the stack, do not start it".
- Out-of-scope rule: if something outside the ticket looks wrong, report it in the PR body rather than fixing it in the ticket. The orchestrator decides whether it becomes an issue.
- Finish: merge `origin/master`, push, open the PR with `Closes #<n>`, do not merge, report using the report template.
- Commit trailers and PR footer as given by the session.
- Long commands run in the foreground with a large timeout (up to 600000 ms). Never end the turn to wait on a background command (three implementers in spec 2 wave 1 sat idle until nudged), and never busy-poll one with no-op commands (the #56 implementer fired `echo` every few seconds for minutes); if a background command is unavoidable, wait for it with one blocking `until ...; do sleep 5; done` call.

### Verification budget

Run once, right before pushing, not after every edit:

- `npm run check` (typecheck, unit tests and eslint, concurrently; about 30 s): always, right before pushing. Never run them one after another. While iterating, a subset: `npm run check -- typecheck unit`. Report the results from its output.
- `npm run test:integration`: implementers never run it (trial from spec 2 wave 2, agreed 2026-09-07 after wave 1: implementers repeating the suite, with resets, was the waste). The Spec reviewer runs it once on the branch; the orchestrator runs it once on master at the end of the wave. An implementer that adds an integration test runs only that file. Every suite scopes its own cleanup to the rows it created (by billing email, or by id for the Order-less case -- `src/test-support/scoped-cleanup.ts`, ticket #51), so the suites clean up after themselves and running the full suite is safe even against a stack that also has real orders on it.
- `npm run db:reset`: agents never run it. If a test fails for state reasons, report the failing assertion; the orchestrator decides.
- `npm run build`: never, unless the ticket changes the Next.js app itself.
- While iterating, run only the affected test file (`npx vitest run <file>`).

### Report template

Implementers and fix rounds report in this shape, nothing more:

```
PR: #<n>  Commits: <hashes>
Red evidence: <the failing assertion text of each new test before the fix>
Checks: typecheck <ok>, unit <n/n>, eslint <ok>[, integration <n/n>]
Out of scope: <anything noticed, one line each, or "none">
Interface gaps: <anything the brief got wrong, or "none">
```

### 10-minute check-in

Every running agent (implementer or reviewer) gets a check-in every 10 minutes from dispatch (was 30; Erik shortened it 2026-09-07 after the 30-minute check-in caught the #61 implementer running the whole shop setup inside a vitest import). The orchestrator runs `npx tsx scripts/agents/peek.ts <agentId>` (prints the agent's last tool calls and results from its transcript; subagent output files are often empty) and compares what it sees with the brief. On plan: nothing. Off plan (retrying a denied action, cleaning up things it was not asked to clean, waiting on a background command, running a suite the brief forbids): one `SendMessage` naming the deviation and the next step; a second deviation means stop the agent and redispatch with a tightened brief. Why: the PR #53 Spec reviewer spent 20 minutes retrying blocked `DELETE`s against the shared stack and Erik saw the permission prompts before the orchestrator did. The orchestrator schedules the check-in with a session cron at dispatch of the first agent of a wave and deletes it when the wave ends. Each deviation gets one line in the wave logbook under "Drift log" (what the agent did, what the brief said, the fix), so the retro can turn repeated drifts into brief or skill rules.

## Review

Both reviewers are dispatched the moment the PR opens, in one message, so they run in parallel.

### Standards reviewer

Read-only. Does not run the test suite (the Spec reviewer does). Answers a short list of ticket-specific questions rather than sweeping for smells:

1. Architecture rules from CLAUDE.md (module imports, DRY across Item kinds, locale as data, English identifiers, UI strings through messages).
2. Ordering and failure paths: what happens when each external call fails, and are side effects ordered so a failure consumes nothing.
3. Diff against the sibling module of the same shape (the other renderer, the other repository query) for drift.
4. Tests: red-first evidence present, no tautological assertions, no fixtures disproportionate to what they prove.
5. Docs: README and CONTEXT.md still agree with the code.

Reports findings tagged HARD or JUDGEMENT with `file:line`, then a one-paragraph verdict. No praise.

### Spec reviewer

Empirical, in PowerShell (the user's shell), in the persistent review clone `%LOCALAPPDATA%\Temp\pubquiz-review` (`git fetch && git checkout <branch> && git reset --hard && git clean -fdx -e node_modules && npm install`). A fresh clone is only worth its install time when the ticket touches `package.json` or build config. Reproduces every acceptance criterion with the real tools (real render, real ffprobe, real database counts), records the exact evidence, and proves any new failing-test claim by checking out master's version of the file under test. Uses the running stack; never starts, stops or resets it. For shop tickets it does not build its own shop: the implementer leaves its instance running after pushing, and the reviewer first proves the worktree is the branch tip (`git -C ../Pubquiz-wt-shop status --porcelain` empty and `git rev-parse HEAD` equal to `origin/<branch>`), then reviews against that instance and reruns `npm run shop:up` from the worktree only for the idempotency check. Two wp-env instances cannot share port 45330, and a fresh one costs minutes (PR #60: three `shop:up` runs for one ticket). The stale-leftovers rule above is about generated files, not about a container whose mounted `shop/` directory is provably the pushed commit. Regenerates every sample from the branch tip; never inspects files an implementer left in its worktree (wave 4: a stale sample produced a false clipping finding). Cleans up its own output folders.

Admin forms built as Client Components with `useActionState` cannot be posted with curl: the rendered form carries no action id, and a plain POST gives a 500. The reviewer tries once, then drives the exported server action from one short `npx tsx -e` script (a `FormData`, `deps` with `assertOperator` and the revalidate function stubbed, `process.exit(0)` at the end) and verifies each step through the page GET with the login cookie jar. Accepted 2026-09-09 after wave 1 of spec 4 (PRs 109 and 110); the brief says which of the two paths applies so the reviewer does not spend a round discovering it.

### Fix round

- Bundle both reviews into one message to the original implementer (it keeps its worktree context). Exception: a HARD Standards finding goes out immediately with "more may follow", so the implementer starts while the Spec review finishes.
- The fix round follows the same verification budget and report template. Fix rounds are where red-first is easiest to skip; the message asks for the red output explicitly.
- One fix round is the steady state. A second means the brief or the review was unclear; note that in the logbook.

### Stopping processes an agent started

Any agent that starts `next dev` (or any other server) stops it with `taskkill /PID <pid> /T /F` on Windows and then proves the port is closed (`netstat -ano | findstr :3000` empty). A `kill` on the Git Bash wrapper pid leaves the node tree alive; the #63 Spec reviewer did that and its orphaned worker consumed another test's pg-boss jobs on the shared stack, which looked like a broken master test until the orchestrator found the stray process.

## Merge

Orchestrator: inspect the fix diff, `git merge-tree --write-tree origin/master origin/<branch>` (after `git fetch`; local `master` in a review clone can be stale) for conflicts, `gh pr merge <n> --merge --delete-branch=false`, confirm the issue closed, run `npm run check` on master (after `npm ci` if the PR added a dependency), run `npm run shop:down` from the worktree (the shop stays up for the whole ticket, through review and fix rounds; the orchestrator is the one who stops it, once, here; its containers bind-mount the worktree's `shop/` directory), remove the worktree, append to the wave logbook. At the end of the wave: check the stack for rows a killed run may have leaked (Items or Categories created after the seed timestamp; five leaked Items skewed four pool tests on 2026-09-08) and remove or archive them, then `npm run test:integration` once on master, stop the stacks, complete the logbook, then a retro with Erik before the next wave starts.

## Logbook

One file per wave in `docs/logbook/<date>-wave-<n>.md`: session summary, per ticket (dispatch, review findings, fix round, merge), friction log, observations. Facts and judgement in separate sections. Record dispatch and merge times so wall clock can be measured next time.

## Ticket size

An implementer should finish the first pass in about 20 minutes. When `to-tickets` produces something that will take longer (four new modules plus an integration suite plus docs, as #11 did), split it along a seam that can be pinned on master.

The overhead of a ticket (worktree, PR, two reviews, fix round, merge) is about 20 minutes whatever the diff size, so the rule cuts both ways. Small fixes (roughly under 20 lines, one file, no new behaviour, such as a seed tweak or removing a footer) are batched into one "fixes" issue and one PR, handled by one implementer and reviewed by a single empirical reviewer. The two-reviewer process is for tickets that add or change behaviour. Asset-only and SQL-only tickets (seed data, static audio, images, message files) get a single empirical reviewer as well: their defects are in the data, which only reproduction catches, and the Standards questions rarely apply (decided after the spec #1 retrospective; revisit if such a ticket ever needs a fix round for an architecture reason).
