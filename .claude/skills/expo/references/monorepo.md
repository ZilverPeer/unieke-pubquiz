# Monorepo gotchas (npm workspaces)

SparkStock is a Next.js app at the repo root with an Expo app at `apps/mobile/` in an npm workspace. Two known traps:

## 1. Metro server-root resolves from workspace root

Expo SDK 53+ auto-enables `EXPO_USE_METRO_WORKSPACE_ROOT=1` in monorepos. This sets Metro's server root to the workspace root, not your app dir. It works for `expo start` but commonly breaks `export:embed` (production native builds), producing:

```
Unable to resolve module ./node_modules/expo-router/entry.js from <workspace-root>/.
```

The tell: the resolution origin is the workspace root, not `apps/mobile/`.

### Fix

Force Metro back to the app dir as server root, then re-add the workspace pieces it needs:

```js
// apps/mobile/metro.config.js
const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

config.watchFolders = [
  ...(config.watchFolders ?? []),
  path.join(workspaceRoot, 'packages'),
]
config.resolver.nodeModulesPaths = [
  path.join(projectRoot, 'node_modules'),
  path.join(workspaceRoot, 'node_modules'),
]

module.exports = config
```

```json
// apps/mobile/eas.json — set on every build profile
{
  "build": {
    "production": {
      "env": { "EXPO_NO_METRO_WORKSPACE_ROOT": "1" }
    },
    "preview": {
      "env": { "EXPO_NO_METRO_WORKSPACE_ROOT": "1" }
    },
    "development": {
      "env": { "EXPO_NO_METRO_WORKSPACE_ROOT": "1" }
    }
  }
}
```

Locally also set the env var before `gradlew`:

```powershell
$env:EXPO_NO_METRO_WORKSPACE_ROOT="1"
```

**Do NOT** spread `getDefaultConfig` output into a new object and forget `config.watchFolders` — `expo-doctor` will warn that defaults are missing. Always spread the existing array.

## 2. React duplication between Next.js and Expo

The workspace pins React for two consumers: Next.js (recent, e.g. `^19.2.x`) and Expo (the exact version Expo SDK expects, e.g. `19.1.0`). npm hoists the newer React to the workspace root and keeps the Expo-required one in `apps/mobile/node_modules`. Symptoms: native renderer / JS React mismatch errors at runtime, or `expo-doctor` flags duplicates.

Patching `metro.config.js` with a `resolveRequest` to force React lookups to the Expo dir works but is brittle. Structural fix at the workspace root:

```json
// workspace-root/package.json
{
  "dependencies": {
    "react": "19.1.0",
    "react-dom": "19.1.0"
  },
  "overrides": {
    "react": "19.1.0",
    "react-dom": "19.1.0"
  }
}
```

**npm refuses an override that conflicts with a direct dep** — pin the direct dep first, then the override matches it. Apply the same pattern for any other duplicated native module (e.g. `expo-image-loader`) via `overrides`.

### After updating

Full clean install:

```powershell
Get-Process java -ErrorAction SilentlyContinue | Stop-Process -Force
Remove-Item -Recurse -Force node_modules, package-lock.json
npm install
```

Verify with `npm ls react` (everything should say "deduped") and `npx expo-doctor`.
