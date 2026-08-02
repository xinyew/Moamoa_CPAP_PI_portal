import React, { useState, useEffect, useRef } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts';
import { Activity, Thermometer, Droplets, BatteryMedium, Play, Square, Pause, Bluetooth, Cable, Gauge, LayoutGrid, Layers, FlaskConical, Flag, Map, Power } from 'lucide-react';
import { useComm, CH_OF } from './useComm';
import MaskHeatmap from './MaskHeatmap';
import { BARO_POS, SHT_POS, TMP_POS, PPG_POS, MASK_PATH_D, MASK_VIEWBOX } from './maskGeometry';

// Sweet-neon theme: color follows the SITE, not the channel. Each site
// keeps ONE fixed neon color in every chart (and its split-view column),
// so site 2 is pink wherever you look; the chart title/icon carries the
// channel. Validated (dataviz checker, surface #0f111b): worst adjacent
// pair dE 16.0 under deutan simulation, 28.2 normal vision, all >= 3:1
// contrast. Sits above the dark-mode lightness band on purpose — neon.
const SITE_COLORS = ['#2ee880', '#ff4db8', '#f0b000', '#00c4ea'];
const PPG_RED_COLORS   = SITE_COLORS;
const PPG_IR_COLORS    = SITE_COLORS;
const PPG_GREEN_COLORS = SITE_COLORS;
const BARO_COLORS      = SITE_COLORS;

// SPLIT view colors follow the CHANNEL instead: the columns already encode
// the site, so within a row every Red chart is red, IR pink, Green green,
// pressure white — the row reads as one quantity at a glance.
const CH_COLORS = { p: '#f2f5ff', r: '#ff5252', i: '#ff4db8', g: '#2ee880' };

// One thermal ramp for every heatmap: coldest = blue, hottest = red, with
// a fixed PHYSICAL domain per quantity so color always means the same
// value (skin 34-41 °C, RH 30-100 %, pressure 755-900 mmHg).
// Traffic-light ramp: green = safe, yellow = caution, PURE red = alarm.
const THERMAL_STOPS = ['#22c55e', '#facc15', '#ff0000'];
// Inverted ramp for QUALITY metrics (PPG SNR): high is good/green, zero is
// the alarming end.
const SNR_STOPS = ['#ff0000', '#facc15', '#22c55e'];

// Tiny mask-ring locator: shows WHERE on the flex a sensor physically sits
// (same outline + coordinates as the Visualized view). The dot takes the
// plot's own line color so the pin reads as "this trace, right here".
const SitePin = ({ pos, color = '#ffe14d' }) => {
  const { x, y, w, h } = MASK_VIEWBOX;
  return (
    <svg viewBox={`${x} ${y} ${w} ${h}`} preserveAspectRatio="xMidYMid meet"
         style={{ height: '4em', width: 'auto', flex: '0 0 auto', opacity: 0.95 }}>
      <path d={MASK_PATH_D} fillRule="evenodd" fill="rgba(255,255,255,0.07)"
            stroke="rgba(160,220,255,0.6)" strokeWidth="1.2" />
      <circle cx={pos.x} cy={pos.y} r="6" fill={color} stroke="#05050a" strokeWidth="1.6" />
    </svg>
  );
};

// Overlay-chart legend: the ring with ALL four sensors of that kind, each
// dot in its site color and numbered — maps line colors to face positions.
const SiteLegend = ({ posMap }) => {
  const { x, y, w, h } = MASK_VIEWBOX;
  return (
    <svg viewBox={`${x} ${y} ${w} ${h}`} preserveAspectRatio="xMidYMid meet"
         style={{ height: '4em', width: 'auto', flex: '0 0 auto', opacity: 0.95 }}>
      <path d={MASK_PATH_D} fillRule="evenodd" fill="rgba(255,255,255,0.07)"
            stroke="rgba(160,220,255,0.6)" strokeWidth="1.2" />
      {[1, 2, 3, 4].map(i => posMap[i] && (
        <g key={i}>
          <circle cx={posMap[i].x} cy={posMap[i].y} r="7.5"
                  fill={SITE_COLORS[i - 1]} stroke="#05050a" strokeWidth="1.6" />
          <text x={posMap[i].x} y={posMap[i].y + 3.4} textAnchor="middle"
                fontSize="10" fontWeight="800" fill="#05050a">{i}</text>
        </g>
      ))}
    </svg>
  );
};

const fmt1 = (v) => (v === undefined ? '--' : (+v).toFixed(1));
const fmt2 = (v) => (v == null ? '--' : (+v).toFixed(2));
// A dropped sample is null, not 0 — show it as "no reading" instead of a
// number the sensor never produced.
const fmtCount = (v) => (v == null ? '--' : v);

const WINDOW_OPTIONS = ['full', 5]; // 'full' = whole buffer (~8 s), 5 = last 5 s

// Slice by real timestamps so a window means honest seconds regardless of the
// actual delivery rate.
const lastSeconds = (history, seconds) => {
  if (history.length === 0) return history;
  const cutoff = history[history.length - 1].timestamp - seconds * 1000;
  let i = history.length - 1;
  while (i > 0 && history[i - 1].timestamp >= cutoff) i--;
  return history.slice(i);
};

// Shared dark tooltip; label shows elapsed seconds via labelFormatter set per chart.
const tooltipContentStyle = { background: '#10121f', border: '1px solid var(--border-glass)', borderRadius: '8px' };
const tooltipLabelStyle = { color: 'var(--text-dim)', fontSize: '0.75rem' };

// Dot renderer. Draws the event-marker line (used instead of <ReferenceLine>
// because recharts drops dynamically-mapped ReferenceLine children), and — when
// a series is SPARSE — a dot per surviving sample. Without that dot an isolated
// valid sample between two dropouts renders as nothing at all: a line needs two
// points. A heavily-dropping sensor then looks like an empty chart rather than a
// sensor that is delivering a little.
const makeDot = (withMarks, sparse) => {
  if (!withMarks && !sparse) return false;
  return (props) => {
    const { cx, cy, payload, index, stroke } = props;
    if (cx == null) return <g key={`e${index}`} />;
    const parts = [];
    if (withMarks && payload?.mark) {
      parts.push(<line key="m" x1={cx} x2={cx} y1={0} y2={2000}
                       stroke="var(--accent-yellow)" strokeWidth={1.5} strokeDasharray="4 2" />);
      parts.push(<text key="t" x={cx + 3} y={12} fill="var(--accent-yellow)"
                       fontSize="11" fontWeight="600">M{payload.mark}</text>);
    }
    if (sparse && cy != null) {
      parts.push(<circle key="d" cx={cx} cy={cy} r={1.7} fill={stroke} />);
    }
    return <g key={`d${index}`}>{parts}</g>;
  };
};
const markDot = makeDot(true, false);

// Fraction of samples that actually carry a value for this key (dropouts are
// null). Lets the UI say "this sensor delivered 4%" instead of drawing a blank.
const yieldOf = (rows, key) => {
  if (!rows.length) return 1;
  let n = 0;
  for (const d of rows) if (d[key] != null) n++;
  return n / rows.length;
};

// Single-signal card used by split view — fills its grid cell.
// `lane` (0..3) pins the card to a fixed site column so the same sensor's
// channels stack vertically even when other sites are offline.
const MiniChart = ({ title, dataKey, color, data, latest, unit, xAxis, tooltipFmt, dot, lane, indicator }) => (
  <div className="glass-card mini-card chart-card"
       style={lane != null ? { gridColumn: `${lane * 3 + 1} / span 3` } : undefined}>
    <div className="chart-head" style={{ justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0 }}>
        <h2 style={{ fontSize: '0.78rem', color: color, whiteSpace: 'nowrap' }}>{title}</h2>
        {indicator}
      </div>
      <span className="num" style={{ fontSize: '0.85rem', fontWeight: 700 }}>
        {latest}{unit && <span style={{ fontSize: '0.65rem', color: 'var(--text-dim)' }}> {unit}</span>}
      </span>
    </div>
    <div className="chart-body">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(140,220,255,0.07)" vertical={false} />
          <XAxis {...xAxis} />
          <YAxis stroke="var(--text-dim)" fontSize={10} domain={['auto', 'auto']} width={44} />
          <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle}
                   labelFormatter={tooltipFmt} isAnimationActive={false} />
          <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} dot={dot ?? markDot} activeDot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  </div>
);

const Dashboard = () => {
  const {
    connect,
    disconnect,
    isConnected,
    latestData,
    history,
    isRecording,
    toggleRecording,
    isFiltered,
    toggleFilter,
    isPaused,
    togglePause,
    isDemo,
    toggleDemo,
    markCount,
    addMark,
    filterAlpha,
    setFilterAlpha,
    streamStart,
    commMode,
    setSensing,
    setCommMode
  } = useComm();

  const [viewMode, setViewMode] = useState('overlay'); // 'overlay' | 'split' | 'viz'
  const [windowSec, setWindowSec] = useState('full'); // 'full' | 5
  const [ppgAc, setPpgAc] = useState(false);          // AC (baseline-removed) PPG
  // Contact pressure is absolute (~730 mmHg here); Δ mode subtracts a tare so
  // the PI-relevant increment (tens of mmHg) is not buried in the baseline.
  const [baroDelta, setBaroDelta] = useState(false);
  const [baroBase, setBaroBase] = useState(null);     // {p1..p4} at tare time

  // Skin temp / humidity get the same ABS/Δ treatment on their heatmaps:
  // absolute values sit in a narrow band (skin ~33-34 °C), so the CHANGE
  // since a tare is what makes a developing pressure point visible.
  const [tmpDelta, setTmpDelta] = useState(false);
  const [tmpBase, setTmpBase] = useState(null);       // {1..3} at tare time
  const [rhDelta, setRhDelta] = useState(false);
  const [rhBase, setRhBase] = useState(null);         // {1..3} at tare time

  // ---- sensor matching (units have no factory calibration) ----
  // The sensors of a kind can't be absolutely calibrated, so the constant
  // sensor-to-sensor bias is removed by re-referencing everything to the
  // group: shortly after a stream starts, ~3 s of readings are averaged per
  // sensor, and from then on each sensor displays
  //     groupMean(baselines) + (value − itsOwnBaseline)
  // i.e. every sensor's CHANGE rides on the shared mean. Relative dynamics
  // are untouched; only the fixed offsets collapse. CSV recording stays RAW.
  const [matchOff, setMatchOff] = useState(null); // {p:{1..4}, tmp:{1..3}, rh:{1..3}, air:{1..3}}
  const latestRef = useRef(latestData);
  latestRef.current = latestData;
  useEffect(() => {
    // (isConnected || isDemo) inline: `streaming` is declared further down
    if (!(isConnected || isDemo)) { setMatchOff(null); return; }
    const samples = [];
    const iv = setInterval(() => {
      const d = latestRef.current;
      samples.push({
        p: [1, 2, 3, 4].map(i => d[`p${i}`]),
        tmp: [1, 2, 3].map(i => d[`tmp${i}`]),
        rh: [1, 2, 3].map(i => d[`sht${i}h`]),
        air: [1, 2, 3].map(i => d[`sht${i}t`]),
      });
      if (samples.length < 6) return;
      clearInterval(iv);
      const offs = {};
      for (const [g, n] of [['p', 4], ['tmp', 3], ['rh', 3], ['air', 3]]) {
        const means = [];
        for (let k = 0; k < n; k++) {
          // 0 doubles as the firmware's no-data sentinel for these fields
          const vals = samples.map(s => s[g][k]).filter(v => v != null && !Number.isNaN(v) && v !== 0);
          means.push(vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null);
        }
        const live = means.filter(m => m != null);
        const gm = live.length ? live.reduce((a, b) => a + b, 0) / live.length : 0;
        offs[g] = {};
        for (let k = 0; k < n; k++) offs[g][k + 1] = means[k] == null ? 0 : means[k] - gm;
      }
      setMatchOff(offs);
    }, 500);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, isDemo]);

  const mOff = (g, i) => (matchOff && matchOff[g] ? matchOff[g][i] || 0 : 0);
  const mP = (i) => { const v = latestData[`p${i}`]; return v == null ? v : +(v - mOff('p', i)).toFixed(2); };
  const mTmp = (i) => { const v = latestData[`tmp${i}`]; return v == null ? v : +(v - mOff('tmp', i)).toFixed(2); };
  const mRh = (i) => { const v = latestData[`sht${i}h`]; return v == null ? v : +(v - mOff('rh', i)).toFixed(2); };
  const mAir = (i) => { const v = latestData[`sht${i}t`]; return v == null ? v : +(v - mOff('air', i)).toFixed(2); };

  // Tares capture the MATCHED values, so Δ is measured on the same scale
  // that is displayed. (No Tare button anymore — pressing Δ re-tares at the
  // current readings every time; ABS⇄Δ is the whole workflow.)
  const tareBaro = () => setBaroBase({ p1: mP(1), p2: mP(2), p3: mP(3), p4: mP(4) });
  const tareTmp = () => setTmpBase({ 1: mTmp(1), 2: mTmp(2), 3: mTmp(3) });
  const tareRh = () => setRhBase({ 1: mRh(1), 2: mRh(2), 3: mRh(3) });

  // Keyboard shortcut: press M to drop an event marker (ignored in inputs)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key.toLowerCase() !== 'm') return;
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
      addMark();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const streaming = isConnected || isDemo; // demo streams but is NOT a real connection

  // Sensing state comes from STATUS flags bit2 — the board's own view, never
  // the last 'P' we sent. It also clears on the automatic mask-absent standby,
  // so bit0 tells the two apart: no mask is the board protecting itself, mask
  // present with sensing off is a deliberate user pause.
  const sensingOn = latestData.sensingOn !== false;
  const sensingIdle = isConnected && !sensingOn;
  const idleReason = latestData.maskPresent ? 'paused by user' : 'mask disconnected';
  // 'P' rides the NUS RX characteristic, which only exists on a BLE link.
  const canToggleSensing = isConnected && commMode === 'bluetooth';

  // X-axis label: seconds elapsed since the stream started (device timebase)
  const fmtElapsed = (t) => (streamStart != null && typeof t === 'number' ? `${((t - streamStart) / 1000).toFixed(1)}s` : '');
  // NUMERIC time axis, not the recharts default category axis. The firmware
  // decimates frames before sending (RTT_DECIM = 3 fixed; BLE AIMD 1..8), so
  // samples arrive as 4-sample bursts separated by holes. A category axis
  // spaces every point equally, which renders a 90 ms hole with the same width
  // as a 10 ms step — that time-base distortion is what made clean waveforms
  // look like high-frequency noise. Plotting against real timestamps fixes it.
  const timeAxisProps = {
    dataKey: 'timestamp',
    type: 'number',
    scale: 'linear',
    domain: ['dataMin', 'dataMax'],
    tickFormatter: fmtElapsed,
    stroke: 'var(--text-dim)',
    fontSize: 10,
    tickLine: false,
    axisLine: false,
    minTickGap: 70,
    height: 16,
  };

  // PPG-only window: pressure charts always show the full buffer.
  // The 5s view advances in whole-second STEPS: the six tick marks keep
  // fixed screen positions while their labels show real elapsed seconds,
  // incrementing once per second (no continuous horizontal scrolling).
  const isWin = windowSec !== 'full';
  let ppgData = history;
  let winTicks = [];
  let winDomain = [0, windowSec];
  if (isWin) {
    const sliced = lastSeconds(history, windowSec + 1); // covers the stepped window
    const t0 = streamStart != null ? streamStart : (sliced[0]?.timestamp ?? 0);
    const tMax = sliced.length ? (sliced[sliced.length - 1].timestamp - t0) / 1000 : 0;
    const hi = Math.max(windowSec, Math.ceil(tMax));
    winDomain = [hi - windowSec, hi];
    for (let t = winDomain[0]; t <= hi; t++) winTicks.push(t);
    ppgData = sliced.map(d => ({ ...d, tSec: (d.timestamp - t0) / 1000 }));
  }
  const ppgAxisProps = isWin
    ? { dataKey: 'tSec', type: 'number', domain: winDomain, ticks: winTicks, allowDataOverflow: true,
        tickFormatter: (v) => `${v}s`, stroke: 'var(--text-dim)', fontSize: 10,
        tickLine: false, axisLine: false, height: 16 }
    : timeAxisProps;
  const ppgTooltip = {
    contentStyle: tooltipContentStyle,
    labelStyle: tooltipLabelStyle,
    labelFormatter: isWin ? (v) => `${Number(v).toFixed(1)}s` : fmtElapsed,
    isAnimationActive: false,
  };
  const scalarTooltip = {
    contentStyle: tooltipContentStyle,
    labelStyle: tooltipLabelStyle,
    labelFormatter: fmtElapsed,
    isAnimationActive: false,
  };

  // AC mode swaps PPG channels to their baseline-removed (…Ac) counterparts
  const ppgKey = (k) => (ppgAc ? `${k}Ac` : k);

  // Overlay AC y-domain: recharts' plain auto-fit is hostage to the AC
  // baseline's settling transient — the slow EMA starts at the first raw
  // sample, so the first seconds hold huge decaying values that stretch the
  // axis until the actual pulse is a flat line. Fit to the 5th-95th
  // percentile of the visible window instead (plus headroom) and let the
  // transient clip off-scale.
  const acYDomain = (keys) => {
    if (!ppgAc) return ['auto', 'auto'];
    const vals = [];
    for (const d of ppgData) {
      for (const k of keys) { const v = d[`${k}Ac`]; if (v != null) vals.push(v); }
    }
    if (vals.length < 20) return ['auto', 'auto'];
    vals.sort((a, b) => a - b);
    const q = (p) => vals[Math.floor(p * (vals.length - 1))];
    const lo = q(0.05), hi = q(0.95);
    const pad = Math.max((hi - lo) * 0.25, 1);
    return [Math.floor(lo - pad), Math.ceil(hi + pad)];
  };

  // Per-site delivery rate over the visible window, computed for ALL four
  // sites before deciding what to draw.
  const SPARSE_YIELD = 0.6;
  const ppgYield = {};
  for (let site = 1; site <= 4; site++) ppgYield[site] = yieldOf(ppgData, `r${site}`);

  // A site is shown if the STATUS mask says it is live OR data actually arrived.
  // The mask alone is not enough: the firmware builds it from a 1 Hz snapshot of
  // g_sensor_data, while DATA frames carry their own per-frame validity 25x a
  // second. An intermittent sensor is very likely caught mid-failure by that
  // one snapshot, and the whole site was then hidden — throwing away every
  // valid frame it did deliver in between.
  const livePpg = [0, 1, 2, 3].filter(
    s => (latestData.ppgMask & (1 << s)) !== 0 || ppgYield[s + 1] > 0);
  const liveBaro = [0, 1, 2, 3].filter(
    b => (latestData.baroMask & (1 << b)) !== 0 || yieldOf(history, `p${b + 1}`) > 0);
  // Truly absent sites: no mask bit and nothing received in the window.
  const offlinePpg = streaming ? [1, 2, 3, 4].filter(s => !livePpg.includes(s - 1)) : [];
  // A site the STATUS mask calls online but whose samples are all zero-filled
  // is a different fault from an absent one: the chip answers on I2C, the read
  // succeeds, and the data is empty — i.e. the LEDs never turned on.
  const darkPpg = livePpg.map(s => s + 1).filter(site => ppgYield[site] < 0.05);
  const lossy = livePpg.map(s => s + 1)
    .filter(site => ppgYield[site] < 0.98 && !darkPpg.includes(site));

  // Pressure in Δ mode: subtract the tare so the contact increment is readable
  // against the ~730 mmHg absolute baseline.
  const baroKey = (b) => (baroDelta && baroBase ? `d${b}` : b);
  // Chart data: sensor-matched always, Δ-shifted on top when enabled.
  const baroData = (matchOff || (baroDelta && baroBase))
    ? history.map(d => {
        const o = { ...d };
        for (let i = 1; i <= 4; i++) {
          const v = d[`p${i}`];
          const m = v == null ? null : +(v - mOff('p', i)).toFixed(2);
          o[`p${i}`] = m;
          if (baroDelta && baroBase) {
            o[`dp${i}`] = m == null ? null : +(m - (baroBase[`p${i}`] ?? 0)).toFixed(2);
          }
        }
        return o;
      })
    : history;
  const baroUnit = (baroDelta && baroBase) ? 'Δ mmHg' : 'mmHg';
  const baroLatest = (i) => {
    const v = mP(i);
    if (v == null) return null;
    return (baroDelta && baroBase) ? v - (baroBase[`p${i}`] ?? 0) : v;
  };
  const baroBaseText = (baroDelta && baroBase)
    ? `Baseline   P1 ${fmt2(baroBase.p1)}  /  P2 ${fmt2(baroBase.p2)}  /  P3 ${fmt2(baroBase.p3)}  /  P4 ${fmt2(baroBase.p4)}   mmHg`
    : 'Absolute pressure — press Δ to re-baseline at the current reading';

  // ABS/Δ — no separate Tare button: pressing Δ re-baselines at the current
  // readings every time, so ABS⇄Δ is the whole workflow.
  const baroControlGroup = (
    <div className="segmented">
      <button className={`segment ${!baroDelta ? 'active' : ''}`} onClick={() => setBaroDelta(false)}
              title="Absolute pressure (about 730 mmHg here, set by elevation)">ABS</button>
      <button className={`segment ${baroDelta ? 'active' : ''}`}
              onClick={() => { tareBaro(); setBaroDelta(true); }}
              title="Change from this moment — contact pressure (tens of mmHg) is not buried in the atmospheric offset. Pressing Δ again re-baselines.">Δ</button>
    </div>
  );

  // Corner controls for the Visualized maps — same ABS/Δ pattern, one
  // independent instance per quantity.
  const vizCorner = (isDelta, setDelta, doTare, what) => (
    <div className="segmented">
      <button className={`segment ${!isDelta ? 'active' : ''}`} onClick={() => setDelta(false)}
              title="Absolute values">ABS</button>
      <button className={`segment ${isDelta ? 'active' : ''}`}
              onClick={() => { doTare(); setDelta(true); }}
              title={`Change from this moment — small ${what} shifts stand out. Pressing Δ again re-baselines.`}>Δ</button>
    </div>
  );
  const tmpVal = (i) => {
    const v = mTmp(i);
    return (tmpDelta && tmpBase && v != null) ? +(v - (tmpBase[i] ?? 0)).toFixed(2) : v;
  };
  const rhVal = (i) => {
    const v = mRh(i);
    return (rhDelta && rhBase && v != null) ? +(v - (rhBase[i] ?? 0)).toFixed(2) : v;
  };

  // PPG IR signal quality per site: RMS of the AC (pulsatile) component over
  // the buffer, against a noise estimate from the first difference — the
  // pulse (1-3 Hz) barely contributes to sample-to-sample steps at 100 Hz,
  // while broadband noise dominates them. Clean pulse ⇒ big ratio; sensor
  // seeing nothing but noise ⇒ ratio near white-noise floor (~1).
  const irSnr = (site) => {
    const key = `i${site}Ac`;
    const vals = [];
    for (const d of history) { const v = d[key]; if (v != null) vals.push(v); }
    const n = vals.length;
    if (n < 50) return null;
    let s2 = 0, d2 = 0;
    for (let k = 0; k < n; k++) {
      s2 += vals[k] * vals[k];
      if (k > 0) { const dd = vals[k] - vals[k - 1]; d2 += dd * dd; }
    }
    const rms = Math.sqrt(s2 / n);
    const noise = Math.sqrt(d2 / (n - 1)) / Math.SQRT2;
    return +(rms / Math.max(noise, 1e-6)).toFixed(2);
  };

  // Everything between the header and the charts rides in ONE slim strip:
  // env/status telemetry plus the chart controls (PPG window, RAW/AC,
  // pressure ABS/Δ + Tare) and the sensor-fault note.
  const stripRow = (
    <div className="glass-card strip-card">
      {/* Telemetry readouts: one LARGE type size for labels, icons and
          values alike. All sensor numbers are displayed sensor-matched
          (group mean + own change). The SHT40's own air temp rides small
          under RH — context, not a primary reading. In the Visualized view
          the RH/skin readouts drop out (the maps carry them); battery and
          SD have no map, so they stay. */}
      {viewMode !== 'viz' && (
        <>
          <div className="strip-item big" title="SHT40 relative humidity, sensors 1/2/3, sensor-matched (small line: SHT40 air temperature)">
            <Droplets color="var(--accent-blue)" size={22} />
            <div className="strip-col">
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem' }}>
                <span className="strip-label">RH%</span>
                <span className="strip-value">{fmt1(mRh(1))}/{fmt1(mRh(2))}/{fmt1(mRh(3))}</span>
              </div>
              <span className="strip-sub">Air {fmt1(mAir(1))}/{fmt1(mAir(2))}/{fmt1(mAir(3))} °C</span>
            </div>
          </div>
          <div className="strip-item big" title="TMP117 skin temperature, sensors 1/2/3, sensor-matched">
            <Thermometer color="var(--accent-amber)" size={22} />
            <span className="strip-label">Skin°C</span>
            <span className="strip-value">{fmt1(mTmp(1))}/{fmt1(mTmp(2))}/{fmt1(mTmp(3))}</span>
          </div>
        </>
      )}
      {/* Chart controls only where charts exist: the Visualized view has no
          time series (Window / RAW-AC are meaningless there) and pressure
          ABS/Δ now lives on the pressure map itself. */}
      {viewMode !== 'viz' && (
        <>
          <div className="strip-sep" />
          <div className="strip-item">
            <span className="toolbar-label">Window</span>
            <div className="segmented">
              {WINDOW_OPTIONS.map(opt => (
                <button key={opt} className={`segment ${windowSec === opt ? 'active' : ''}`}
                        onClick={() => setWindowSec(opt)}
                        title={opt === 'full' ? 'Whole buffer (about the last 8 s)' : `Last ${opt} s of real time`}>
                  {opt === 'full' ? 'Full' : `${opt}s`}
                </button>
              ))}
            </div>
          </div>
          <div className="strip-item">
            <span className="toolbar-label">PPG</span>
            <div className="segmented">
              <button className={`segment ${!ppgAc ? 'active' : ''}`} onClick={() => setPpgAc(false)}
                      title="Raw sensor counts, DC included — use for signal strength and contact">RAW</button>
              <button className={`segment ${ppgAc ? 'active' : ''}`} onClick={() => setPpgAc(true)}
                      title="Slow drift removed, pulsatile part only — puts all four sites on a comparable scale">AC</button>
            </div>
          </div>
        </>
      )}

      {(offlinePpg.length > 0 || darkPpg.length > 0 || lossy.length > 0) ? (
        <span className="offline-note" title="OFFLINE = failed the boot probe; the firmware never retries, so it stays out until reboot. ALL-ZERO = the chip answers on I2C and the read succeeds, but red/IR/green are all 0 — LEDs likely never turned on. YIELD = share of samples that carried a value.">
          {[
            offlinePpg.length > 0 &&
              `⚠ OFFLINE ${offlinePpg.map(s => `PPG${s} (ch${CH_OF[s]})`).join(' / ')}`,
            darkPpg.length > 0 &&
              `⚠ ALL-ZERO ${darkPpg.map(s => `PPG${s} (ch${CH_OF[s]})`).join(' / ')}`,
            lossy.length > 0 &&
              `YIELD ${lossy.map(site => `PPG${site} ${Math.round(ppgYield[site] * 100)}%`).join(' / ')}`,
          ].filter(Boolean).join('  |  ')}
        </span>
      ) : null}

      {/* Battery + SD pinned to the FAR RIGHT of the strip in every view */}
      <div className="strip-item big" style={{ marginLeft: 'auto' }} title="Battery voltage">
        <BatteryMedium color="var(--accent-green)" size={22} />
        <span className="strip-value">{((latestData.vbat || 0) / 1000).toFixed(2)}<span className="strip-label">V</span></span>
      </div>
      <div className="strip-item big" title="microSD card on the board (onboard logging)">
        <Gauge color="var(--accent-yellow)" size={22} />
        <span className="strip-label">SD</span>
        <span className="strip-value">{latestData.sdOk ? 'OK' : '--'}</span>
      </div>
    </div>
  );

  const ppgOverlayChart = (title, color, keys, colors, latestKey) => {
    const firstLive = keys.findIndex((_, idx) => (latestData.ppgMask & (1 << idx)) !== 0);
    return (
    <div className="glass-card ppg-sub-card chart-card" key={title}>
      <div className="chart-head">
        <Activity color={color} size={15} />
        <h2 style={{ fontSize: '0.85rem' }}>{title}{ppgAc ? ' · AC' : ''}</h2>
        {/* center-top: where the four PPGs sit on the ring, in line colors */}
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
          <SiteLegend posMap={PPG_POS} />
        </div>
        <span className="num" style={{ fontSize: '0.9rem', fontWeight: 700 }}>
          {fmtCount(latestData[ppgKey(latestKey)])}
        </span>
      </div>
      <div className="chart-body">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={ppgData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(140,220,255,0.07)" vertical={false} />
            <XAxis {...ppgAxisProps} />
            <YAxis stroke="var(--text-dim)" fontSize={10} domain={acYDomain(keys)} allowDataOverflow width={48} />
            <Tooltip {...ppgTooltip} />
            {keys.map((k, idx) => (
              (latestData.ppgMask & (1 << idx)) !== 0 &&
              <Line key={k} type="monotone" dataKey={ppgKey(k)} stroke={colors[idx]}
                    strokeWidth={2} activeDot={false}
                    dot={makeDot(idx === firstLive, (ppgYield[idx + 1] ?? 1) < SPARSE_YIELD)}
                    name={`S${idx + 1}`} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
    );
  };

  return (
    <div className={`dashboard-container${sensingIdle ? ' sensing-idle' : ''}`}>
      {/* Header Section */}
      <header className="glass-card header-card">
        <div style={{ minWidth: 0 }}>
          <h1>CPAP PI Dashboard - Full_v2</h1>
          <p style={{ color: 'var(--text-dim)', fontSize: '0.95rem', margin: '2px 0 0 0', whiteSpace: 'nowrap' }}>
            4× PPG @ {latestData.ppgRate || 0}Hz · 4× Baro @ {latestData.baroRate || 0}Hz ·
            mask {latestData.maskPresent ? 'attached' : '—'} ·
            link {latestData.bleDecim > 1
              ? <span style={{ color: 'var(--accent-amber)' }}>paced ×{latestData.bleDecim}</span>
              : 'full rate'}{latestData.bleDrops > 0 &&
              <span style={{ color: 'var(--accent-red)' }}> ({latestData.bleDrops} drops/s)</span>}
          </p>
        </div>

        {/* Fixed header layout: every control is always present in the same
            slot — buttons enable/disable with state instead of appearing
            and disappearing. */}
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <div className="segmented vertical" style={{ opacity: streaming ? 0.35 : 1 }}>
            <button
              className={`segment ${commMode === 'rtt' ? 'active' : ''}`}
              disabled={streaming}
              onClick={() => setCommMode('rtt')}
            >
              <Cable size={16} style={{ marginRight: '0.5rem' }} />
              RTT (wired)
            </button>
            <button
              className={`segment ${commMode === 'bluetooth' ? 'active' : ''}`}
              disabled={streaming}
              onClick={() => setCommMode('bluetooth')}
            >
              <Bluetooth size={16} style={{ marginRight: '0.5rem' }} />
              BLE
            </button>
          </div>

          {/* Overlay / Split / Visualized — stacked, pick one (always available) */}
          <div className="segmented vertical">
            <button className={`segment ${viewMode === 'overlay' ? 'active' : ''}`} onClick={() => setViewMode('overlay')}>
              <Layers size={16} style={{ marginRight: '0.5rem' }} />
              Overlay
            </button>
            <button className={`segment ${viewMode === 'split' ? 'active' : ''}`} onClick={() => setViewMode('split')}>
              <LayoutGrid size={16} style={{ marginRight: '0.5rem' }} />
              Split
            </button>
            <button className={`segment ${viewMode === 'viz' ? 'active' : ''}`} onClick={() => setViewMode('viz')}>
              <Map size={16} style={{ marginRight: '0.5rem' }} />
              Visualized
            </button>
          </div>

          <div className={`status-badge ${streaming ? (((isPaused && !isDemo) || sensingIdle) ? 'status-paused' : 'status-online') : 'status-offline'}`}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'currentColor' }} />
            {isDemo ? 'DEMO'
              : isConnected ? (isPaused ? 'PAUSED'
                              : sensingIdle ? (latestData.maskPresent ? 'SENSING OFF' : 'NO MASK')
                              : 'LIVE')
              : 'DISCONNECTED'}
          </div>

          {/* Remote sensing enable ('P'). The board keeps STATUS coming while
              sensing is off, so this is a real idle state, not a dead link. */}
          <button className={sensingOn ? 'sensing' : 'sensing off'}
                  disabled={!canToggleSensing}
                  onClick={() => setSensing(!sensingOn)}
                  title={canToggleSensing
                    ? (sensingOn
                        ? 'Sensing on — click to stop the sensors and save about 10 mA. STATUS keeps arriving.'
                        : `Sensing off (${idleReason}) — click to resume. The board also resumes on its own when the mask is reattached.`)
                    : 'Needs a BLE connection'}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Power size={16} />
            {sensingOn ? 'Sensing' : 'Sensing Off'}
          </button>

          <button className={isDemo ? 'demo active' : 'demo'} disabled={isConnected} onClick={toggleDemo}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <FlaskConical size={16} />
            {isDemo ? 'Stop Demo' : 'Demo'}
          </button>

          {/* Stop = freeze charts while staying connected (no re-pairing) */}
          <button className={isPaused ? 'pause active' : 'pause'} disabled={!streaming} onClick={togglePause}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {isPaused ? <Play size={16} /> : <Pause size={16} />}
            {isPaused ? 'Resume' : 'Stop'}
          </button>

          {/* Drop an event marker on the next sample (also: press M) */}
          <button className="mark" disabled={!streaming} onClick={addMark}
                  title="Tag this moment — vertical line on every chart, recorded in the CSV Marker column (shortcut: M)"
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Flag size={16} />
            {markCount > 0 ? `Mark (${markCount})` : 'Mark'}
          </button>

          {/* Filter toggle + smoothing strength, stacked in one column */}
          <div className="filter-group">
            <div className="filter-row">
              <span className="filter-row-label">Filter</span>
              <button type="button" role="switch" aria-checked={isFiltered}
                      className={`switch ${isFiltered ? 'on' : ''}`} onClick={toggleFilter}
                      title={isFiltered ? 'Filter on — waveform smoothing' : 'Filter off'}>
                <span className="switch-knob" />
              </button>
            </div>
            <label className="filter-row" style={{ opacity: isFiltered ? 1 : 0.35 }}
                   title={isFiltered ? 'Filter strength (0.01–1) — smaller smooths harder, 1 = no smoothing'
                                     : 'Only active while the filter is on'}>
              <span className="filter-row-label">EMA</span>
              <input type="number" min="0.01" max="1" step="0.01" disabled={!isFiltered}
                     defaultValue={filterAlpha} onChange={(e) => setFilterAlpha(e.target.value)} />
            </label>
          </div>

          <button
            className={isRecording ? 'recording' : ''}
            disabled={!streaming}
            onClick={toggleRecording}
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
          >
            {isRecording ? <Square size={14} /> : <Play size={14} />}
            {isRecording ? 'Save CSV' : 'Record'}
          </button>

          {!isConnected ? (
            <button onClick={connect}>Connect</button>
          ) : (
            <button className="disconnect" onClick={disconnect}>Disconnect</button>
          )}
        </div>
      </header>

      {/* Telemetry + chart controls, one slim row */}
      {stripRow}

      {viewMode === 'viz' ? (
        <>
          {/* Visualized: IDW heatmaps over the real mask flex outline with
              the real sensor footprint positions (see maskGeometry.js for
              provenance). Skin temp, humidity, pressure; PPG viz later. */}
          {/* Fixed physical scales (user spec): skin 34-41 °C, RH 30-100 %,
              pressure 755 mmHg up to the MS5611's measurable ceiling
              (1200 mbar = 900 mmHg). Blue = low, red = high everywhere.
              Δ mode falls back to auto-fit around 0. */}
          <MaskHeatmap title="Skin Temperature" unit={tmpDelta && tmpBase ? 'Δ °C' : '°C'}
            stops={THERMAL_STOPS} domain={tmpDelta && tmpBase ? undefined : [34, 41]}
            fmt={(v) => (+v).toFixed(1)}
            mode={`${tmpDelta}:${streaming}`}
            controls={vizCorner(tmpDelta, setTmpDelta, tareTmp, 'skin-temp')}
            sensors={[1, 2, 3].map(i => ({
              ...TMP_POS[i], label: `T${i}`,
              value: tmpVal(i),
              live: (latestData.tmpMask & (1 << (i - 1))) !== 0,
            }))} />
          <MaskHeatmap title="Humidity" unit={rhDelta && rhBase ? 'Δ %RH' : '%RH'}
            stops={THERMAL_STOPS} domain={rhDelta && rhBase ? undefined : [30, 100]}
            fmt={(v) => (+v).toFixed(1)}
            mode={`${rhDelta}:${streaming}`}
            controls={vizCorner(rhDelta, setRhDelta, tareRh, 'humidity')}
            sensors={[1, 2, 3].map(i => ({
              ...SHT_POS[i], label: `H${i}`,
              value: rhVal(i),
              live: (latestData.shtMask & (1 << (i - 1))) !== 0,
            }))} />
          <MaskHeatmap title="Contact Pressure" unit={baroUnit}
            stops={THERMAL_STOPS} domain={baroDelta && baroBase ? undefined : [755, 900]}
            fmt={(v) => (+v).toFixed(2)}
            mode={`${baroDelta}:${streaming}`}
            controls={<div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>{baroControlGroup}</div>}
            sensors={[1, 2, 3, 4].map(i => ({
              ...BARO_POS[i], label: `P${i}`, color: SITE_COLORS[i - 1],
              value: baroLatest(i),
              live: liveBaro.includes(i - 1),
            }))} />
          {/* PPG signal QUALITY (IR AC-SNR). Inverted ramp: a strong clean
              pulse is green, a site reading nothing but noise falls to red.
              ~1 is the white-noise floor of the estimator; >5 is a solid
              pulse, hence the 0-10 scale. */}
          <MaskHeatmap title="PPG IR SNR" unit="SNR"
            stops={SNR_STOPS} domain={[0, 10]} fmt={(v) => (+v).toFixed(1)}
            mode={`snr:${streaming}`}
            sensors={[1, 2, 3, 4].map(i => ({
              ...PPG_POS[i], label: `IR${i}`,
              value: irSnr(i),
              live: (latestData.ppgMask & (1 << (i - 1))) !== 0,
            }))} />
        </>
      ) : viewMode === 'split' ? (
        <>
          {/* Split view: one column per SITE — pressure on top, then that
              site's Red/IR/Green stacked beneath it. Channel-major render
              order + fixed lanes keep columns aligned even when a site is
              offline (its lane simply stays empty). */}
          {/* Rows are colored by CHANNEL (pressure white, Red red, IR pink,
              Green green) — the columns already encode the site, and each
              pressure card carries a mask-ring pin showing where that baro
              physically sits. */}
          {liveBaro.map(b => (
            <MiniChart key={`p${b + 1}`} lane={b} title={`Pressure ${b + 1}`} dataKey={baroKey(`p${b + 1}`)}
                       color={CH_COLORS.p} data={baroData} xAxis={timeAxisProps} tooltipFmt={fmtElapsed}
                       indicator={<SitePin pos={BARO_POS[b + 1]} color={CH_COLORS.p} />}
                       latest={fmt1(baroLatest(b + 1) ?? undefined)} unit={baroUnit} />
          ))}
          {[
            ['Red', 'r'],
            ['IR', 'i'],
            ['Green', 'g'],
          ].map(([label, ch]) =>
            livePpg.map(s => (
              <MiniChart key={`${ch}${s + 1}`} lane={s}
                         title={`PPG ${s + 1} ${label}${ppgAc ? ' (AC)' : ''}`} dataKey={ppgKey(`${ch}${s + 1}`)}
                         color={CH_COLORS[ch]} data={ppgData} xAxis={ppgAxisProps} tooltipFmt={ppgTooltip.labelFormatter}
                         dot={makeDot(true, (ppgYield[s + 1] ?? 1) < SPARSE_YIELD)}
                         indicator={<SitePin pos={PPG_POS[s + 1]} color={CH_COLORS[ch]} />}
                         latest={fmtCount(latestData[ppgKey(`${ch}${s + 1}`)])} unit="counts" />
            ))
          )}
        </>
      ) : (
        <>
          {/* Overlay view: 2x2 grid — pressure + three PPG charts */}
          <div className="glass-card force-card chart-card">
            <div className="chart-head">
              <Gauge color="var(--accent-amber)" size={15} />
              <h2 style={{ fontSize: '0.85rem', whiteSpace: 'nowrap' }}>Contact Pressure ×4 <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>({baroUnit})</span></h2>
              {/* center-top: where the four baros sit on the ring, in line colors */}
              <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
                <SiteLegend posMap={BARO_POS} />
              </div>
              <span className="chart-footnote">{baroBaseText}</span>
            </div>
            <div className="chart-body">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={baroData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(140,220,255,0.07)" vertical={false} />
                  <XAxis {...timeAxisProps} />
                  <YAxis stroke="var(--text-dim)" fontSize={10} width={48} domain={['auto', 'auto']} />
                  <Tooltip {...scalarTooltip} />
                  <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} height={14} />
                  {liveBaro.map((b, idx) => (
                    <Line key={b} type="monotone" dataKey={baroKey(`p${b + 1}`)} stroke={BARO_COLORS[b]}
                          strokeWidth={2} dot={idx === 0 ? markDot : false} activeDot={false}
                          name={`P${b + 1}`} isAnimationActive={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {ppgOverlayChart('PPG Red (×4)', 'var(--accent-red)', ['r1', 'r2', 'r3', 'r4'], PPG_RED_COLORS, 'r1')}
          {ppgOverlayChart('PPG IR (×4)', 'var(--accent-violet)', ['i1', 'i2', 'i3', 'i4'], PPG_IR_COLORS, 'i1')}
          {ppgOverlayChart('PPG Green (×4)', 'var(--accent-green)', ['g1', 'g2', 'g3', 'g4'], PPG_GREEN_COLORS, 'g1')}
        </>
      )}
    </div>
  );
};

export default Dashboard;
