---
name: expo
description: Use when running EAS commands, configuring Expo, or debugging Expo/EAS issues for the SparkStock mobile app (apps/mobile/). Covers EAS build/submit mechanics, the AGP version pin, monorepo Metro/React fixes, Windows local-build env, and Play/iOS submission. For the release sequencing (which command to run when), load mobile-release-flow instead.
---

# Expo / EAS (SparkStock)

This skill covers the *mechanics* of working with Expo and EAS for SparkStock — individual commands, configuration, and known issues. For the *sequencing* of a release (local install → build → submit → PR), load `mobile-release-flow`.

## Two rules that always apply

1. **Monorepo: `cd apps/mobile` first.** Every `eas-cli` command must run from the directory containing `eas.json` / `app.json`. From the repo root you'll get `EAS project not configured...` — misleading; the project IS configured, you're in the wrong directory.

2. **Long-running commands run in the background.** EAS builds take 15–20 min, dev client builds 5–10 min, `eas submit` a few minutes, `npm install` after a wipe a couple minutes. Always launch with `run_in_background: true`. Report back on success / failure / action-needed when notified. Never poll in a sleep loop.

## Where to find what

| Symptom / task | Read |
|---|---|
| "No matching variant ... AgpVersionAttr" / "No variants exist" Gradle error | `references/agp-version-pin.md` |
| `apps/mobile/plugins/withAgpVersion.js` is missing or someone wants to remove it | `references/agp-version-pin.md` |
| Metro can't resolve `./node_modules/expo-router/entry.js` from workspace root | `references/monorepo.md` |
| React renderer mismatch errors / `expo-doctor` flags duplicate React | `references/monorepo.md` |
| `npm install` fails with `EBUSY` on `react-native-screens/...lint-cache/*.jar` (Windows) | `references/local-build-debug.md` |
| Need to fetch logs for a failed EAS build by ID | `references/local-build-debug.md` |
| Need to run a local Gradle release APK on a USB phone | `references/local-build-debug.md` |
| Setting up `JAVA_HOME` / `ANDROID_HOME` (Windows) | `references/local-build-debug.md` |
| Configuring `eas submit` for Play Console (service account, tracks) | `references/submit-and-stores.md` |
| Submitting an existing build by ID to Play Console Internal Testing | `references/submit-and-stores.md` |
| iOS / TestFlight setup | `references/submit-and-stores.md` |

## Quick command reference

All commands assume you're in `apps/mobile/`. All builds run in the background.

```bash
# Dev client build (for physical-device install — see mobile-release-flow stage 1)
npx eas-cli build --profile development --platform android

# Production AAB build (stage 2)
npx eas-cli build --profile production --platform android

# Submit a finished build to Play Console Internal Testing (stage 3)
# DO NOT use `--submit` on the build command; keep build and submit as separate gates
npx eas-cli submit --profile production --platform android --id <build-id>

# Inspect a build (use --json to get logFiles[] URLs)
npx eas-cli build:view <build-id> --json

# Inspect a submission
npx eas-cli submit:list

# Version source is `remote` — EAS auto-increments versionCode on each production build.
# Inspect current: `npx eas-cli build:version:get --platform android`
# Manual set:      `npx eas-cli build:version:set --platform android`
```

## Driving the dev-client Metro loop from an agent

Once a `development`-profile dev client is installed (`nl.sparkstock.app.dev`, alongside production), connect it to Metro for Fast Refresh. Three traps when an agent does this on a USB-connected phone (`adb devices` shows `ZY22KDHLTF`):

1. **`expo start` run in the background is non-interactive — and silently skips the dev server if port 8081 is busy.** It does *not* fall back to 8082; it prints `Skipping dev server` and the task exits 0-ish with no Metro. A stale Metro from a prior session is the usual culprit. **Kill it first:** find the listener with `Get-NetTCPConnection -LocalPort 8081 -State Listen` and `Stop-Process -Id <pid> -Force`, then relaunch `npx expo start --dev-client`.
2. **USB devices need `adb reverse tcp:8081 tcp:8081`** so the dev client can reach `localhost:8081`. Set it after Metro is up (and again after any `pm clear`).
3. **Launching via `adb shell monkey -p nl.sparkstock.app.dev -c android.intent.category.LAUNCHER 1` opens the dev launcher, not the app** — the user taps the `localhost:8081` server once to connect. There is no agent-side automation for that tap without the (uninstalled) Expo MCP, so hand the connect + visual confirmation to the user.

Useful checks: `adb shell pm list packages | Select-String sparkstock` proves install-alongside (expect both ids); `adb shell pm clear nl.sparkstock.app.dev` wipes the dev session to force the login screen (also clears the saved dev-server, so the launcher tap is needed again).

## Anti-patterns

- **`eas build --submit`** — couples build and submit. A flaky build can half-ship. Always run them as separate commands so you can verify `FINISHED` between them.
- **Running an EAS build foreground-blocking** — blocks the conversation for 15+ minutes. Always `run_in_background: true`.
- **Editing `versionCode` in `app.json`** — no effect under SparkStock's `appVersionSource: "remote"` setup. EAS manages it.
- **Deleting `apps/mobile/plugins/withAgpVersion.js`** — it has been removed twice and broke production builds both times. See `references/agp-version-pin.md` for why.
- **`gh pr create --body "..."` on Windows** — Dutch characters break PowerShell quoting. Always `--body-file <path>`.

## SparkStock-specific config (frozen reference)

| Setting | Value | Where |
|---|---|---|
| EAS project ID | `bd0694a8-5f6c-4466-a234-4d01dbd3f55a` | `apps/mobile/app.json` → `expo.extra.eas.projectId` |
| Android package | `nl.sparkstock.app` | `apps/mobile/app.json` → `expo.android.package` |
| App slug | `sparkstock-mobile` | `apps/mobile/app.json` → `expo.slug` |
| Version source | `remote` (EAS-managed) | `apps/mobile/eas.json` → `cli.appVersionSource` |
| Auto-increment | `true` on production | `apps/mobile/eas.json` → `build.production.autoIncrement` |
| Submit track | `internal` | `apps/mobile/eas.json` → `submit.production.android.track` |
| Service account | `./google-service-account.json` (gitignored) | `apps/mobile/eas.json` → `submit.production.android.serviceAccountKeyPath` |
| AGP pin | `8.9.1` | `apps/mobile/plugins/withAgpVersion.js` → `AGP_VERSION` |
| New Architecture | enabled | `apps/mobile/app.json` → `expo.newArchEnabled: true` |

## Expo MCP server (not currently installed — requires paid EAS plan)

Expo ships an official remote MCP server (`claude mcp add --transport http expo-mcp https://mcp.expo.dev/mcp`) exposing `build_run` / `build_list` / `build_info` / `build_logs` / `build_submit`, workflow tools, and — with `expo-mcp` + a running dev server — device automation (`automation_take_screenshot`, `automation_tap`, `open_devtools`). It would replace the CLI-and-tail-the-log-file dance and let an agent screenshot the running app to self-verify UI. **It needs a paid EAS plan, which SparkStock does not have**, so until that changes keep using `eas-cli` + the log recipes in `references/local-build-debug.md`. Docs: https://docs.expo.dev/eas/ai/mcp/

## Documentation lookups

For Expo / EAS / React Native syntax questions, plugin configuration, or version migration notes, use the `find-docs` skill — official docs are authoritative for the parts of the SDK we don't have notes on here.

## Related skills

- `mobile-release-flow` — the canonical SparkStock release sequence (local install → build → submit → PR). Load first when shipping mobile changes.
- `find-docs` — Expo/EAS/React Native documentation lookup
