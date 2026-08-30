# AGP version pin

## Symptom

During Gradle `:app:buildReleasePreBundle` (production AAB):

```
Could not resolve project :react-native-async-storage_async-storage.
> No matching variant ... attribute 'com.android.build.api.attributes.AgpVersionAttr'
  with value '8.11.0' ... No variants exist.
```

Libraries observed failing in SparkStock: `react-native-async-storage`, `@react-native-community/datetimepicker`, `react-native-get-random-values`, `react-native-keyboard-controller`, `react-native-safe-area-context`, `react-native-screens`, `react-native-reanimated`, `react-native-worklets`. Expo modules are unaffected — only RN community packages with manual `configurations { compileClasspath }` blocks fail.

The `preview` APK profile sometimes hides this because `assembleRelease` has looser variant matching than `bundleRelease`. **Run production AAB builds to surface the bug.**

## Root cause

AGP 8.11.0 (default with React Native 0.81.5 / Expo SDK 54) is too strict for these packages — their subprojects produce zero variants and `:app` can't resolve them. `expo-build-properties` does **not** expose an AGP option (only `compileSdkVersion`, `targetSdkVersion`, `buildToolsVersion`, `kotlinVersion`), so a JS config plugin is the only option.

## Fix (verified on EAS build `d77e1e63`)

Patch **both** `android/build.gradle` AND `android/settings.gradle`. Patching only `build.gradle` is **insufficient** — autolinked RN community packages still get AGP 8.11 from the version catalog in `settings.gradle` and the build fails with the same symptom.

```js
// apps/mobile/plugins/withAgpVersion.js
const { withProjectBuildGradle, withSettingsGradle } = require('@expo/config-plugins');
const AGP_VERSION = '8.9.1';

function patchBuildGradle(config) {
  return withProjectBuildGradle(config, (config) => {
    if (config.modResults.language !== 'groovy') return config;
    const patched = config.modResults.contents.replace(
      "classpath('com.android.tools.build:gradle')",
      `classpath('com.android.tools.build:gradle:${AGP_VERSION}')`
    );
    config.modResults.contents = patched.replace(
      'buildscript {',
      `buildscript {\n  configurations.all {\n    resolutionStrategy.force 'com.android.tools.build:gradle:${AGP_VERSION}'\n  }`
    );
    return config;
  });
}

function patchSettingsGradle(config) {
  return withSettingsGradle(config, (config) => {
    if (config.modResults.language !== 'groovy') return config;
    const original = 'expoAutolinking.useExpoVersionCatalog()';
    const replacement = `expoAutolinking.useExpoVersionCatalog { override -> override.version("agp", "${AGP_VERSION}") }`;
    if (config.modResults.contents.includes(replacement)) return config;
    config.modResults.contents = config.modResults.contents.replace(original, replacement);
    return config;
  });
}

module.exports = function withAgpVersion(config) {
  config = patchBuildGradle(config);
  config = patchSettingsGradle(config);
  return config;
};
```

Register in `apps/mobile/app.json` plugins as the **first** entry: `"./plugins/withAgpVersion"`.

## Why 8.9.1, not 8.7.0

`androidx.core:core:1.17.0` (transitive dep) requires AGP ≥ 8.9.1, so `:app:checkReleaseAarMetadata` fails on 8.7.0. 8.9.1 is the minimum that satisfies the AndroidX floor while staying below the 8.11.0 variant-matching strictness.

## Verify the plugin landed (before paying for an EAS build)

Local sanity check — catches "plugin not registered" and "regex didn't match" silently-broken states:

```powershell
cd apps\mobile
npx expo prebuild --platform android --clean
Select-String -Path android\build.gradle    -Pattern "com.android.tools.build:gradle:8.9.1"
Select-String -Path android\settings.gradle -Pattern 'override.version\("agp", "8.9.1"\)'
```

Both greps must match. If either is missing, the plugin didn't apply — fix that before kicking off EAS.

## DO NOT DELETE THIS PLUGIN

It has been removed twice and broken production builds both times:

- Commit `eca5376` deleted it claiming it was a no-op. Wrong — `settings.gradle`'s `expoAutolinking.useExpoVersionCatalog()` defaults to AGP 8.11; the plugin overrides that at resolution time.
- The first version (only patching `build.gradle`) was insufficient because autolinked subprojects pull AGP from the version catalog in `settings.gradle`, not the root buildscript.

If you think this plugin is unnecessary, run a production AAB build first to confirm. The variant error returns within minutes.

## Also nuke `apps/mobile/android/` after plugin changes OR any local build

That directory is gitignored but reused by EAS. Two distinct failure modes:

1. **After plugin changes** — a stale `build.gradle` / `settings.gradle` won't reflect plugin patches until prebuild regenerates them.
2. **After any local `expo run:android` / Gradle run** — the local debug build leaves ~1.6 GB of `.gradle` / `.cxx` / `build/` artifacts. These get swept into the EAS upload (watch for a multi-hundred-MB archive instead of ~3 MB), and EAS reuses the debug-built tree for the release AAB. The RN community subprojects then have only debug variants, so `:app:buildReleasePreBundle` fails with `No matching variant ... No variants exist` — the *same* symptom as the AGP bug even though the pin (8.9.1) is correct. The archive size in the build log is the tell: 2.9 MB = clean prebuild, 400 MB+ = stale `android/` got uploaded.

Either way: `Remove-Item -Recurse -Force apps\mobile\android` (kill Gradle daemons first — `Get-Process java | Stop-Process -Force` — or the delete hits EBUSY) before the next EAS build. EAS then prebuilds fresh and applies the plugin.
