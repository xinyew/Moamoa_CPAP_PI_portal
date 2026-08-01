# Claude Session Log — CPAP PI Portal

Purpose: detailed record of what was done in each Claude Code session so
future sessions (and humans) can pick up without re-deriving anything.
Newest session at the top. Keep appending; do not rewrite history.

---

## Session 2026-08-01 (later) — compact one-screen layout on `rev2-enhancement-xinye`

User request: make the portal fit ONE screen with no scrolling (web first;
the Android app will be updated LATER — explicitly deferred by the user).
Working branch: `rev2-enhancement-xinye` (created from
`origin/rev2-enhancement`; session log carried over from main).

Layout architecture (src/index.css + src/Dashboard.jsx):
- `#root` is 100vh (`overflow: auto` + container `min-height: 540px` as a
  floor — below that a scrollbar appears instead of clipping).
- NOTE: App.jsx wraps the dashboard in `<div class="App">`; that div needs
  `height: 100%` or the whole percentage-height chain silently collapses
  to the min-height floor (found live via computed styles).
- `.dashboard-container`: 12-col grid, `grid-template-rows: auto auto`
  (header, strip) + `grid-auto-rows: minmax(0, 1fr)` — every implicit
  chart row splits the leftover height evenly, so BOTH views fit
  automatically: Overlay = 2 rows (2x2), Split = 4 rows (4-across).
- Chart cards are `.chart-card` flex columns (`.chart-head` auto +
  `.chart-body` flex-1 min-height:0) with `ResponsiveContainer
  height="100%"` — no fixed pixel chart heights anywhere anymore.
- The old env-card + two toolbar cards merged into ONE `.strip-card` row:
  RH / Air C / Skin C / battery / SD + Window Full-5s + PPG RAW-AC +
  Pressure ABS-delta-Tare + fault note (ellipsized, tooltip carries detail).
- Compacted: paddings, button/segment sizes, axis fonts 10px, axis height
  16, Y-axis width 44-48, legend 14px (pressure chart only), PPG latest
  value moved into the card header, header subtitle one line, Record
  button labels shortened.
- Overlay: pressure + 3 PPG each `span 6` (2x2). Split: minis `span 3`
  (4-across; 16 cards + strip + header all on screen).

Verified in Chrome (dev server :5199) with Demo mode: Overlay and Split
both fill exactly one 1568x774 viewport, no scrollbars, all controls
visible. Split = 16 readable charts.

Not done yet (deferred by user): the same compact treatment for the
Android app branch.

---

## Session 2026-08-01 (cont.) — protocol v2.1: 'T' wall-clock sync complete

User supplied the v2.1 protocol integration spec (adds RX command
'T' 0x54 + u64 LE epoch-ms, 9 B total). Cross-checked against
Moamoa_CPAP_PI_firmware @ 14f741f: confirmed TSYNC record type 0x13
(16 B) is SD-LOG ONLY — never sent over BLE, portal parses nothing new.
Firmware maps monotonic uptime -> wall clock retroactively for the whole
boot; the offline doctor-facing SD reader (firmware repo 3af8d89)
drift-corrects between TSYNC records.

State on `rev2-enhancement-xinye`:
- On-connect 'B' then 'T' write: ALREADY PRESENT (user's commit 5ce1366)
  — the spec's own caution; verified before touching anything.
- ADDED this session: periodic re-sync every 10 min while connected
  (TSYNC_INTERVAL_MS). NUS RX characteristic kept in `rxCharRef`;
  `sendTimeSync()` helper; interval started after the on-connect sync,
  cleared on gattserverdisconnected (and 'T' failures are swallowed —
  next interval retries). RTT path unchanged (bridge is read-only).
- For the future multi-board port (main branch): the spec requires ONE
  sync per board connection + its own 10-min timer per store — put both
  in the per-board store, not module-level.

---

## Session 2026-08-01 (later still) — split-view site columns + sweet-neon theme

On `rev2-enhancement-xinye`, after the compact layout:

1. Split view reorganized (552fbd3): channel-major render order + each
   mini chart pinned to a fixed site lane (explicit grid-column), so
   column N = Pressure N / Red N / IR N / Green N top-to-bottom, and an
   offline site leaves an empty lane instead of shifting the grid.
2. Sweet-neon theme (user request, replacing the slate/purple look):
   - KEY DESIGN CHANGE: series color now follows the SITE, not the
     channel. One fixed categorical palette everywhere:
     S1 #2ee880 green / S2 #ff4db8 pink / S3 #f0b000 amber / S4 #00c4ea
     cyan. Chart title/icon carries the channel. Split-view columns
     inherit their site's color.
   - Palette validated with the dataviz skill checker against surface
     #0f111b: worst adjacent pair dE 16.0 (deutan), 28.2 (normal), all
     >= 3:1 contrast, chroma pass. Lightness 0.70-0.82 sits ABOVE the
     dark-mode band (0.48-0.67) DELIBERATELY — neon aesthetic on thin
     line marks; legends/tooltips/columns are the secondary encoding.
     (Same-hue 4-step ramps — the old approach — cannot pass the
     separation floors on a dark surface; validator proved it.)
   - CSS: bg #05050a with twin magenta/cyan radial glows, cyan-tinted
     card borders, neon accent vars, cyan->pink title gradient, tinted
     chart grid + tooltip bg.
   - NOTE: user committed 5ce1366 mid-session (wall-clock 'T' sync in
     useComm.js + .gitignore android/) — theme work rebased cleanly on
     top; one grid-stroke edit had been clobbered by the file shuffle
     and was reapplied.
   - Verified in Chrome demo mode, Overlay + Split, one screen each.

---

## Session 2026-08-01 — review of collaborator branch `rev2-enhancement`

Reviewed (not merged) two branches pushed by ysw0624z:

- `origin/rev2-enhancement` — ONE commit `96d5f57` ("Rev2: fix waveform
  rendering, surface sensor faults, add pressure delta mode"), forked
  from `b388ef2` = BEFORE this repo's multi-board refactor (919aba1) and
  protocol README (b94f2bb). It rewrites `useComm.js`/`Dashboard.jsx`
  on the old single-board architecture.
- `origin/feature/dashboard-enhancements` — 4 earlier commits (demo
  mode, markers, window/AC controls, docs), forked from f51f8df.
  Superseded: rev2-enhancement carries all of it forward.

What rev2 contains (verified against the diff + firmware source):
1. Numeric Recharts time axis (type="number", dataMin/dataMax) — fixes
   the ~9x timebase distortion at decimated-frame seams that made clean
   waveforms look like noise. THIS BUG STILL EXISTS ON MAIN (multi-board
   Dashboard kept the category axis).
2. Dropout nulling — honours DATA validity masks (bytes 8/10) plus the
   all-three-zero zero-fill signature (correct: firmware derives the
   mask from the LAST tick only, verified in comm_manager.c). Baro 0 Pa
   -> null. Single-channel zero kept (real dead-LED fault).
3. Fault chips: OFFLINE / ALL-ZERO / per-site yield %, mapped to mux
   channels; site visibility = STATUS mask OR actual data yield.
4. SITE_MAP = [2,1,3,4]: display sites 1<->2 swapped (incl. bit-swapped
   status masks) to match rev2 mask physical wiring. CAUTION: baked-in
   hardware assumption — confirm whether rev1 masks / tablet-app boards
   share this wiring before adopting globally.
5. mbar -> mmHg (/133.322) + ABS/delta toggle + Tare; CSV format change
   (Time_s first, Marker/Time (s) last); HISTORY_LEN 300->800; demo
   mode, pause, markers (M), adjustable EMA, Full/5s window, RAW/AC;
   Launch-CPAP-FULL-v2.bat (port 5172); title "CPAP PI Dashboard -
   Full_v2".

Assessment given to user: a git merge into main will conflict on nearly
every hunk (same two files rewritten both sides). Correct path is a
PORT onto main's per-board-store architecture (ingest changes into the
per-board parser; UI onto the tabbed dashboard; decide per-board vs
global for pause/tare/markers). Android app inherits via shared parser
once ported. mmHg + site-swap need README updates; CSV schema change
may affect downstream scripts. Port not yet started — awaiting user
decision.

---

## Session 2026-07-30 — protocol audit, multi-board (×10), Android tablet app

User request (3 parts):
1. Double-check the BLE interface protocol against the board firmware and
   document it in the README.
2. Make the portal able to connect to up to 10 boards simultaneously.
3. On a brand-new branch, create a replica app for a Samsung Android tablet
   that works like the web portal (no RTT needed there).

User decisions (asked via question tool):
- Multi-board UI = **tabs, one board at a time** (all boards stream/record in
  the background; tab bar switches the viewed board).
- Android app = **Capacitor + native BLE plugin** (wraps the same React
  dashboard in an installable APK; Web Bluetooth swapped for
  `@capacitor-community/bluetooth-le`).

### Part 1 — BLE protocol verification (findings)

There are TWO firmware repos side-by-side in `C:\Users\xwang3239\Downloads`:

| Repo | Board | Protocol | Status |
| --- | --- | --- | --- |
| `Moamoa_CPAP_PI_firmware` | KMM PMask 4-site (`KMM_PMask_Control`) | **v2**: DATA `0x11` 204 B, STATUS `0x12` 45 B | **current — this is the portal's peer** |
| `CPAP_PI_firmware` | older 3-PPG + FSR board | v1: DATA `0x01` (176 B on `integration` branch, 224 B on `main`), STATUS `0x02` 41 B | legacy, NOT compatible with the portal |

Verification method: read `Moamoa_CPAP_PI_firmware/src/comm/comm_protocol.h`
(authoritative layout comment + defines), cross-checked the actual byte
packing in `comm_manager.c` (`build_data_frame`, `build_status_frame`,
`ble_send_json_line`), BLE config in `ble_manager.c` + `prj.conf`, then
compared field-by-field against the portal parser `src/useComm.js`
(`processBinaryFrame`, `processDataLine`).

Result: **the portal parser matches firmware v2 exactly.** Every offset
checked: DATA header (t_ms u32 @4, n @9), PPG block sensor-major @12
(u24 r/i/g), BARO block sample-major @156 (u24 Pa, portal /100 → mbar),
STATUS SHT/TMP117/vbat/flags/rates/masks @8..42, link bytes @43-44.
JSON debug mode ('J') field names also match (`r,i,g,p,t,h,skin,vbat`).

Two documentation bugs found and fixed (no behavior bugs):
- Portal README pointed at `../CPAP_PI_firmware` (the incompatible v1 repo)
  for the RTT bridge; `rtt_bridge.py` actually lives in
  `../Moamoa_CPAP_PI_firmware/scripts/`. Fixed.
- `useComm.js` comment said STATUS is "43 B"; firmware sends 45 B (the
  portal already tolerated both — 43 B is an older v2 build without the
  `ble_drops`/`ble_decim` bytes). Comment fixed, parser unchanged.

Key transport facts (now in README "BLE Interface Protocol" section):
- NUS UUIDs 6e400001/6e400002(RX,write)/6e400003(TX,notify)-b5a3-f393-e0a9-e50e24dcca9e.
- Advertised name `KMM_PMask_Control`; portal filters prefixes `KMM`, `CPAP`.
- Board requests 15–30 ms conn interval, 2M PHY; DLE 251 / ATT MTU 247
  (204 B frame + 3 B ATT header = 207 minimum MTU).
- `CONFIG_BT_MAX_CONN=1` on the board — one central per board, which is why
  multi-board = portal holds N independent device connections.
- Board sheds OLDEST queued frame on congestion + AIMD decimation
  (`ble_decim`); portal breaks chart traces on device-time jumps > 200 ms.
- Portal writes 'B' (0x42) on connect to force binary mode.

### Part 2 — multi-board support (up to 10 boards)

Design (as approved by user):
- `useComm.js` refactored to manage a map of device connections keyed by a
  stable id. Each board gets its own: history buffer, latest/status state,
  EMA filter state, device-timebase tracking, and CSV recording buffer.
- Web Bluetooth: `requestDevice` is called once per "Add Board" click (the
  chooser can only pick one device at a time); up to `MAX_BOARDS = 10`.
- RTT stays single-source (one bridge = one board) and occupies one tab.
- Dashboard gets a tab bar: one tab per connected board; all boards stream
  and record in the background, only the active tab is rendered (keeps
  Recharts rendering load flat regardless of board count).
- Recording is global (one button) but writes one CSV per board:
  `KMM_PMask_<name>.csv`.
- Filter toggle is global (applies to all boards) — kept simple on purpose.

Implementation (done, commit on `main`):
- `src/useComm.js` fully refactored around per-board mutable stores in a
  ref (`storesRef: Map<id, store>`). Each store owns: `history` (300 pts),
  `latest`, `status`, `filterState` (EMA), `recorded` (CSV rows),
  `lastDevTime` (loss-break detection), `textBuffer` (JSON debug mode),
  plus the `device` (BLE) or `ws` (RTT) handle.
- Ingest happens entirely in refs; React re-renders come from a 40 ms
  snapshot interval that copies only the ACTIVE board's history/latest
  into state. 10 boards x 25 frames/s therefore never means 250 React
  renders/s — render load is flat regardless of board count.
- `addBoard()`: BLE path calls `requestDevice` once per click (the Web
  Bluetooth chooser can only return one device), keyed by `device.id`
  (stable per origin). Re-picking an already-connected board just
  activates its tab; re-picking a disconnected one reuses its store so
  history/recording continue. RTT path is a singleton board id `'rtt'`.
- `disconnectBoard(id)` closes GATT/WS and removes the tab; on
  `gattserverdisconnected` the tab stays (red dot) so data isn't lost.
- Recording is global; stop downloads one CSV per board:
  `KMM_PMask_<name>.csv` (browser may prompt to allow multiple downloads).
- Filter toggle is global; EMA state is per board. Filter now also resets
  its state across loss-break null points (small correctness improvement).
- `src/Dashboard.jsx`: tab bar under the header (`.board-tabs` in
  `index.css`) with connection dot + kind icon + name and an "N/10
  boards" counter; "+ Add Board" replaces "Connect"; "Disconnect" acts on
  the active board only; the RTT/BLE toggle picks the interface for the
  NEXT added board and hides at 10 boards.
- The old `disconnect()` = `window.location.reload()` is gone.
- Verified: `npm run build` passes. ESLint reports only pre-existing
  issues (react/prop-types in App/Dashboard, one empty catch) that also
  existed before this session.

### Part 3 — Android tablet app (branch `android-tablet-app`)

Implemented on branch `android-tablet-app` (branched from `main` after the
multi-board commit, so the app has 10-board support too):

- Capacitor 6 (`@capacitor/core|cli|android@6`) +
  `@capacitor-community/bluetooth-le@6.1.0`, `@capacitor/filesystem@6`,
  `@capacitor/share@6`. `capacitor.config.json`: appId
  `edu.gatech.kmm.pmask`, appName "KMM PMask Portal", webDir `dist`.
- `npx cap add android` generated the `android/` Gradle project
  (committed; template .gitignore excludes build outputs + copied web
  assets). Gradle 8.2.1, AGP per Capacitor 6, compileSdk 34, minSdk 22.
- Manifest permissions added: BLUETOOTH_SCAN (neverForLocation) +
  BLUETOOTH_CONNECT (Android 12+), legacy BLUETOOTH/BLUETOOTH_ADMIN/
  ACCESS_FINE_LOCATION capped at maxSdkVersion 30, `bluetooth_le`
  hardware feature required.
- New `src/bleTransport.js` — the ONLY platform-specific file:
  `requestAndConnect({onData, onDisconnect})` → `{id, name, disconnect}`.
  Web impl = Web Bluetooth (name prefixes KMM/CPAP); native impl =
  BleClient with a scan filter on the NUS service UUID (the boards
  advertise it). Both deliver DataView notifications, both write 'B'
  (binary mode) to NUS RX on connect. Native plugin requests MTU 512 →
  board grants 247 → 204 B frames fit one notification.
  Also `saveCsv()` (web: anchor download; native: Documents via
  Filesystem) and `shareFiles()` (native share sheet).
- `useComm.js` refactored to use the transport (uniform `store.conn`
  handle); CSV filenames now timestamped; on native, `addBoard` always
  uses BLE and Dashboard hides the RTT toggle (`isNative` export).
- No RTT in the app per user instruction — web portal keeps it.

Toolchain set up on this PC (nothing was installed system-wide; no PATH
or registry changes — future sessions must set JAVA_HOME explicitly):
- Portable Temurin JDK 17.0.20 at `%LOCALAPPDATA%\Android\jdk\jdk-17.0.20+8`.
- Android SDK at `%LOCALAPPDATA%\Android\Sdk` (cmdline-tools "latest",
  platform-tools/adb, platforms;android-34, build-tools;34.0.0).
  License acceptance: sdkmanager --licenses could not read piped input,
  so the standard license hash files were written to `Sdk\licenses\`.
- `android/local.properties` (not committed) has
  `sdk.dir=C:/Users/xwang3239/AppData/Local/Android/Sdk`.

Build verified: `gradlew.bat assembleDebug` → BUILD SUCCESSFUL →
`android/app/build/outputs/apk/debug/app-debug.apk`.

Device install + on-device test (PASSED, 2026-07-30 ~17:23):
- Samsung tablet SM-X820, serial `R52Y20DR3JF`. First `adb` contact was
  "unauthorized"; after the user authorized USB debugging (an
  `adb kill-server`/restart re-triggered the prompt), `adb install -r`
  succeeded.
- Verified via adb screenshots, driving the UI with `adb shell input tap`:
  1. App launches; dashboard identical to web portal; RTT toggle
     correctly absent (native build).
  2. Tapping "+ Add Board" triggered the Android "Nearby devices"
     runtime permission, then the plugin's scan dialog.
  3. Scanner listed the real board: `[E8:F8:35:BC:56:37]
     KMM_PMask_Control` (NUS service UUID filter works).
  4. Selecting it connected and STREAMED LIVE: header showed
     "4x PPG @ 96Hz, 4x Baro @ 48Hz, mask attached, link full rate",
     LIVE badge, board tab "KMM_PMask_Control 1/10 boards", real
     telemetry (air 24.7/24.2/24.6 C, RH 42.3/43.6/41.3 %, skin
     24.3/24.0/23.8 C, vbat 3.67 V), and the 4-site contact-pressure
     chart plotting ~979 mbar traces. So the 204 B v2 frames arrive
     intact through the native BLE plugin (MTU OK) and the shared
     parser renders them.
- Not yet exercised on-device: CSV export via share sheet, multi-board
  with >1 physical board, JSON debug mode.

See `ANDROID.md` (on the branch) for the full build/install guide.

### Commits this session

(appended as they are made)

- `main` b94f2bb: "docs: verified BLE v2 protocol vs Moamoa firmware; fix stale refs"
- `main` 919aba1: "feat: connect up to 10 boards concurrently with board tabs"
- `android-tablet-app` c1e13d3: "chore(android): Capacitor 6 scaffold for the Samsung tablet app"
- `android-tablet-app` 2d271f9: "feat(android): platform BLE transport adapter; app is BLE-only"
- `android-tablet-app`: "docs(android): build/install guide; session log for APK build + toolchain"

### Open items / notes for the next session

- On-device smoke test PASSED (live board streaming; see Part 3). Still
  untested on the tablet: CSV export/share sheet, >1 simultaneous
  physical board, JSON debug mode.
- The Android branch intentionally does NOT merge back to `main` — the
  web portal stays Capacitor-free. If web-portal fixes land on `main`,
  rebase/merge `main` into `android-tablet-app` (there should be no
  conflicts outside package.json/package-lock.json).
- Web `useComm`/`Dashboard`/`bleTransport` changes on the branch are a
  superset of `main`'s multi-board code (main still has the pre-adapter
  in-hook Web Bluetooth code). If you want the adapter refactor on the
  web portal too, cherry-pick 2d271f9's src/ changes onto main minus the
  Capacitor imports — they are dynamic imports, so the web build works
  either way (vite code-splits them; verified in the branch build).
- ESLint has pre-existing errors (react/prop-types, one empty catch);
  `npm run build` is the working verification gate.
- 17 npm audit findings predate this session (dev-dependency chain).
