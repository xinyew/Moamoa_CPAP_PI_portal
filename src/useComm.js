import { useState, useRef, useEffect } from 'react';
import { isNative, requestAndConnect, saveCsv, shareFiles } from './bleTransport';

const RTT_BRIDGE_URL = 'ws://localhost:8765'; // scripts/rtt_bridge.py

// Binary protocol v2 — must match Moamoa_CPAP_PI_firmware
// src/comm/comm_protocol.h (kmm-pmask 4-site topology:
// 4x PPG, 4x baro, 3x SHT40, 3x TMP117). See README "BLE Interface
// Protocol" for the verified frame layouts.
const MAGIC = 0xC9A5;
const TYPE_DATA = 0x11;   // 204 B
const TYPE_STATUS = 0x12; // 45 B (43 B accepted: older build w/o link bytes)
const TICK_MS = 10;

const WAVE_KEYS = ['r1','i1','g1','r2','i2','g2','r3','i3','g3','r4','i4','g4'];
const HISTORY_LEN = 300;

// Each board holds one BLE connection (CONFIG_BT_MAX_CONN=1 on the
// board side); the portal is the central and can hold up to 10.
export const MAX_BOARDS = 10;
const SNAPSHOT_MS = 40; // render-side refresh of the active board (25 Hz)

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

const alphaPPG = 0.15;

const readU24 = (dv, off) => dv.getUint16(off, true) + (dv.getUint8(off + 2) << 16);

export const useComm = () => {
  // Roster of connected boards (drives the tab bar)
  const [boards, setBoards] = useState([]); // [{id, name, kind, connected}]
  const [activeBoardId, setActiveBoardId] = useState(null);
  const [commMode, setCommMode] = useState('bluetooth'); // 'bluetooth' or 'rtt'
  const [isRecording, setIsRecording] = useState(false);
  const [isFiltered, setIsFiltered] = useState(false);

  // Snapshot of the ACTIVE board only — ingest for all boards happens in
  // refs so 10 boards x 25 frames/s never means 250 React renders/s.
  const [latestData, setLatestData] = useState(emptyLatest);
  const [history, setHistory] = useState([]);

  const storesRef = useRef(new Map()); // id -> per-board mutable store
  const activeIdRef = useRef(null);
  const isRecordingRef = useRef(false);
  const isFilteredRef = useRef(false);

  const syncRoster = () => {
    setBoards(Array.from(storesRef.current.values()).map(s => ({
      id: s.id, name: s.name, kind: s.kind, connected: s.connected,
    })));
  };

  const makeStore = (id, name, kind) => ({
    id, name, kind,
    connected: false,
    conn: null,         // BLE only: transport handle from bleTransport
    ws: null,           // RTT only
    history: [],
    latest: { ...emptyLatest },
    status: {},
    filterState: {},
    recorded: [],
    lastDevTime: null,
    textBuffer: '',
  });

  const snapshotActive = () => {
    const s = storesRef.current.get(activeIdRef.current);
    if (!s) {
      setLatestData(emptyLatest);
      setHistory([]);
      return;
    }
    setLatestData({ ...s.latest, ...s.status });
    setHistory(s.history.slice());
  };

  useEffect(() => {
    const t = setInterval(() => {
      if (storesRef.current.get(activeIdRef.current)) snapshotActive();
    }, SNAPSHOT_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ------------------------------------------------------------------ */
  /*  Per-board ingest                                                  */
  /* ------------------------------------------------------------------ */

  const applyFilter = (store, point) => {
    if (!isFilteredRef.current) return point;
    const fs = store.filterState;
    const out = { ...point };
    for (const key of WAVE_KEYS) {
      if (point[key] === null) { fs[key] = undefined; continue; } // loss break
      if (fs[key] === undefined || isNaN(fs[key])) fs[key] = point[key];
      fs[key] = alphaPPG * point[key] + (1 - alphaPPG) * fs[key];
      out[key] = Math.round(fs[key]);
    }
    return out;
  };

  const pushPoints = (store, points) => {
    const processed = points.map(p => applyFilter(store, p));
    const last = processed[processed.length - 1];
    store.latest = { ...store.latest, ...last };
    store.history = [...store.history, ...processed].slice(-HISTORY_LEN);
    if (isRecordingRef.current) {
      for (const p of processed) {
        store.recorded.push({ ...p, ...store.status });
      }
    }
  };

  const processBinaryFrame = (store, dv) => {
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
      if (store.lastDevTime !== null && devT - store.lastDevTime > 200) {
        const gap = { timestamp: store.lastDevTime + 1 };
        for (const k2 of WAVE_KEYS) gap[k2] = null;
        for (let b = 1; b <= 4; b++) gap[`p${b}`] = null;
        points.push(gap);
      }
      store.lastDevTime = devT;
      for (let k = 0; k < n; k++) {
        const pt = { timestamp: devT - (n - 1 - k) * TICK_MS, wallT };
        // PPG block: sensor-major, 4 samples x (r,i,g) u24
        for (let s = 0; s < 4; s++) {
          const base = 12 + s * (n * 9) + k * 9;
          pt[`r${s + 1}`] = readU24(dv, base);
          pt[`i${s + 1}`] = readU24(dv, base + 3);
          pt[`g${s + 1}`] = readU24(dv, base + 6);
        }
        // Baro block: 4 samples x 4 x u24 Pa -> mbar (100 Hz)
        const bb = 156 + k * 12;
        for (let b = 0; b < 4; b++) {
          pt[`p${b + 1}`] = readU24(dv, bb + b * 3) / 100;
        }
        points.push(pt);
      }
      pushPoints(store, points);
      return true;
    }

    if (type === TYPE_STATUS) {
      if (dv.byteLength < 43) return true;
      const flags = dv.getUint8(36);
      const hasLink = dv.byteLength >= 45;
      store.status = {
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
        ppgMask: dv.getUint8(39),
        baroMask: dv.getUint8(40),
        shtMask: dv.getUint8(41),
        tmpMask: dv.getUint8(42),
        bleDrops: hasLink ? dv.getUint8(43) : 0,
        bleDecim: hasLink ? dv.getUint8(44) : 1,
      };
      return true;
    }
    return true;
  };

  // Firmware JSON debug mode (1 Hz over BLE, command 'J')
  const processDataLine = (store, line) => {
    line = line.trim();
    if (!(line.startsWith('{') && line.endsWith('}'))) return;
    try {
      const data = JSON.parse(line);
      const pt = {
        timestamp: Date.now(),
        r1: data.r ?? 0, i1: data.i ?? 0, g1: data.g ?? 0,
        p1: (data.p ?? 0) / 100,
      };
      store.status = {
        ...store.status,
        sht1t: data.t ?? 0, sht1h: data.h ?? 0,
        tmp1: data.skin ?? 0, vbat: data.vbat ?? 0,
      };
      pushPoints(store, [pt]);
    } catch (e) {}
  };

  /* ------------------------------------------------------------------ */
  /*  Connections                                                       */
  /* ------------------------------------------------------------------ */

  const activateBoard = (id) => {
    activeIdRef.current = id;
    setActiveBoardId(id);
    snapshotActive();
  };

  // Wired mode: binary frames relayed from SEGGER RTT by
  // scripts/rtt_bridge.py (needs the J-Link probe; decimated preview).
  // One bridge = one board; RTT occupies a single tab.
  const addRttBoard = () => {
    if (storesRef.current.has('rtt')) {
      activateBoard('rtt');
      return;
    }
    const store = makeStore('rtt', 'RTT (wired)', 'rtt');
    try {
      const ws = new WebSocket(RTT_BRIDGE_URL);
      ws.binaryType = 'arraybuffer';
      store.ws = ws;

      ws.onopen = () => { store.connected = true; syncRoster(); };
      ws.onmessage = (event) => {
        processBinaryFrame(store, new DataView(event.data));
      };
      ws.onclose = () => { store.connected = false; syncRoster(); };
      ws.onerror = (err) => {
        console.error('RTT bridge error (is rtt_bridge.py running?):', err);
        store.connected = false;
        syncRoster();
      };

      storesRef.current.set('rtt', store);
      syncRoster();
      activateBoard('rtt');
    } catch (err) {
      console.error('RTT Error:', err);
    }
  };

  const addBluetoothBoard = async () => {
    try {
      // The device picker returns ONE device per call — click
      // "Add Board" once per board, up to MAX_BOARDS.
      const decoder = new TextDecoder();
      let store = null; // assigned right after connect; guards the callbacks

      const conn = await requestAndConnect({
        onData: (value) => {
          if (!store) return;
          if (processBinaryFrame(store, value)) return;
          store.textBuffer += decoder.decode(value);
          const lines = store.textBuffer.split('\n');
          store.textBuffer = lines.pop();
          for (let line of lines) processDataLine(store, line);
        },
        onDisconnect: () => {
          if (!store) return;
          store.connected = false;
          syncRoster();
        },
      });

      const existing = storesRef.current.get(conn.id);
      if (existing && existing.connected) {
        conn.disconnect(); // duplicate pick of a live board — just show it
        activateBoard(conn.id);
        return;
      }

      // Re-use the old store on reconnect so history/recording continue
      store = existing || makeStore(conn.id, conn.name || `Board ${storesRef.current.size + 1}`, 'ble');
      store.conn = conn;
      store.connected = true;

      storesRef.current.set(conn.id, store);
      syncRoster();
      activateBoard(conn.id);
    } catch (err) {
      console.error('Bluetooth Error:', err);
    }
  };

  const addBoard = () => {
    if (storesRef.current.size >= MAX_BOARDS) {
      alert(`Limit reached: up to ${MAX_BOARDS} boards per portal.`);
      return;
    }
    // RTT needs the localhost bridge — web portal only, not the app
    if (commMode === 'rtt' && !isNative) addRttBoard();
    else addBluetoothBoard();
  };

  const disconnectBoard = (id) => {
    const store = storesRef.current.get(id);
    if (!store) return;
    try {
      if (store.kind === 'ble' && store.conn) store.conn.disconnect();
      if (store.kind === 'rtt' && store.ws) store.ws.close();
    } catch (e) { /* already down */ }
    storesRef.current.delete(id);
    if (activeIdRef.current === id) {
      const next = storesRef.current.keys().next();
      activateBoard(next.done ? null : next.value);
    }
    syncRoster();
  };

  /* ------------------------------------------------------------------ */
  /*  Recording / filtering                                             */
  /* ------------------------------------------------------------------ */

  const toggleRecording = () => {
    const nextState = !isRecording;
    if (isRecording) {
      exportAllCsv();
    } else {
      for (const s of storesRef.current.values()) s.recorded = [];
    }
    setIsRecording(nextState);
    isRecordingRef.current = nextState;
  };

  const toggleFilter = () => {
    const nextState = !isFiltered;
    setIsFiltered(nextState);
    isFilteredRef.current = nextState;
  };

  // One CSV per board. Web: browser downloads (may prompt to allow
  // multiple). Native app: written to Documents, then the share sheet.
  const exportAllCsv = async () => {
    const cols = ['timestamp','wallT',
      'r1','i1','g1','r2','i2','g2','r3','i3','g3','r4','i4','g4',
      'p1','p2','p3','p4',
      'sht1t','sht1h','sht2t','sht2h','sht3t','sht3h',
      'tmp1','tmp2','tmp3','vbat'];
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const uris = [];
    for (const store of storesRef.current.values()) {
      if (store.recorded.length === 0) continue;
      const headers = cols.join(',') + '\n';
      const csvContent = store.recorded.map(d =>
        cols.map(c => d[c] ?? '').join(',')
      ).join('\n');
      const name = `KMM_PMask_${store.name.replace(/[^\w-]+/g, '_')}_${stamp}.csv`;
      try {
        const uri = await saveCsv(name, headers + csvContent);
        if (uri) uris.push(uri);
      } catch (e) {
        console.error('CSV save failed:', e);
      }
    }
    await shareFiles(uris);
  };

  const activeBoard = boards.find(b => b.id === activeBoardId) || null;

  return {
    // multi-board
    boards, activeBoardId, activeBoard,
    setActiveBoard: activateBoard,
    addBoard, disconnectBoard,
    maxBoards: MAX_BOARDS,
    // active-board view (same shape the dashboard always used)
    isConnected: !!activeBoard?.connected,
    latestData, history,
    // global controls
    isRecording, toggleRecording, isFiltered, toggleFilter,
    commMode, setCommMode,
  };
};
