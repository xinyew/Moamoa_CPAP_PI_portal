# CPAP Pressure Injury Visualization Portal

A real-time, high-fidelity monitoring dashboard designed for the CPAP PI Sensing System (KMM PMask). Built with **React**, **Vite**, and **Recharts**.

## Features

- **Hybrid Connectivity**: **Web Bluetooth** (wireless, NUS binary stream) and **RTT (wired)** via the debug probe — run `python ../Moamoa_CPAP_PI_firmware/scripts/rtt_bridge.py` and connect; the board has no USB serial.
- **High-Fidelity Visualization**: 
    - Dedicated, vertically stacked charts for Red, IR, and Green PPG channels.
    - Real-time contact-pressure plots (mbar) for the 4 MS5611 sites.
    - Dynamic Y-axis auto-scaling to resolve subtle physiological signals.
- **Signal Processing**:
    - Toggleable **Exponential Moving Average (EMA)** filter for noise reduction.
    - Low-latency rendering (device-timebase plotting, jitter-free).
- **Data Logging**:
    - **CSV Recording**: Capture entire sessions with high precision for offline analysis.
- **Robustness**: 
    - Built-in Error Boundaries and strict data validation to prevent UI crashes from serial noise.

## Tech Stack

- **Framework**: React 18 (Vite)
- **Visualization**: Recharts (Custom SVG rendering)
- **Icons**: Lucide-React
- **Communication**: Web Bluetooth API (BLE) and WebSocket (RTT bridge)

## BLE Interface Protocol (verified against firmware)

Verified 2026-07-30 against `Moamoa_CPAP_PI_firmware` (`src/comm/comm_protocol.h`,
`src/comm/comm_manager.c`, `src/comm/ble_manager.c`, `prj.conf`). This is the
**v2** protocol for the KMM PMask 4-site board. The older `CPAP_PI_firmware`
repo implements the incompatible **v1** protocol (frame types `0x01`/`0x02`,
176 B or 224 B DATA, FSR block) — this portal does **not** parse v1 frames.

### Transport

| Item | Value |
| --- | --- |
| Advertised name | `KMM_PMask_Control` (portal filters on name prefixes `KMM`, `CPAP`) |
| GATT service | Nordic UART Service (NUS) `6e400001-b5a3-f393-e0a9-e50e24dcca9e` |
| TX characteristic (board → portal, notify) | `6e400003-b5a3-f393-e0a9-e50e24dcca9e` |
| RX characteristic (portal → board, write) | `6e400002-b5a3-f393-e0a9-e50e24dcca9e` |
| Connection params | board requests 15–30 ms interval, latency 0, timeout 4 s |
| PHY / MTU | board requests 2M PHY; DLE 251, ATT MTU 247 (a 204 B DATA frame needs MTU ≥ 207 to fit one notification) |
| Concurrency | each board accepts **one** central connection (`CONFIG_BT_MAX_CONN=1`); the portal can connect to up to 10 boards at once |
| Byte order | little-endian throughout |

All frames start with magic `0xC9A5` (u16 LE). One frame per NUS notification.
On connect the portal writes `'B'` (0x42) to RX to force binary mode.

### DATA frame — type `0x11`, 204 B, every 40 ms (25/s)

Each frame batches 4 sensor ticks at 10 ms each (100 Hz sampling).

| Offset | Size | Field |
| --- | --- | --- |
| 0 | u16 | magic `0xC9A5` |
| 2 | u8 | type = `0x11` |
| 3 | u8 | seq (wraps) |
| 4 | u32 | `t_ms` — device uptime of the **last** tick in the frame (used as the chart timebase; sample *k* of *n* is at `t_ms − (n−1−k)·10 ms`) |
| 8 | u8 | `ppg_valid_mask` (bit N = PPG site N+1 live) |
| 9 | u8 | `n_samples` (= 4) |
| 10 | u8 | `baro_ok_mask` (bit N = baro N+1 live) |
| 11 | u8 | reserved |
| 12 | 144 B | **PPG block** — sensor-major: sensor 0..3 × sample 0..3 × (red, ir, green) each u24. Absent sensors zero-filled. `sample s,k` red at `12 + s·36 + k·9` |
| 156 | 48 B | **BARO block** — sample-major: sample 0..3 × baro 1..4, pressure as u24 **Pa** (portal displays Pa/100 = mbar). `sample k, baro b` at `156 + k·12 + b·3` |
| **204** | | total |

### STATUS frame — type `0x12`, 45 B, every 1 s

| Offset | Size | Field |
| --- | --- | --- |
| 0 | u16 | magic `0xC9A5` |
| 2 | u8 | type = `0x12` |
| 3 | u8 | seq |
| 4 | u32 | `t_ms` |
| 8 | 12 B | 3 × { i16 SHT40 temp (0.01 °C), u16 SHT40 RH (0.01 %) } |
| 20 | 6 B | 3 × i16 TMP117 skin temp (0.01 °C) |
| 26 | 8 B | 4 × i16 baro temp (0.01 °C) — *not currently displayed by the portal* |
| 34 | u16 | `vbat_mv` |
| 36 | u8 | flags: bit0 = mask present, bit1 = SD ok |
| 37 | u8 | `rate_ppg` (Hz achieved) |
| 38 | u8 | `rate_baro` (Hz achieved) |
| 39 | u8 | `ppg_valid_mask` |
| 40 | u8 | `baro_ok_mask` |
| 41 | u8 | `sht_mask` |
| 42 | u8 | `tmp_mask` |
| 43 | u8 | `ble_drops_last_sec` (frames shed, saturating) |
| 44 | u8 | `ble_decim` (current AIMD pacing: board sends every Nth frame) |
| **45** | | total |

The portal tolerates a 43 B STATUS frame (an older v2 build without the two
link-health bytes) by defaulting `ble_drops = 0`, `ble_decim = 1`.

### RX commands (single ASCII byte, portal → board)

| Byte | Effect |
| --- | --- |
| `'B'` (0x42) | binary streaming (default; portal sends this on connect) |
| `'J'` (0x4A) | JSON debug mode — 1 Hz JSON line instead of binary frames: `{"r":..,"i":..,"g":..,"p":<Pa>,"t":..,"h":..,"skin":..,"vbat":<mV>}` |

### Link behavior

- The board sheds the **oldest** queued frame when the BLE queue is full, so
  the newest data keeps flowing; shed frames appear as device-time jumps and
  the portal breaks the chart trace (null point) instead of bridging the gap.
- AIMD pacing: under sustained congestion the board decimates to every Nth
  DATA frame (`ble_decim` in STATUS); the portal shows this as "paced ×N".

## Multi-Board Support

The portal connects to **up to 10 boards simultaneously** over BLE. Each
board is one Web Bluetooth device connection (each board accepts a single
central). A tab bar in the header switches which board's dashboard is shown;
all connected boards keep streaming and recording in the background.
Recording produces one CSV per board, named after the board. RTT (wired)
remains a single-board source and occupies one tab.

## Getting Started

### Installation
1. Navigate to the project directory:
   ```bash
   cd CPAP_PI_portal
   ```
2. Install dependencies:
   ```bash
   npm install
   ```

### Running Locally
1. Start the development server:
   ```bash
   npm run dev
   ```
2. Open your browser to the provided local URL (usually `http://localhost:5173`).
3. **Important**: Use a Chromium-based browser (Chrome or Edge) for Web Bluetooth support.

## Usage

1. **Interface Select**: Use the toggle in the header to choose between **RTT (wired)** or **BLE**. For RTT, start the bridge first: `python ../Moamoa_CPAP_PI_firmware/scripts/rtt_bridge.py` (requires the J-Link probe; close other RTT sessions).
2. **Board LEDs**: LED1 = heartbeat, LED2 = BLE connected.
3. **Connect**: Click "Add Board" to pair a board (repeat for up to 10 boards); use the tabs to switch between boards.
4. **Filtering**: Use the "Filter OFF/ON" button to smooth the waveforms (per board).
5. **Recording**: Click "Start Recording" to begin logging data. When finished, click "Stop & Save" to download one CSV per board.

## Related Repositories

- `../Moamoa_CPAP_PI_firmware` — **current** KMM PMask 4-site board firmware (protocol v2, this portal's peer).
- `../CPAP_PI_firmware` — legacy 3-PPG/FSR board firmware (protocol v1, **not compatible** with this portal).
