# 2026-09-17 Retro follow-ups after the spec 4/5 wave

Erik, back after a week, asked for the retro points to be fixed before the grilling for the storefront design spec.

## 08:1x Playbook and tickets

- `docs/agents/orchestration.md` wave-end step now includes a scan of the loop app's dev log (three of last wave's bugs came from it). Why: found by reading, not by tickets, three times in one wave.
- #136 filed: `loop:up` re-probes the app after a 10 s grace period (the 2026-09-09 dead-app incident).
- #137 filed: the shop leaves a `[pubquiz]` order note when the feasibility check fails open, which the existing operator mail picks up.
- Permission rules: the orchestrator may not widen its own permissions (denied, correctly); Erik adds `Bash(cp .env.local *)`, `Bash(cp ./.env.local *)` and `Bash(npm run admin:operator:*)` to `.claude/settings.local.json` himself if he wants fewer interruptions.

## 08:4x #136 and #137 dispatched

wt-136 (`ticket-136-loop-reprobe`) unit-only, no stack. wt-137 (`ticket-137-failopen-note`): loop brought up from master, then the app stopped by pid so the feasibility check fails open; the shop bind-mounts the main checkout's `shop/`, so the implementer copies its one PHP file across per run and restores the main checkout before pushing. Check-in cron every 15 minutes, drift lines in this file.

## 08:2x PR 138 (#136) merged on a read review

Pure `confirmAppStillUp` helper with four unit cases (red: module missing), `APP_GRACE_PERIOD_MS = 10_000`, the re-probe only on the freshly-spawned branch of `ensureAppUp`, runbook sentence. Master check green (361 unit). The empirical `loop:up` run with the merged code follows once #137 no longer needs the app stopped. wt-136 removed.

## 2026-09-17 retro follow-ups closed

- PR 139 (#137) merged: every fail-open path in `pubquiz-checkout-feasibility.php` remembers its reason in the WooCommerce session; on `woocommerce_checkout_order_created` the plugin adds a private `[pubquiz] Feasibility check skipped at checkout: <reason>` note, which the operator mail picks up. Red order #35 (no note, no mail), green order #38 (note plus "[Pubquiz] Order #38 needs attention" in Mailpit). The brief named the wrong hook (`woocommerce_checkout_create_order_line_item` fires before save, the note no-ops); the implementer switched with evidence. `npm run shop:order` bypasses real checkout, so the proof used curl-driven checkout.
- Standing rules moved into the repo as `docs/agents/standing-rules.md` and the brief template opens with "read it in full". Why: Windows cleaned the Temp copy during a week of inactivity and both implementers ran without it (PRs were fine; the risk was real).
- PR 138 (#136) verified empirically: `npm run loop:up` on master printed `App: still up after 10 s (pid 9328).` and the app answered 200 on 3000 afterwards.
- Wave-end: `loop:down` done, port 3000 closed, no worktrees besides main, `~/.wp-env` holds only the loop's own environment. Check-in cron deleted. No drift lines this session.
- Next: grilling for the storefront design spec, then the PDF deliverable design spec; VPS, payments and real mail last.
