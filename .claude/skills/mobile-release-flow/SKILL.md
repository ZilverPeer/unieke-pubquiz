---
name: mobile-release-flow
description: Use when shipping changes inside apps/mobile/ to a physical device or the Play Store. Covers the SparkStock-specific sequence — local install → EAS production build → submit to Play Console Internal Testing → PR/merge — and when each gate is "done enough" to advance.
---

# Mobile release flow (SparkStock)

The mobile app does **not** follow the web deployment flow in `CLAUDE.md` §8. Web work is gated by Vercel previews + Supabase migrations and merges before deploy. Mobile is the inverse: build and submit **first**, PR/merge **last** — so a failing EAS build never blocks the branch from further iteration.

## The four stages

```
1. Local install on physical device     ← iterate freely, no PR yet
2. EAS production AAB build             ← only when satisfied with stage 1
3. eas submit → Play Console Internal   ← only if stage 2 is FINISHED
4. /ship + PR + merge to main + tag     ← only if stage 3 is COMPLETED
```

Each stage is a gate. **Do not advance until the previous stage has reported success.** If a stage fails, fix on the same branch and re-run the stage — do not skip ahead.

## Stage 0 — Build now or stage for later?

**Run this check every time the user signals they are done with Stage 1** — before touching EAS.

### 1. Show what's queued

Find the last build tag and list every mobile commit since then:

```bash
LAST_TAG=$(git tag --sort=-version:refname | grep "^mobile-build/" | head -1)
git log ${LAST_TAG}..HEAD --oneline -- apps/mobile/
```

Present the result as a clear list. If there are no commits beyond HEAD (i.e. all changes are still on the current branch and not yet on `main`), note that this branch's changes will be included.

### 2. Ask the user

> **"This build would include the following changes:**
> [list from above + any unstaged commits on the current branch]
>
> Do you want to **build now** (proceed to Stage 2), or **stage this change** (merge to main and build later with more changes)?"

- **Build now** → proceed to Stage 2 as normal. The build manifest above is already shown; no need to repeat it.
- **Stage for later** → skip directly to the wrap-up: run `/ship`, create the PR, merge. **Do not create a `mobile-build/` tag** — tags mark actual builds, not merges.

There is no wrong answer. Small changes are fine to stage.

## Long-running commands MUST run in the background

EAS builds take ~15–20 minutes. Local Gradle builds take 2–10 minutes. `eas submit` can take a few minutes. **All of these must be launched with `run_in_background: true`** so the user is not blocked waiting on you.

When the background process completes, report back to the user with:
- **success**: what succeeded + what the next stage is
- **failure**: the failing log excerpt + the proposed fix, then wait for approval
- **action needed**: any prompt the build asks for (credentials, version bump, etc.)

Never poll a background build in a sleep loop — you will be notified when it completes.

## Stage 1 — Local install on physical device

**Load this skill the moment a mobile change heads toward on-device verification — not at PR time.** It dictates *how* Stage 1 is done; improvising (e.g. a raw `expo run:android` debug compile) skips the dev-client loop below and costs minutes per change.

**First, check for a connected phone:** `adb devices`. If one is attached, prefer on-device verification.

Use the **development client** build for installation on a physically-connected Android phone. JS-only changes can also use Expo Go, but the dev client mirrors production native modules and is the safer default.

```bash
cd apps/mobile
npx eas-cli build --profile development --platform android
```

Run with `run_in_background: true`. EAS returns a download URL when finished — install via `adb install <downloaded.apk>` or scan the QR code from the build page. For local Gradle alternatives, see the `expo` skill (`references/local-build-debug.md`).

The `development` profile in `eas.json` sets `developmentClient: true` and `env.APP_VARIANT=development`. That env var drives `app.config.js`, which overrides the Android package to `nl.sparkstock.app.dev` and the name to "SparkStock Dev" **only** for this profile — production/preview config stays byte-identical to `app.json`. This is what lets the dev client install alongside the production app (see the signature warning below).

**The fast loop:** a dev client is compiled **once**, then `npx expo start --dev-client` connects it to Metro and JS/TS edits appear via Fast Refresh in ~1s — no rebuild. Only *native* changes (new native dependency, `app.json` native keys, config plugins, new-arch toggles) need another build. Do not full-rebuild for a JS-only change.

**Signature warning:** a local debug build is signed with the debug keystore, the Play/production app with the release key. Android refuses to install one over the other regardless of version (you'll see `INSTALL_FAILED_VERSION_DOWNGRADE` or a signature error) — installing forces an **uninstall of the production app first, losing its data/login**. Warn the user before doing this. A dev client with a distinct app id (`nl.sparkstock.app.dev`) sidesteps it by installing alongside the production app.

**Done-enough criteria for stage 1:**
- App launches without crash on the physical device
- The changed flow has been exercised by the user
- The user explicitly says they are satisfied — do **not** advance on your own initiative
- On sign-off, ask verbatim: **"Ship this to prod, or keep building on this branch?"** Only advance to Stage 2 on an explicit "ship".

While in stage 1 the branch can receive any number of additional commits. Do not open a PR yet.

## Stage 2 — EAS production AAB build

Only run after stage 1 is signed off by the user.

**If stage 1 used a local `expo run:android` / Gradle build, delete `apps/mobile/android/` first.** That local debug tree (gitignored but ~1.6 GB) gets uploaded and reused by EAS, and the release AAB then fails with `No matching variant ... No variants exist`. `Get-Process java | Stop-Process -Force` then `Remove-Item -Recurse -Force apps\mobile\android`. Confirm the build log shows a ~3 MB archive, not 400 MB+. See `expo` skill → `references/agp-version-pin.md`.

```bash
cd apps/mobile
npx eas-cli build --profile production --platform android
```

Run in background. Production builds hit the AGP variant-matching trap that `apps/mobile/plugins/withAgpVersion.js` defends against — if the build fails with `No matching variant ... AgpVersionAttr`, read the `expo` skill's `references/agp-version-pin.md` before doing anything else.

**Done-enough criteria for stage 2:** EAS build status is `FINISHED`. On failure, fetch the log (`expo` skill → `references/local-build-debug.md` → "Diagnose a failed EAS build from a build ID") and propose a fix before re-running.

## Stage 3 — Submit to Play Console Internal Testing

Only run after stage 2 is `FINISHED`. **Do not use `eas build --submit`** — keep build and submit as separate gates so a partial failure never half-ships.

```bash
cd apps/mobile
npx eas-cli submit --profile production --platform android --id <build-id>
```

Run in background. `eas.json`'s `submit.production.android` already points at `track: internal` with `./google-service-account.json`, so no extra flags are needed.

**Done-enough criteria for stage 3:** `npx eas-cli submit:list` shows the submission as `COMPLETED`. The new versionCode appears in Play Console → Internal Testing → Releases.

## Stage 4 — Wrap up

Only run after stage 3 is `COMPLETED`.

1. **Invoke the `ship` skill** via the Skill tool to capture this session's lessons as a commit on the branch. Do this before opening the PR so the lessons-commit appears in the PR diff.
2. After `/ship` completes: `gh pr create --body-file <path>` (never `--body "..."` on Windows; Dutch characters break PowerShell).
3. Merge once the user approves.
4. **Tag the merged commit** to mark the build baseline:
   ```bash
   NEXT=$(git tag --sort=-version:refname | grep "^mobile-build/" | head -1 | sed 's/mobile-build\///' | awk '{print $1+1}')
   git tag mobile-build/${NEXT} main
   git push origin mobile-build/${NEXT}
   ```
   This tag is what the Stage 0 manifest query uses to show what's queued for the *next* build.

## Why this ordering

Three load-bearing reasons:

1. **A failing EAS build must not block branch iteration.** Web flow gates on Vercel preview *before* merge, because merge IS the deploy. Mobile's deploy is `eas submit`, not merge — so the branch needs to stay open for fixes if the build fails.
2. **`/ship` captures lessons from the actual outcome**, not from a hypothetical one. If you `/ship` before submission and the submission fails, the lesson is wrong.
3. **Play Console Internal Testing is the canary**, not the destination. The branch represents code that successfully reached internal testers — merging earlier would let main diverge from what's actually deployed.

## Quick reference

| Stage | Command | Background? | Advance when |
|---|---|---|---|
| 1. Local install | `eas build --profile development --platform android` | yes | User explicitly satisfied |
| 2. Production build | `eas build --profile production --platform android` | yes | Build status `FINISHED` |
| 3. Submit | `eas submit --profile production --platform android --id <id>` | yes | Submission `COMPLETED` |
| 4. PR/merge | `/ship` → `gh pr create` → merge | n/a | User approves |

## Anti-patterns

- **`eas build --submit`** — couples the build and submit gates. If the build is flaky and partly succeeds, you don't get a clean stop point. Always run them as separate commands.
- **Opening a PR before stage 3 completes** — main diverges from what's in Internal Testing, and the next mobile change has to reconcile that diff.
- **Running an EAS build foreground-blocking** — you cannot respond to the user for 15+ minutes. Always `run_in_background: true`.
- **Skipping stage 1** — production AAB builds are 10x slower than a dev client install. Use dev client to catch JS/native errors first.

## Related skills

- `expo` — EAS commands, AGP pin, monorepo fixes, local-build/debug recipes, submit reference (load this when any stage fails or you need a specific command)
