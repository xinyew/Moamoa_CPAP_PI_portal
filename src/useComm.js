import { useState, useRef } from 'react';

const NUS_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const NUS_TX_CHARACTERISTIC_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
const NUS_RX_CHARACTERISTIC_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
const RTT_BRIDGE_URL = 'ws://localhost:8765'; // scripts/rtt_bridge.py

// Binary protocol v2 — must match firmware src/comm/comm_protocol.h
// (kmm-pmask 4-site topology: 4x PPG, 4x baro, 3x SHT40, 3x TMP117)
const MAGIC = 0xC9A5;
const TYPE_DATA = 0x11;   // 204 B
const TYPE_STATUS = 0x12; // 43 B
const TICK_MS = 10;
// Re-send the 'T' wall-clock sync every 10 min while connected — the
// board's RC clock drifts; repeats give the offline SD reader more
// TSYNC records to drift-correct between (protocol spec v2.1).
const TSYNC_INTERVAL_MS = 10 * 60 * 1000;

const WAVE_KEYS = ['r1','i1','g1','r2','i2','g2','r3','i3','g3','r4','i4','g4'];
// ~8 s at the 100 Hz sample rate — must exceed the longest selectable
// window (5 s) so the Full/5s toggle is a real zoom.
const HISTORY_LEN = 800;

// Slow EMA removed from each PPG channel to expose the pulsatile (AC) part —
// without it the 4 sites sit at very different DC levels and a shared
// auto-scaled axis renders the low-DC ones as an unreadable hash.
const AC_BASELINE_ALPHA = 0.02;

// Mask sites 1 and 2 sit on the opposite stream slots to their labels, so the
// stream is remapped to physical site order. SITE_MAP[streamIndex] = site shown.
// CH_OF then gives the mux channel behind each displayed site, so a warning can
// still point at the right hardware.
const SITE_MAP = [2, 1, 3, 4];
export const CH_OF = SITE_MAP.reduce((m, site, idx) => { m[site] = idx; return m; }, {});
const swapBits12 = (m) => (m & ~0b11) | ((m & 0b01) << 1) | ((m & 0b10) >> 1);

const emptyLatest = {
  r1: 0, i1: 0, g1: 0, r2: 0, i2: 0, g2: 0,
  r3: 0, i3: 0, g3: 0, r4: 0, i4: 0, g4: 0,
  p1: 0, p2: 0, p3: 0, p4: 0,
  sht1t: 0, sht1h: 0, sht2t: 0, sht2h: 0, sht3t: 0, sht3h: 0,
  tmp1: 0, tmp2: 0, tmp3: 0,
  vbat: 0, maskPresent: false, sdOk: false,
  ppgRate: 0, baroRate: 0,
  ppgMask: 0, baroMask: 0, shtMask: 0, tmpMask: 0,
  bleDrops: 0, bleDecim: 1,
};

export const useComm = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [commMode, setCommMode] = useState('bluetooth'); // 'bluetooth' or 'rtt'
  const [isRecording, setIsRecording] = useState(false);
  const [isFiltered, setIsFiltered] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isDemo, setIsDemo] = useState(false);

  const isRecordingRef = useRef(false);
  const isFilteredRef = useRef(false);
  const isPausedRef = useRef(false);
  const deviceRef = useRef(null);
  const wsRef = useRef(null);
  const rxCharRef = useRef(null);   // NUS RX, kept for periodic time re-sync
  const tsyncTimerRef = useRef(null);
  const demoTimerRef = useRef(null);
  const demoTickRef = useRef(0);

  // PPG smoothing strength for Filter ON — user-adjustable (0.01–1).
  // Smaller = stronger smoothing; 1 = no smoothing.
  const [filterAlpha, setFilterAlphaState] = useState(0.15);
  const filterAlphaRef = useRef(0.15);
  const setFilterAlpha = (v) => {
    const a = Math.min(1, Math.max(0.01, Number(v) || 0.15));
    setFilterAlphaState(a);
    filterAlphaRef.current = a;
  };
  const filterStateRef = useRef({});
  const baselineRef = useRef({}); // per-PPG-channel slow baseline for AC mode

  // Event markers: pressing Mark tags the NEXT sample, so the marker lands on
  // a real data point (drawn on every chart, saved in the CSV Marker column).
  const [markCount, setMarkCount] = useState(0);
  const markCounterRef = useRef(0);
  const markNextRef = useRef(0);
  const addMark = () => {
    markCounterRef.current += 1;
    markNextRef.current = markCounterRef.current;
    setMarkCount(markCounterRef.current);
  };

  const [latestData, setLatestData] = useState(emptyLatest);
  const [history, setHistory] = useState([]);
  const statusRef = useRef({});
  const recordedDataRef = useRef([]);
  const lastDevTimeRef = useRef(null);

  // Timestamp (device timebase) of the first sample of this session — charts
  // show seconds elapsed since the stream started.
  const [streamStart, setStreamStart] = useState(null);
  const streamStartRef = useRef(null);

  const applyFilter = (point) => {
    if (!isFilteredRef.current) return point;
    const fs = filterStateRef.current;
    const out = { ...point };
    const alpha = filterAlphaRef.current;
    for (const key of WAVE_KEYS) {
      if (point[key] == null) continue; // gap (null) points pass through
      if (fs[key] === undefined || isNaN(fs[key])) fs[key] = point[key];
      fs[key] = alpha * point[key] + (1 - alpha) * fs[key];
      out[key] = Math.round(fs[key]);
    }
    return out;
  };

  const pushPoints = (points) => {
    if (points.length && streamStartRef.current === null) {
      streamStartRef.current = points[0].timestamp;
      setStreamStart(points[0].timestamp);
    }
    const processed = points.map(applyFilter);
    // AC extraction per PPG channel: value minus a slow baseline, computed
    // AFTER smoothing so the Filter control affects AC traces too. Gap points
    // stay null so the chart still breaks the trace there.
    const bl = baselineRef.current;
    for (const p of processed) {
      for (const key of WAVE_KEYS) {
        if (p[key] == null) { p[`${key}Ac`] = null; continue; }
        if (bl[key] === undefined || isNaN(bl[key])) bl[key] = p[key];
        bl[key] = AC_BASELINE_ALPHA * p[key] + (1 - AC_BASELINE_ALPHA) * bl[key];
        p[`${key}Ac`] = Math.round(p[key] - bl[key]);
      }
    }
    // Attach a pending marker to the most recent sample of this batch so it
    // flows to BOTH the recorded copy and the on-screen history.
    if (markNextRef.current) {
      processed[processed.length - 1].mark = markNextRef.current;
      markNextRef.current = 0;
    }
    // Recording keeps capturing even while the display is paused
    if (isRecordingRef.current) {
      for (const p of processed) {
        recordedDataRef.current.push({ ...p, ...statusRef.current });
      }
    }
    // Stop (pause) freezes the charts without dropping the connection
    if (isPausedRef.current) return;
    const last = processed[processed.length - 1];
    setLatestData(prev => ({ ...prev, ...last, ...statusRef.current }));
    setHistory(prev => [...prev, ...processed].slice(-HISTORY_LEN));
  };

  const readU24 = (dv, off) => dv.getUint16(off, true) + (dv.getUint8(off + 2) << 16);

  const processBinaryFrame = (dv) => {
    if (dv.byteLength < 12 || dv.getUint16(0, true) !== MAGIC) return false;
    const type = dv.getUint8(2);

    if (type === TYPE_DATA) {
      const n = dv.getUint8(9);
      if (dv.byteLength < 204) return true; // truncated: drop
      // Device-timebase plotting: the frame carries the device's
      // millisecond uptime — jitter-free x values regardless of BLE
      // burstiness, no receive-side smoothing heuristics needed.
      const devT = dv.getUint32(4, true);
      const wallT = Date.now();
      const points = [];
      // Real losses (shed frames) appear as device-time jumps; insert
      // a null point so charts BREAK the trace instead of bridging.
      if (lastDevTimeRef.current !== null && devT - lastDevTimeRef.current > 200) {
        const gap = { timestamp: lastDevTimeRef.current + 1 };
        for (const k2 of WAVE_KEYS) gap[k2] = null;
        for (let b = 1; b <= 4; b++) gap[`p${b}`] = null;
        points.push(gap);
      }
      lastDevTimeRef.current = devT;
      // Per-frame sensor validity. The firmware transmits 0 for any sensor
      // whose read failed this tick (comm_manager.c: `ps->valid ? ps->red : 0`),
      // so plotting the raw stream draws those dropouts as plunges to zero —
      // that is what showed up as spikes/glitches. Null them instead so the
      // chart breaks the trace and the gap is visible for what it is.
      //
      // The frame's mask is NOT enough on its own: the firmware derives it from
      // the LAST tick only (`acc[COMM_TICKS_PER_FRAME - 1].ppg[s].valid`) while
      // the frame carries four. A sensor that failed on ticks 0-2 but recovered
      // on tick 3 is reported "valid" and its zero-filled samples slip through.
      // So also treat an exact 0 as no-data — it is the firmware's sentinel, and
      // a live channel always reads at least its dark current (never exactly 0).
      // Only an ALL-THREE-zero sample is the zero-fill signature: the firmware
      // writes 0 to red+ir+green together when a read fails. A single channel
      // reading 0 while its siblings carry data is a real measurement (a dark
      // LED), and blanking it would hide exactly the fault we are hunting.
      const ppgValid = dv.getUint8(8);
      const baroOk = dv.getUint8(10);
      for (let k = 0; k < n; k++) {
        const pt = { timestamp: devT - (n - 1 - k) * TICK_MS, wallT };
        // PPG block: sensor-major, 4 samples x (r,i,g) u24
        for (let s = 0; s < 4; s++) {
          const site = SITE_MAP[s];
          if ((ppgValid & (1 << s)) === 0) {
            pt[`r${site}`] = null; pt[`i${site}`] = null; pt[`g${site}`] = null;
            continue;
          }
          const base = 12 + s * (n * 9) + k * 9;
          const r = readU24(dv, base);
          const i = readU24(dv, base + 3);
          const g = readU24(dv, base + 6);
          const dead = (r === 0 && i === 0 && g === 0); // zero-fill signature
          pt[`r${site}`] = dead ? null : r;
          pt[`i${site}`] = dead ? null : i;
          pt[`g${site}`] = dead ? null : g;
        }
        // Baro block: 4 samples x 4 x u24 Pa -> mmHg (100 Hz).
        // 1 mmHg = 133.322 Pa (PI literature uses mmHg, e.g. ~32 mmHg
        // capillary pressure); absolute pressure reads ~760 mmHg.
        const bb = 156 + k * 12;
        for (let b = 0; b < 4; b++) {
          const pa = (baroOk & (1 << b)) === 0 ? 0 : readU24(dv, bb + b * 3);
          // 0 Pa is impossible for an absolute barometer (~101 kPa) — sentinel.
          pt[`p${SITE_MAP[b]}`] = pa === 0 ? null : Math.round(pa / 133.322 * 100) / 100;
        }
        points.push(pt);
      }
      pushPoints(points);
      return true;
    }

    if (type === TYPE_STATUS) {
      if (dv.byteLength < 43) return true;
      const flags = dv.getUint8(36);
      const hasLink = dv.byteLength >= 45;
      statusRef.current = {
        sht1t: dv.getInt16(8, true) / 100,  sht1h: dv.getUint16(10, true) / 100,
        sht2t: dv.getInt16(12, true) / 100, sht2h: dv.getUint16(14, true) / 100,
        sht3t: dv.getInt16(16, true) / 100, sht3h: dv.getUint16(18, true) / 100,
        tmp1: dv.getInt16(20, true) / 100,
        tmp2: dv.getInt16(22, true) / 100,
        tmp3: dv.getInt16(24, true) / 100,
        vbat: dv.getUint16(34, true),
        maskPresent: (flags & 1) !== 0,
        sdOk: (flags & 2) !== 0,
        ppgRate: dv.getUint8(37),
        baroRate: dv.getUint8(38),
        ppgMask: swapBits12(dv.getUint8(39)),
        baroMask: swapBits12(dv.getUint8(40)),
        shtMask: dv.getUint8(41),
        tmpMask: dv.getUint8(42),
        bleDrops: hasLink ? dv.getUint8(43) : 0,
        bleDecim: hasLink ? dv.getUint8(44) : 1,
      };
      setLatestData(prev => ({ ...prev, ...statusRef.current }));
      return true;
    }
    return true;
  };

  // Dev-only hook: lets tests/console feed synthetic binary frames without
  // hardware (mirrors the eval app's window.__feedLine).
  if (import.meta.env.DEV) window.__feedFrame = processBinaryFrame;

  // Firmware JSON debug mode (1 Hz over BLE, command 'J')
  const processDataLine = (line) => {
    line = line.trim();
    if (!(line.startsWith('{') && line.endsWith('}'))) return;
    try {
      const data = JSON.parse(line);
      const pt = {
        timestamp: Date.now(),
        r1: data.r ?? 0, i1: data.i ?? 0, g1: data.g ?? 0,
        p1: Math.round((data.p ?? 0) / 133.322 * 100) / 100, // Pa -> mmHg
      };
      statusRef.current = {
        ...statusRef.current,
        sht1t: data.t ?? 0, sht1h: data.h ?? 0,
        tmp1: data.skin ?? 0, vbat: data.vbat ?? 0,
      };
      pushPoints([pt]);
    } catch (e) {}
  };

  // ── Demo mode: synthetic 4xPPG + 4xBaro + env stream, no hardware ──
  // Emits a batch of 4 samples every 40 ms (like a 100 Hz binary DATA frame).
  const demoBatch = () => {
    const now = Date.now();
    const pts = [];
    for (let j = 0; j < 4; j++) {
      const k = demoTickRef.current++;
      const t = k / 100; // seconds
      const beat = Math.sin(2 * Math.PI * 1.2 * t) + 0.3 * Math.sin(2 * Math.PI * 2.4 * t + 1.2);
      const nz = () => (Math.random() - 0.5) * 60;
      const pt = { timestamp: k * TICK_MS, wallT: now };
      for (let s = 0; s < 4; s++) {
        pt[`r${s + 1}`] = Math.round(52000 + s * 1000 + 1500 * beat + nz());
        pt[`i${s + 1}`] = Math.round(98000 + s * 1000 + 2600 * beat + nz());
        pt[`g${s + 1}`] = Math.round(23000 + s * 800 + 900 * beat + nz());
      }
      for (let b = 0; b < 4; b++) {
        // ~760 mmHg absolute with a slow breathing-like ripple
        pt[`p${b + 1}`] = Math.round((760 + b * 0.4 + 3 * Math.sin(2 * Math.PI * 0.2 * t + b)) * 100) / 100;
      }
      pts.push(pt);
    }
    statusRef.current = {
      sht1t: 24.5, sht1h: 45.2, sht2t: 24.8, sht2h: 44.9, sht3t: 25.1, sht3h: 45.6,
      tmp1: 33.2, tmp2: 33.8, tmp3: 34.1,
      vbat: 3850, maskPresent: true, sdOk: true,
      ppgRate: 100, baroRate: 100,
      ppgMask: 0b1111, baroMask: 0b1111, shtMask: 0b111, tmpMask: 0b111,
      bleDrops: 0, bleDecim: 1,
    };
    pushPoints(pts);
  };

  const toggleDemo = () => {
    if (demoTimerRef.current) {
      clearInterval(demoTimerRef.current);
      demoTimerRef.current = null;
      setIsDemo(false);
    } else {
      // Demo is NOT a real connection: leave isConnected false so the Connect
      // button stays and Disconnect never shows.
      demoTickRef.current = 0;
      lastDevTimeRef.current = null;
      streamStartRef.current = null; // restart the elapsed-time clock
      setStreamStart(null);
      baselineRef.current = {};      // clean AC baseline for the fresh start
      setHistory([]);                // don't mix demo samples with old data
      isPausedRef.current = false;   // never start demo in a paused state
      setIsPaused(false);
      setIsDemo(true);
      demoTimerRef.current = setInterval(demoBatch, 40);
    }
  };

  const togglePause = () => {
    const next = !isPaused;
    setIsPaused(next);
    isPausedRef.current = next;
  };

  // Wired mode: binary frames relayed from SEGGER RTT by
  // scripts/rtt_bridge.py (needs the J-Link probe; decimated preview).
  const connectRtt = () => {
    try {
      const ws = new WebSocket(RTT_BRIDGE_URL);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = () => setIsConnected(true);
      ws.onmessage = (event) => {
        processBinaryFrame(new DataView(event.data));
      };
      ws.onclose = () => setIsConnected(false);
      ws.onerror = (err) => {
        console.error('RTT bridge error (is rtt_bridge.py running?):', err);
        setIsConnected(false);
      };
    } catch (err) {
      console.error('RTT Error:', err);
    }
  };

  // 'T' + u64 LE epoch-ms on NUS RX: firmware maps its monotonic uptime
  // to wall clock and emits TSYNC records into the SD log (type 0x13 —
  // SD only, never on BLE, so nothing new to parse here). Harmless to
  // repeat; each board keeps its own clock.
  const sendTimeSync = async () => {
    const rx = rxCharRef.current;
    if (!rx) return;
    try {
      const sync = new ArrayBuffer(9);
      const sdv = new DataView(sync);
      sdv.setUint8(0, 0x54); // 'T'
      sdv.setBigUint64(1, BigInt(Date.now()), true);
      await rx.writeValueWithoutResponse(sync);
    } catch (e) { /* link may be mid-drop; next interval retries */ }
  };

  const connectBluetooth = async () => {
    try {
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: 'KMM' }, { namePrefix: 'CPAP' }],
        optionalServices: [NUS_SERVICE_UUID]
      });

      const server = await device.gatt.connect();
      const service = await server.getPrimaryService(NUS_SERVICE_UUID);
      const characteristic = await service.getCharacteristic(NUS_TX_CHARACTERISTIC_UUID);

      deviceRef.current = device;
      setIsConnected(true);

      await characteristic.startNotifications();
      let textBuffer = "";
      const decoder = new TextDecoder();

      characteristic.addEventListener('characteristicvaluechanged', (event) => {
        const value = event.target.value;
        if (processBinaryFrame(value)) return;
        textBuffer += decoder.decode(value);
        const lines = textBuffer.split('\n');
        textBuffer = lines.pop();
        for (let line of lines) processDataLine(line);
      });

      // Ensure binary mode + sync the board's wall clock (one 'T'
      // command retroactively timestamps the whole boot's SD log).
      // The board free-runs on an uncalibrated RC clock, so keep
      // re-syncing while connected — the offline SD reader
      // drift-corrects between TSYNC records (protocol spec v2.1).
      try {
        const rx = await service.getCharacteristic(NUS_RX_CHARACTERISTIC_UUID);
        rxCharRef.current = rx;
        await rx.writeValueWithoutResponse(new Uint8Array([0x42])); // 'B'
        await sendTimeSync();
        clearInterval(tsyncTimerRef.current);
        tsyncTimerRef.current = setInterval(sendTimeSync, TSYNC_INTERVAL_MS);
      } catch (e) { /* RX optional */ }

      device.addEventListener('gattserverdisconnected', () => {
        clearInterval(tsyncTimerRef.current);
        tsyncTimerRef.current = null;
        rxCharRef.current = null;
        setIsConnected(false);
      });

    } catch (err) {
      console.error('Bluetooth Error:', err);
    }
  };

  const connect = () => {
    if (isDemo) toggleDemo(); // stop demo before a real connection
    lastDevTimeRef.current = null;
    streamStartRef.current = null; // restart the elapsed-time clock
    setStreamStart(null);
    baselineRef.current = {};      // clean AC baseline for the fresh start
    setHistory([]);                // don't mix demo samples with real data
    isPausedRef.current = false;   // never start a connection paused
    setIsPaused(false);
    if (commMode === 'rtt') connectRtt();
    else connectBluetooth();
  };

  const disconnect = () => {
    window.location.reload();
  };

  const toggleRecording = () => {
    const nextState = !isRecording;
    if (isRecording) exportToCsv();
    else recordedDataRef.current = [];
    // Reset mark numbering on both start and stop, so the on-screen Mark count
    // clears after Stop & Save (matches the Full app).
    markCounterRef.current = 0;
    markNextRef.current = 0;
    setMarkCount(0);
    setIsRecording(nextState);
    isRecordingRef.current = nextState;
  };

  const toggleFilter = () => {
    const nextState = !isFiltered;
    setIsFiltered(nextState);
    isFilteredRef.current = nextState;
  };

  const exportToCsv = () => {
    const rows = recordedDataRef.current;
    if (rows.length === 0) return;
    // Time_s = seconds since the first recorded sample (device timebase),
    // matching the Full app: every CSV begins at 0 s.
    const t0 = rows[0].timestamp;
    const cols = ['timestamp','wallT',
      'r1','i1','g1','r2','i2','g2','r3','i3','g3','r4','i4','g4',
      'p1','p2','p3','p4',
      'sht1t','sht1h','sht2t','sht2h','sht3t','sht3h',
      'tmp1','tmp2','tmp3','vbat'];
    // Marker + Time(s) are the two rightmost columns: each mark listed from the
    // top row (row 1 = Mark 1, ...), remaining rows leave them blank.
    const marks = rows.filter(d => d.mark);
    const markCols = (i) => i < marks.length
      ? `,Mark ${marks[i].mark},${((marks[i].timestamp - t0) / 1000).toFixed(3)}`
      : ',,';
    const headers = 'Time_s,' + cols.join(',') + ',Marker,Time (s)\n';
    const csvContent = rows.map((d, i) =>
      ((d.timestamp - t0) / 1000).toFixed(3) + ',' + cols.map(c => d[c] ?? '').join(',') + markCols(i)
    ).join('\n');
    const blob = new Blob([headers + csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'CPAP_PI_Data.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  };

  return {
    connect, disconnect, isConnected, latestData, history,
    isRecording, toggleRecording, isFiltered, toggleFilter,
    isPaused, togglePause,
    isDemo, toggleDemo,
    markCount, addMark,
    filterAlpha, setFilterAlpha,
    streamStart,
    commMode, setCommMode
  };
};
