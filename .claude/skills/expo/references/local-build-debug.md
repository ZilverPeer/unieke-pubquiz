# Local build & debug recipes

All recipes assume Windows + PowerShell. All long-running commands should be launched with `run_in_background: true`.

## Diagnose a failed EAS build from a build ID

`build:view` alone only prints status + a web URL — useless from the terminal. To get the actual Gradle/Xcode error:

```bash
cd apps/mobile

# 1. Fetch build metadata as JSON — includes logFiles[] with signed URLs
npx eas-cli build:view <build-id> --json

# 2. curl the URL from logFiles[0] (short-lived signed GCS link, ~15 min).
#    --compressed is REQUIRED — the log is gzipped; without it you get binary garbage.
curl -sL --compressed "<logFiles[0] URL>" -o /tmp/build-log.txt
cat /tmp/build-log.txt
```

The JSON also exposes `error.errorCode` (e.g. `EAS_BUILD_UNKNOWN_GRADLE_ERROR`), `error.message`, `appBuildVersion`, `gitCommitHash`, and `buildProfile` — useful for confirming the right build before diving into logs.

## Local build environment (Windows PowerShell)

Gradle needs both `JAVA_HOME` and `ANDROID_HOME`. Common locations:

```powershell
$env:JAVA_HOME    = "$env:ProgramFiles\Android\Android Studio\jbr"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
```

For local production parity:

```powershell
$env:EXPO_NO_METRO_WORKSPACE_ROOT = "1"
$env:NODE_ENV = "production"
```

## Smoke-test a release APK via USB before paying for EAS

For Android release validation, build an APK locally and `adb install` — ~10x faster than an EAS round-trip and catches the same JS-bundle and native-link issues:

```powershell
cd apps\mobile\android
.\gradlew.bat :app:assembleRelease

$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
& $adb uninstall nl.sparkstock.app
& $adb install -r app\build\outputs\apk\release\app-release.apk
& $adb shell monkey -p nl.sparkstock.app -c android.intent.category.LAUNCHER 1
& $adb logcat -d --pid=(& $adb shell pidof nl.sparkstock.app)
```

If the local APK runs cleanly on a real device, EAS production builds almost always succeed.

**Note:** `assembleRelease` (APK) has looser variant matching than `bundleRelease` (AAB). For AGP-variant errors (see `references/agp-version-pin.md`), reproduce with `:app:bundleRelease`, not `assembleRelease`.

## Windows: `npm install` fails with EBUSY on `react-native-screens/...lint-cache/*.jar`

`react-native-screens`'s published tarball contains pre-built Android lint cache artifacts. After any Gradle run, the Gradle daemon (`java.exe`) keeps file handles open inside `node_modules/react-native-screens/android/build/intermediates/lint-cache/`. A subsequent `npm install` that tries to replace `react-native-screens` fails immediately with `EBUSY rename ...`. Windows Defender exclusions don't help — the lock is the daemon, not the scanner.

Fix sequence:

```powershell
Get-Process java -ErrorAction SilentlyContinue | Stop-Process -Force
Remove-Item -Recurse -Force node_modules, package-lock.json
npm install
```

Verify no stale daemons remain with `Get-Process java` before the install.
