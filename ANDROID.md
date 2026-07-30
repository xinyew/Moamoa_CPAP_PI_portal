# KMM PMask Portal — Android Tablet App

The `android-tablet-app` branch wraps the exact same React dashboard in a
native Android app (Capacitor 6). It works like the web portal with one
difference: **no RTT mode** — the app is BLE-only (RTT needs the J-Link
bridge running on a PC). Up to 10 boards connect concurrently, same as
the web portal.

## How it works

- `src/bleTransport.js` is the only platform-specific layer. On the web
  it uses Web Bluetooth; in the app it uses
  `@capacitor-community/bluetooth-le` (a native BLE central). Everything
  else — frame parsing, multi-board stores, charts, recording — is the
  same code as the web portal.
- Native scanning filters on the NUS service UUID that the boards
  advertise, so the picker shows exactly the KMM PMask boards.
- The BLE plugin negotiates MTU 512 on Android; the board grants 247, so
  the 204 B DATA frames arrive as single notifications (same as web).
- CSV recordings are written to the tablet's **Documents** folder (one
  file per board, timestamped) and the Android share sheet opens so you
  can send them anywhere.
- Runtime permissions: Android 12+ asks for *Nearby devices*
  (BLUETOOTH_SCAN/CONNECT); Android 11 and older ask for *Location*
  (required by Android for BLE scanning).

## Prerequisites (already set up on the lab PC, 2026-07-30)

- Portable JDK 17: `%LOCALAPPDATA%\Android\jdk\jdk-17.0.20+8`
- Android SDK (cmdline-tools, platform-tools/adb, platform 34,
  build-tools 34.0.0): `%LOCALAPPDATA%\Android\Sdk`
- `android/local.properties` points `sdk.dir` at that SDK (not committed).

On a fresh machine, install any JDK 17 and the Android SDK (Android
Studio or cmdline-tools), then create `android/local.properties` with
`sdk.dir=<path to SDK>` using forward slashes.

## Build & install on the Samsung tablet

```powershell
# 1. Build the web bundle and copy it into the Android project
npm run build
npx cap sync android

# 2. Build the APK (from the repo root)
$env:JAVA_HOME = "$env:LOCALAPPDATA\Android\jdk\jdk-17.0.20+8"
cd android
.\gradlew.bat assembleDebug

# 3. Install on the tablet (USB debugging must be enabled + authorized)
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" install -r `
    app\build\outputs\apk\debug\app-debug.apk
```

APK output: `android/app/build/outputs/apk/debug/app-debug.apk`
(installable by copying to the tablet and opening it, too).

### Enabling USB debugging on the tablet

1. Settings → About tablet → Software information → tap **Build number**
   7 times (unlocks Developer options).
2. Settings → Developer options → enable **USB debugging**.
3. Plug into the PC, tap **Allow** on the "Allow USB debugging?" popup
   (tick "Always allow from this computer").

## Using the app

Identical to the web portal: tap **+ Add Board** once per board (the
native scanner dialog lists advertising `KMM_PMask_Control` boards),
switch boards with the tabs, Filter/Record work globally, Disconnect
acts on the active tab. Stopping a recording saves CSVs to Documents
and opens the share sheet.

## Releasing

`assembleDebug` builds a debug-signed APK, fine for lab use. For a
Play-Store or signed release build, create a keystore and a
`signingConfig` in `android/app/build.gradle`, then `assembleRelease`.
