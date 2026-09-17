# 2026-09-17 Retro follow-ups after the spec 4/5 wave

Erik, back after a week, asked for the retro points to be fixed before the grilling for the storefront design spec.

## 08:1x Playbook and tickets

- `docs/agents/orchestration.md` wave-end step now includes a scan of the loop app's dev log (three of last wave's bugs came from it). Why: found by reading, not by tickets, three times in one wave.
- #136 filed: `loop:up` re-probes the app after a 10 s grace period (the 2026-09-09 dead-app incident).
- #137 filed: the shop leaves a `[pubquiz]` order note when the feasibility check fails open, which the existing operator mail picks up.
- Permission rules: the orchestrator may not widen its own permissions (denied, correctly); Erik adds `Bash(cp .env.local *)`, `Bash(cp ./.env.local *)` and `Bash(npm run admin:operator:*)` to `.claude/settings.local.json` himself if he wants fewer interruptions.
