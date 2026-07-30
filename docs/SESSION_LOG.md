# Claude Session Log — CPAP PI Portal

Purpose: detailed record of what was done in each Claude Code session so
future sessions (and humans) can pick up without re-deriving anything.
Newest session at the top. Keep appending; do not rewrite history.

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

(Implementation details appended below as commits land.)

### Part 3 — Android tablet app (branch `android-tablet-app`)

Plan (as approved by user):
- Capacitor 6 project wrapping the same Vite/React build.
- `@capacitor-community/bluetooth-le` replaces Web Bluetooth via a small
  transport adapter so `useComm` logic (frame parsing, history, CSV) is
  shared, not forked.
- No RTT mode in the app (user said not needed): the RTT/BLE toggle is
  hidden when running natively.
- CSV export uses Capacitor Filesystem/Share instead of anchor-download.
- Target: Samsung Android tablet (landscape), minSdk per plugin
  requirements (BLE needs Android 6+; runtime permissions for
  BLUETOOTH_SCAN/BLUETOOTH_CONNECT on Android 12+).

(Implementation details appended below as commits land.)

### Commits this session

(appended as they are made)

- `main`: "docs: verified BLE v2 protocol vs Moamoa firmware; fix stale refs"
