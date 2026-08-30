---
name: web-release-flow
description: Use when merging a PR that touches the SparkStock web app (app/, lib/, supabase/migrations/, or any non-apps/mobile/ change) to main. Covers the pre-merge gates — `/ship` first, Vercel preview status, pending Supabase migrations, prod backup, dev-first migration application, and explicit user confirmation before merge.
---

# Web release flow (SparkStock)

The web app deploys **on merge to `main`** via Vercel. The branch must therefore be fully verified before the PR is merged — this is the inverse of `mobile-release-flow`, where build + submit happen on the branch and the PR is opened afterward.

## When to use

Any PR that touches:

- `app/` (Next.js App Router)
- `lib/`
- `supabase/migrations/`
- Anything else outside `apps/mobile/`

For changes inside `apps/mobile/`, load `mobile-release-flow` instead — completely different sequencing.

## The checklist

Run **every step, every time, in order.** Do not skip.

### 1. Run /ship (before the PR exists)

Invoke the `ship` skill via the Skill tool **before** opening the PR. It reviews what the branch built, captures lessons in CLAUDE.md or skills, and commits the improvements onto the feature branch. Running it first means only one Vercel preview build fires — for the final state of the branch including any lesson commit.

If the PR is already open when you reach this skill, still run `/ship` first; the lesson commit will be pushed to the existing PR and trigger the (single) preview build to gate on.

### 2. Push and open the PR (if not already open)

Push the branch and open the PR with `gh pr create --body-file <path>`. The push fires the Vercel preview build.

### 3. Vercel preview is green

Use Vercel MCP (team `team_6RPEH7qvWBhynOkUuMRjxI0k`) to confirm the latest deployment on the branch is `READY`:

```
mcp__plugin_vercel_vercel__list_deployments  → find the branch's latest
mcp__plugin_vercel_vercel__get_deployment    → confirm state: READY
```

If not READY, fetch logs with `get_deployment_build_logs` and fix on the branch. **Never merge on a failing or pending build.**

### 4. Check for unrun migrations on prod

Compare local `supabase/migrations/*.sql` against prod (`jjkyxlubnvcpimxhbloe`):

```
mcp__supabase__list_migrations  (project_id: jjkyxlubnvcpimxhbloe)
```

Match by file content/name, **not version string** — dev/prod migration version strings can differ (timestamps vs sequential numbers).

If everything is already on prod, skip to step 6.

### 5. Apply pending migrations (dev → backup → prod)

a. **Dev first.** Apply via `mcp__supabase__apply_migration` against `ctdchquwivfvimxabmfc`. Verify the result with `execute_sql` against `pg_class` / `pg_views` / etc.

b. **Back up prod.** Run `node backups/backup-prod.mjs` in the background. Confirm the snapshot file appears under `backups/` before proceeding.

c. **Stop and ask the user to confirm** before touching prod, especially for destructive changes (`DROP COLUMN`, `DROP TABLE`, `ALTER ... NOT NULL` on existing rows, etc.).

d. After confirmation, apply migrations to prod in the same order via `mcp__supabase__apply_migration` against `jjkyxlubnvcpimxhbloe`. Verify state after.

### 6. Ask the user to confirm the merge

**Always stop here and explicitly ask the user before merging**, even if all gates above are green. The user said "wrap up" — they did not pre-authorize the merge. Surface:

- PR number and title
- Vercel preview URL (the `branchAlias` from step 3)
- Whether any migrations were applied
- Any unusual diffs the user might want to glance at

Wait for an explicit "yes" / "merge it" / equivalent before proceeding to step 7. If the user wants changes, return to step 1.

### 7. Merge the PR

Only after step 6's explicit confirmation. `gh pr merge <n> --squash --delete-branch` is the standard form. After merging, gh leaves the working tree on `main` and fast-forwards it.

### 8. Confirm the production deploy

Merging fires a new Vercel deployment with `target: "production"` against the merge commit on `main`. Don't end the flow until that deployment reaches `READY`:

1. Identify the merge commit SHA on `main` (`git log -1 --oneline` after the merge).
2. Poll `mcp__plugin_vercel_vercel__list_deployments` (or `get_deployment` once you have the deployment ID) until the entry matching that SHA has `target: "production"` and `state: "READY"`. Typically takes 1–3 minutes.

   **Polling rule:** Vercel state is checked **only** via the Vercel MCP plugin. Between calls, use `ScheduleWakeup` (~60–120s) to fire the next MCP call. Never use `curl`, `gh`, or a bash `until` loop to wait on Vercel — those don't return useful state and tend to leak as runaway background tasks.
3. If `state` is `ERROR` or `CANCELED`: fetch `get_deployment_build_logs`, surface the failing excerpt, and propose a fix on a new branch. **Do not assume the merge is rolled back** — Vercel will continue to serve the previous production deployment, but the new code on `main` is now part of the next deploy. Decide with the user whether to revert the merge or fix-forward.
4. Report the prod URL and READY state back to the user — that is the flow's exit condition.

## Quick reference

| Step | What                | Tool                                                             | Gate                                                           |
| ---- | ------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------- |
| 1    | Run `/ship`         | Skill tool → `ship`                                              | Lesson commit on branch (if any)                               |
| 2    | Push + open PR      | `git push`, `gh pr create --body-file`                           | PR exists                                                      |
| 3    | Vercel preview      | `mcp__plugin_vercel_vercel__list_deployments` / `get_deployment` | `READY`                                                        |
| 4    | Diff migrations     | `mcp__supabase__list_migrations` (prod)                          | All local files present on prod, OR proceed to step 5          |
| 5a   | Apply to dev        | `mcp__supabase__apply_migration` (dev)                           | Verified via `execute_sql`                                     |
| 5b   | Backup prod         | `node backups/backup-prod.mjs` (background)                      | Snapshot file written                                          |
| 5c   | Confirm migration   | Ask user                                                         | Explicit "yes"                                                 |
| 5d   | Apply to prod       | `mcp__supabase__apply_migration` (prod)                          | Verified via `execute_sql`                                     |
| 6    | Confirm merge       | Ask user                                                         | Explicit "yes"                                                 |
| 7    | Merge               | `gh pr merge --squash --delete-branch`                           | Step 6 confirmed                                               |
| 8    | Confirm prod deploy | `mcp__plugin_vercel_vercel__list_deployments`                    | Merge-commit deployment is `READY` with `target: "production"` |

## Project IDs (Supabase)

| Env  | Project ID             |
| ---- | ---------------------- |
| Dev  | `ctdchquwivfvimxabmfc` |
| Prod | `jjkyxlubnvcpimxhbloe` |

## PR body on Windows

Use `gh pr create --body-file <path>` — never `--body "..."`. Dutch characters break PowerShell quoting.

## Why this ordering

- **`/ship` runs first** so any lesson commit is part of the same branch state the preview builds against. Running it after the preview gate would either trigger a second build or merge a state we never gated on.
- **Web deploy IS the merge.** Vercel deploys `main` on push, so the PR must be fully verified before it merges. No "fix after merge" — that's a prod incident.
- **Dev migration first** catches schema errors against a real database without touching prod data.
- **Backup before prod migration** because migrations can be irreversible (DROP COLUMN, type changes that lose precision, etc.).
- **Explicit merge confirmation** because a "wrap up" signal from the user authorizes the flow, not the merge itself. Prod is one keystroke away — the human always gets the final click.

## Related skills

- `mobile-release-flow` — inverse flow for `apps/mobile/` changes (PR comes AFTER deploy)
- `postgres-best-practices:supabase` — RLS, migrations, advisors before applying schema changes
