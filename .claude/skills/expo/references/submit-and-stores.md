# Submit & stores

## Cardinal rule: build and submit are separate gates

**Never use `eas build --submit`.** Coupling them removes the gate between "build succeeded" and "ship to store" — a flaky build can half-ship before you see the failure. Run the build, verify status is `FINISHED`, then submit with the build ID:

```bash
cd apps/mobile

# 1. Build
npx eas-cli build --profile production --platform android
# (wait for FINISHED — see mobile-release-flow stage 2)

# 2. Submit by ID
npx eas-cli submit --profile production --platform android --id <build-id>
# (wait for COMPLETED — see mobile-release-flow stage 3)
```

## SparkStock Play Console config (already in place)

`apps/mobile/eas.json` is already configured:

```json
{
  "submit": {
    "production": {
      "android": {
        "serviceAccountKeyPath": "./google-service-account.json",
        "track": "internal"
      }
    }
  }
}
```

- `track: "internal"` → submission lands in Play Console → Internal Testing → Releases
- `serviceAccountKeyPath` → the JSON key, gitignored, lives at `apps/mobile/google-service-account.json`
- No extra flags needed at submit time

## Verifying a submission

```bash
cd apps/mobile

# List recent submissions (look for status COMPLETED, FAILED, IN_QUEUE)
npx eas-cli submit:list

# Get a specific submission
npx eas-cli submit:view <submission-id>
```

After `COMPLETED`, the new versionCode appears in **Play Console → Internal Testing → Releases**. Distribution to internal testers is immediate; production track promotion is a separate Play Console action and is out of scope for the automated flow.

## Tracks (reference)

Google Play track ladder, in order of audience size:

| Track | Audience | When to use |
|---|---|---|
| `internal` | Internal testers only (Play Console members) | Every EAS build — current default |
| `alpha` (closed) | Invited testers via opt-in URL | Wider testing, before public |
| `beta` (open) | Anyone with the opt-in URL | Public beta |
| `production` | All users | Final release — promote manually via Play Console |

To change the default track, edit `apps/mobile/eas.json` `submit.production.android.track`. Don't promote production from CLI without explicit user approval.

## First-time service account setup (reference — already done for SparkStock)

If you need to set up Play Console submission on a fresh project:

1. **Create service account** in Google Cloud Console → IAM & Admin → Service Accounts. Grant the "Service Account User" role. Create and download a JSON key.
2. **Link to Play Console**: Play Console → Setup → API access → "Link" next to your Google Cloud project. Under "Service accounts" → "Manage Play Console permissions", grant at minimum "Release to testing tracks".
3. **Configure EAS**: drop the JSON key at `apps/mobile/google-service-account.json` (or your chosen path) and reference it in `eas.json` `submit.production.android.serviceAccountKeyPath`. Add the JSON to `.gitignore`.
4. **First submission** can take up to 24h for Play to acknowledge the service account — subsequent submissions are immediate.

## iOS / TestFlight (out of scope today)

SparkStock currently ships Android only. If iOS becomes in-scope, the relevant config goes under `submit.production.ios`:

```json
{
  "submit": {
    "production": {
      "ios": {
        "appleId": "...",
        "ascAppId": "...",
        "appleTeamId": "..."
      }
    }
  }
}
```

Plus `eas credentials` to set up Apple signing. See Expo's [iOS submission docs](https://docs.expo.dev/submit/ios/) — load via `find-docs` when needed.
