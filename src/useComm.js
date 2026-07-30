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

const WAVE_KEYS = ['r1','i1','g1','r2','i2','g2','r3','i3','g3','r4','i4','g4'];
const HISTORY_LEN = 300;

const emptyLatest = {
  r1: 0, i1: 0, g1: 0, r2: 0, i2: 0, g2: 0,
  r3: 0, i3: 0, g3: 0, r4: 0, i4: 0, g4: 0,
  p1: 0, p2: 0, p3: 0, p4: 0,
  sht1t: 0, sht1h: 0, sht2t: 0, sht2h: 0, sht3t: 0, sht3h: 0,
  tmp1: 0, tmp2: 0, tmp3: 0,
  vbat: 0, maskPresent: false, sdOk: false,
  ppgRate: 0, baroRate: 0,
  ppgMask: 0, baroMask: 0, shtMask: 0, tmpMask: 0,
};

export const useComm = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [commMode, setCommMode] = useState('bluetooth'); // 'bluetooth' or 'rtt'
  const [isRecording, setIsRecording] = useState(false);
  const [isFiltered, setIsFiltered] = useState(false);

  const isRecordingRef = useRef(false);
  const isFilteredRef = useRef(false);
  const deviceRef = useRef(null);
  const wsRef = useRef(null);

  const alphaPPG = 0.15;
  const filterStateRef = useRef({});

  const [latestData, setLatestData] = useState(emptyLatest);
  const [history, setHistory] = useState([]);
  const statusRef = useRef({});
  const recordedDataRef = useRef([]);

  const applyFilter = (point) => {
    if (!isFilteredRef.current) return point;
    const fs = filterStateRef.current;
    const out = { ...point };
    for (const key of WAVE_KEYS) {
      if (fs[key] === undefined || isNaN(fs[key])) fs[key] = point[key];
      fs[key] = alphaPPG * point[key] + (1 - alphaPPG) * fs[key];
      out[key] = Math.round(fs[key]);
    }
    return out;
  };

  const pushPoints = (points) => {
    const processed = points.map(applyFilter);
    const last = processed[processed.length - 1];
    setLatestData(prev => ({ ...prev, ...last, ...statusRef.current }));
    setHistory(prev => [...prev, ...processed].slice(-HISTORY_LEN));
    if (isRecordingRef.current) {
      for (const p of processed) {
        recordedDataRef.current.push({ ...p, ...statusRef.current });
      }
    }
  };

  const readU24 = (dv, off) => dv.getUint16(off, true) + (dv.getUint8(off + 2) << 16);

  const processBinaryFrame = (dv) => {
    if (dv.byteLength < 12 || dv.getUint16(0, true) !== MAGIC) return false;
    const type = dv.getUint8(2);

    if (type === TYPE_DATA) {
      const n = dv.getUint8(9);
      if (dv.byteLength < 204) return true; // truncated: drop
      const now = Date.now();
      const points = [];
      for (let k = 0; k < n; k++) {
        const pt = { timestamp: now - (n - 1 - k) * TICK_MS };
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
      pushPoints(points);
      return true;
    }

    if (type === TYPE_STATUS) {
      if (dv.byteLength < 43) return true;
      const flags = dv.getUint8(36);
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
        ppgMask: dv.getUint8(39),
        baroMask: dv.getUint8(40),
        shtMask: dv.getUint8(41),
        tmpMask: dv.getUint8(42),
      };
      setLatestData(prev => ({ ...prev, ...statusRef.current }));
      return true;
    }
    return true;
  };

  // Firmware JSON debug mode (1 Hz over BLE, command 'J')
  const processDataLine = (line) => {
    line = line.trim();
    if (!(line.startsWith('{') && line.endsWith('}'))) return;
    try {
      const data = JSON.parse(line);
      const pt = {
        timestamp: Date.now(),
        r1: data.r ?? 0, i1: data.i ?? 0, g1: data.g ?? 0,
        p1: (data.p ?? 0) / 100,
      };
      statusRef.current = {
        ...statusRef.current,
        sht1t: data.t ?? 0, sht1h: data.h ?? 0,
        tmp1: data.skin ?? 0, vbat: data.vbat ?? 0,
      };
      pushPoints([pt]);
    } catch (e) {}
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

      // Ensure the firmware is in binary mode
      try {
        const rx = await service.getCharacteristic(NUS_RX_CHARACTERISTIC_UUID);
        await rx.writeValueWithoutResponse(new Uint8Array([0x42])); // 'B'
      } catch (e) { /* RX optional */ }

      device.addEventListener('gattserverdisconnected', () => {
        setIsConnected(false);
      });

    } catch (err) {
      console.error('Bluetooth Error:', err);
    }
  };

  const connect = () => {
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
    setIsRecording(nextState);
    isRecordingRef.current = nextState;
  };

  const toggleFilter = () => {
    const nextState = !isFiltered;
    setIsFiltered(nextState);
    isFilteredRef.current = nextState;
  };

  const exportToCsv = () => {
    if (recordedDataRef.current.length === 0) return;
    const cols = ['timestamp',
      'r1','i1','g1','r2','i2','g2','r3','i3','g3','r4','i4','g4',
      'p1','p2','p3','p4',
      'sht1t','sht1h','sht2t','sht2h','sht3t','sht3h',
      'tmp1','tmp2','tmp3','vbat'];
    const headers = cols.join(',') + '\n';
    const csvContent = recordedDataRef.current.map(d =>
      cols.map(c => d[c] ?? '').join(',')
    ).join('\n');
    const blob = new Blob([headers + csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'KMM_PMask_Data.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  };

  return {
    connect, disconnect, isConnected, latestData, history,
    isRecording, toggleRecording, isFiltered, toggleFilter,
    commMode, setCommMode
  };
};
