# Retrospective: spec #1 (2026-09-06)

Input: the three wave logbooks (`2026-09-05-wave-1.md`, `-wave-2.md`, `-wave-3.md`) and the session transcript timestamps. Erik's input: PR #21 felt slow; keep the review level as is or better; cost is acceptable; find where time is wasted and change it.

## Totals

| | |
|---|---|
| Tickets / PRs | 11 tickets, 12 PRs (incl. #22 follow-up) |
| Fix rounds | exactly one per PR |
| Merge conflicts | wave 1: every pair of PRs; waves 2 and 3: none |
| Defects found only by empirical review | 6 (fresh-clone typecheck #2, Category exhaustion #5, case-sensitive email #6, heading overflow #8, persist-before-write #11, zero-slack sampler #22) |
| Implementer first pass | 7 to 36 minutes |

## Where the time went: PR #21 (#11 dev script), 70 minutes dispatch to merge

| Phase | Minutes | What happened |
|---|---|---|
| Implementer, core work | 19 | four modules, three tdd seams, integration test, README, all checks green |
| Implementer, off-ticket investigation | 11 | probe script over 30 seed pairs to characterise the sampler bug (became #22) |
| Implementer, re-verification and PR | 6 | db reset, integration, unit, eslint, an unrequested `npm run build`, push, PR body |
| Reviews, parallel | 16 | Spec reviewer: fresh clone, `npm install`, stack start, full reproduction |
| Fix round | 15 | 7 minutes of changes; 8 minutes of stack start, three `db:reset` runs, integration, unit, eslint, PowerShell checks, `npm run build` again |
| Orchestrator gaps | 3 | logbook writing overlapped with waiting |

Comparison: PR #23 (#22 fix, no stack needed, small ticket) took 20 minutes dispatch to merge with the same two reviewers.

## Findings

1. **Verification churn is the largest avoidable cost.** Across the #11 first pass and fix round: five `db:reset` runs, two `npm run build` runs, the full integration suite four times. Around 12 to 15 minutes. Nobody asked for the builds. The stack was started and stopped three times in one ticket because every agent was told to stop it.
2. **Side investigation.** 11 minutes on a bug outside the ticket. The finding was valuable (#22). Erik chose not to time-box this; out-of-scope findings are reported in the PR body and the orchestrator decides what to do with them.
3. **Ticket size.** #11 was four modules plus an integration suite plus docs. Its 19 minutes of core work is fine, but every later phase scales with it too (more to review, more to re-verify).
4. **Review time is dominated by setup, not thinking.** The Spec reviewer's fresh clone plus install plus stack start is several minutes before the first real check. A fresh clone earned its cost exactly once (#2's typecheck) and that case is about `package.json` changes.
5. **Bundling reviews cost some wall clock.** The Standards review finished before the Spec review; a HARD finding sat waiting.
6. **Standards reviewers duplicate the Spec reviewer's test runs** and vary in what they catch. Their real hits (persist ordering, deep import, missing pagination) came from targeted questions, not sweeps.

Things that worked and stay unchanged: pinning interfaces and dependencies before dispatch (zero conflicts after wave 1), one implementer per ticket in a worktree, the original implementer doing its own fix round, the two-axis review with an empirical Spec reviewer in the user's shell, red-first evidence demanded in fix rounds, the per-wave logbook.

## Decisions

Recorded in `docs/agents/orchestration.md`, referenced from CLAUDE.md:

- Verification budget: typecheck, unit, eslint once before pushing; integration only for tickets touching repository, scripts or supabase; no `next build`; `db:reset` at most once per push.
- Stack lifecycle belongs to the orchestrator: started once per wave, agents use it and never stop or reset it.
- Out-of-scope findings are reported in the PR body, not fixed inside the ticket. No time box (Erik's call).
- Ticket size target: about 20 minutes of implementer first pass; split larger tickets at `to-tickets` time.
- Spec reviewer uses a persistent review clone (reset and cleaned) unless the ticket touches `package.json` or build config.
- HARD Standards findings are forwarded immediately; the rest stays bundled.
- Standards reviewer is read-only and answers five fixed questions, including ordering and failure paths and a sibling-module diff.
- Fixed report template for implementers so red evidence and out-of-scope notes are always present.
- Logbook records dispatch and merge times per ticket.

Expected effect on a #11-sized ticket: roughly 20 to 25 minutes less wall clock at the same review depth. To be measured in the spec #2 logbooks.

## Open

- ~~Whether asset-only or SQL-only tickets should get a single empirical check instead of two reviewers.~~ Decided 2026-09-06 (Erik left it to the orchestrator): single empirical reviewer, recorded in the playbook under Ticket size.
- Visual acceptance of the four Deliverables against the legacy look is Erik's call; samples are under `content/generated/samples-2026-09-06/`.
