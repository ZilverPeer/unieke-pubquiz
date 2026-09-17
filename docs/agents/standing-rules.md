# Standing rules for every agent (implementer or reviewer)

Every brief starts with "read `docs/agents/standing-rules.md` in full". These rules apply on top of `docs/agents/orchestration.md` and the ticket brief; the brief can only make them stricter. Until 2026-09-17 this file lived as `standing-rules.md` next to the briefs under `%LOCALAPPDATA%\Temp\pubquiz-briefs`; Windows cleaned that folder during a week of inactivity and two implementers ran without it, so it now lives in the repo.

## Secrets

- Never print `.env.local` in any form: not its contents, not its variable names, not a redacted version. Never edit it.
- Never run `supabase status` unfiltered. You should not need a key at all: the app reads its own configuration, and you log in through the app's login form.
- Before printing any captured output (HTTP responses, logs, command output) count key-like lines first: `grep -c -E "eyJ|ck_|cs_"`. Print only when the count is zero, or pipe through `grep -v -E "eyJ|ck_|cs_"`. Never print `Set-Cookie`, `Authorization` or `X-WC-Webhook-Signature` values, session cookies, JWTs, WooCommerce consumer keys or secrets, webhook secrets, Supabase keys, or signed storage URLs, in a report, a PR body, an issue comment, or a commit.
- Nothing that is quiz content (questions, images, audio, generated deliverables) enters git. Sample files you make for a check are deleted afterwards.

## The shared local stack

- Never run `npm run db:reset`, `supabase start`/`stop`, `npm run loop:up`/`loop:down`, `npm run shop:up`/`shop:down`, or `wp-env start`/`stop`/`destroy` unless the brief says you are the one agent allowed to, and then at most as often as it says. The orchestrator owns the stack lifecycle.
- Never apply migrations. Never delete rows or storage objects except the ones you created for this ticket, marked with the marker the brief names; report the counts before and after.
- Never create operators. Log in only as `operator@example.com` / `Test-Passw0rd-85`. If the account is missing, say so and stop; only Erik recreates it.
- Never place shop orders unless the brief says so. Never touch ports 3000, 45330 and 45332 except as a client.
- `wp-env` keys its environment on the working directory: run every `wp-env` command from the main checkout `C:\Users\Erik\Documents\PersonalProjects\Pubquiz`, never from a worktree. Each WP-CLI call costs about 14 s; plan few.
- The shop's containers bind-mount the main checkout's `shop/` directory, not your worktree.

## Servers you start

- Start a dev server only on the port the brief assigns, never on 3000, never on an unassigned port, from your worktree, without `PUBQUIZ_WORKER` unless the brief says otherwise.
- One bounded foreground wait for it to come up (an `until` loop with a cap, or a single long timeout). Never echo-poll in loops that run past the tool timeout; never end your turn while a background command is still the thing you are waiting on.
- Stop it by pid: `taskkill /PID <pid> /T /F` with the pid from `netstat -ano | findstr :<port>`, then prove the port is closed (no LISTENING line). Never kill processes by name.

## Verification

- Red first: the failing test output (or, for empirical tickets, the failing observation) goes in the PR body verbatim. A "flaky" claim needs a root cause.
- `npm run check` once before pushing (it runs typecheck, unit and eslint concurrently; a subset is `npm run check -- unit eslint`). Integration test files run one at a time, never two concurrently.
- Admin forms built with `useActionState` cannot be posted with curl. Plain server forms can (the login form, an inline `<form action={serverFunction}>`), with the exact `$ACTION_ID_<hash>` hidden field the rendered HTML carries. For `useActionState` forms drive the exported server action from a short `npx tsx -e` script with stubbed deps, or mark the step "by reading".
- Long commands run in the foreground with an explicit timeout (up to 600000 ms), never as fire-and-forget background jobs.

## Git and reporting

- Work only in the worktree the brief names. Before pushing: `git fetch && git merge origin/master` once.
- Commit messages end with the trailers the brief gives (`Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and `Claude-Session: <session URL>`); PR bodies end with the footer `🤖 Generated with [Claude Code](https://claude.com/claude-code)`, a blank line, and the session URL.
- The PR body follows the report template in `docs/agents/orchestration.md`: what changed, red evidence, counts, checks, out-of-scope observations, interface gaps, and which steps were verified live versus by reading.
- Report back with the same template. No praise, no restating the diff.
