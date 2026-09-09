---
name: implement
description: "Implement one ticket in its worktree the way docs/agents/orchestration.md expects: tdd at the named seams, one verification pass, a PR, the report template."
disable-model-invocation: false
---

Implement the ticket the orchestrator's brief names. The brief carries the ticket-specific facts (worktree, file layout, seams, acceptance checks, stack rule); this skill carries the fixed rules. Read `docs/agents/orchestration.md` ("Implementer brief", "Verification budget", "Report template") once.

## Rules

- Work only in the worktree the brief names. Never touch the main checkout or another worktree.
- Use `/tdd` at the seams the brief names: a red test with a captured failing assertion first, then the code. Keep the red output; the report needs it. Red means the test ran against the code as it was before your change (module, function or branch missing or unchanged) and failed on the assertion you meant. A test made red afterwards by stubbing, hardcoding or throwing inside code you already wrote is not red evidence: the reviewer checks out master's version of the file, sees the same test green or a different failure, and raises a HARD finding (three PRs in the spec 4 wave, 2026-09-08).
- While iterating, run only the affected test file and `npm run typecheck`. Same for the shop: apply or verify one changed setup step by running that step alone (`npx tsx -e "import('./scripts/shop/lib/<module>.ts').then(m => m.<fn>())"` or the specific `wp` command), never the whole `npm run shop:up`, which costs minutes (14 s per WP-CLI call on Windows). One full `shop:up` per ticket, for the idempotency check right before pushing.
- Once, right before pushing: `npm run check` (typecheck, unit tests and eslint in parallel, about 30 s; never one after another; a subset while iterating is `npm run check -- typecheck unit`). Never run `npm run test:integration` (the Spec reviewer runs it once on your branch); if you added an integration test, run only that file. Never run `npm run db:reset`, `npm run build`, or start, stop or reset the Supabase stack unless the brief says so. For a shop ticket the brief says to start the shop from your worktree; leave it running when you finish (the reviewer uses it; the orchestrator stops it at merge). If a test fails for state reasons, report the failing assertion and stop; the orchestrator decides.
- Long commands (`npm run shop:up`, `npm ci`, a test file against the stack) run in the FOREGROUND with a large `timeout` (up to 600000 ms). If something must run in the background, wait for it with one foreground command that blocks (`until <condition>; do sleep 5; done` in a single Bash call is allowed; a bare `sleep` is not). Never busy-poll with no-op commands such as `echo`, and never end your turn to wait on a background command.
- Do not run `/code-review`; the orchestrator dispatches the reviewers.
- Anything wrong outside the ticket goes in the PR body, not in the code.
- Locale is data, English identifiers, UI strings through `next-intl`, content never enters git, no new recurring cost (CLAUDE.md).

## Finish

Merge `origin/master` into the branch, push, open the PR with `gh pr create` and `Closes #<n>`, do not merge. The PR body carries the same report as below, including the red evidence (the failing assertion text per new test): the Standards reviewer reads the PR, not your chat report, and a PR without red evidence is a HARD finding. Commit messages and the PR body end with the trailers the brief gives. Report in the playbook's report template, nothing more:

```
PR: #<n>  Commits: <hashes>
Red evidence: <the failing assertion text of each new test before the fix>
Checks: typecheck <ok>, unit <n/n>, eslint <ok>[, <integration file> <n/n>]
Out of scope: <one line each, or "none">
Interface gaps: <anything the brief got wrong, or "none">
```
