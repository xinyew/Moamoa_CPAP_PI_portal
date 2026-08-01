import React, { useState, useEffect } from 'react';
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
import { Activity, Thermometer, Droplets, BatteryMedium, Play, Square, Pause, Bluetooth, Cable, Gauge, LayoutGrid, Layers, FlaskConical, Flag } from 'lucide-react';
import { useComm, CH_OF } from './useComm';

// Line colors per sensor site (1..4). Every shade must stay legible on the
// near-black background — the old palette's darkest two (#7f1d1d, #4c1d95,
// #14532d, #92400e) rendered as a barely-visible hash that read as noise.
const PPG_RED_COLORS   = ['#fee2e2', '#fca5a5', '#f87171', '#ef4444'];
const PPG_IR_COLORS    = ['#ede9fe', '#c4b5fd', '#a78bfa', '#8b5cf6'];
const PPG_GREEN_COLORS = ['#dcfce7', '#86efac', '#4ade80', '#22c55e'];
const BARO_COLORS      = ['#fef3c7', '#fde68a', '#fbbf24', '#f59e0b'];

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
const tooltipContentStyle = { background: '#1e293b', border: '1px solid var(--border-glass)', borderRadius: '8px' };
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
const MiniChart = ({ title, dataKey, color, data, latest, unit, xAxis, tooltipFmt, dot, lane }) => (
  <div className="glass-card mini-card chart-card"
       style={lane != null ? { gridColumn: `${lane * 3 + 1} / span 3` } : undefined}>
    <div className="chart-head" style={{ justifyContent: 'space-between' }}>
      <h2 style={{ fontSize: '0.78rem', color: color, whiteSpace: 'nowrap' }}>{title}</h2>
      <span className="num" style={{ fontSize: '0.85rem', fontWeight: 700 }}>
        {latest}{unit && <span style={{ fontSize: '0.65rem', color: 'var(--text-dim)' }}> {unit}</span>}
      </span>
    </div>
    <div className="chart-body">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
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
    setCommMode
  } = useComm();

  const [splitView, setSplitView] = useState(false);
  const [windowSec, setWindowSec] = useState('full'); // 'full' | 5
  const [ppgAc, setPpgAc] = useState(false);          // AC (baseline-removed) PPG
  // Contact pressure is absolute (~730 mmHg here); Δ mode subtracts a tare so
  // the PI-relevant increment (tens of mmHg) is not buried in the baseline.
  const [baroDelta, setBaroDelta] = useState(false);
  const [baroBase, setBaroBase] = useState(null);     // {p1..p4} at tare time

  const tareBaro = () => setBaroBase({
    p1: latestData.p1, p2: latestData.p2, p3: latestData.p3, p4: latestData.p4,
  });

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
  const baroData = (baroDelta && baroBase)
    ? history.map(d => {
        const o = { ...d };
        for (let i = 1; i <= 4; i++) {
          o[`dp${i}`] = d[`p${i}`] == null ? null : +(d[`p${i}`] - (baroBase[`p${i}`] ?? 0)).toFixed(2);
        }
        return o;
      })
    : history;
  const baroUnit = (baroDelta && baroBase) ? 'Δ mmHg' : 'mmHg';
  const baroLatest = (i) => {
    const v = latestData[`p${i}`];
    if (v == null) return null;
    return (baroDelta && baroBase) ? v - (baroBase[`p${i}`] ?? 0) : v;
  };
  const baroBaseText = (baroDelta && baroBase)
    ? `Baseline   P1 ${fmt2(baroBase.p1)}  /  P2 ${fmt2(baroBase.p2)}  /  P3 ${fmt2(baroBase.p3)}  /  P4 ${fmt2(baroBase.p4)}   mmHg`
    : 'Absolute pressure — press Δ to tare at the current reading';

  // ABS/Δ + Tare, shared by both views so the controls never disappear
  const baroControlGroup = (
    <>
      <div className="segmented">
        <button className={`segment ${!baroDelta ? 'active' : ''}`} onClick={() => setBaroDelta(false)}
                title="Absolute pressure (about 730 mmHg here, set by elevation)">ABS</button>
        <button className={`segment ${baroDelta ? 'active' : ''}`}
                onClick={() => { if (!baroBase) tareBaro(); setBaroDelta(true); }}
                title="Show change from the baseline, so contact pressure (tens of mmHg) is not buried in the atmospheric offset">Δ</button>
      </div>
      <button className="mark" disabled={!streaming} onClick={tareBaro}
              title="Set the current reading as the new baseline">Tare</button>
    </>
  );

  // Everything between the header and the charts rides in ONE slim strip:
  // env/status telemetry plus the chart controls (PPG window, RAW/AC,
  // pressure ABS/Δ + Tare) and the sensor-fault note.
  const stripRow = (
    <div className="glass-card strip-card">
      <div className="strip-item" title="SHT40 relative humidity, sensors 1/2/3">
        <Droplets color="var(--accent-blue)" size={14} />
        <span className="strip-label">RH%</span>
        <span className="strip-value">{fmt1(latestData.sht1h)}/{fmt1(latestData.sht2h)}/{fmt1(latestData.sht3h)}</span>
      </div>
      <div className="strip-item" title="SHT40 air temperature, sensors 1/2/3">
        <Thermometer color="var(--accent-blue)" size={14} />
        <span className="strip-label">Air°C</span>
        <span className="strip-value">{fmt1(latestData.sht1t)}/{fmt1(latestData.sht2t)}/{fmt1(latestData.sht3t)}</span>
      </div>
      <div className="strip-item" title="TMP117 skin temperature, sensors 1/2/3">
        <Thermometer color="var(--accent-amber)" size={14} />
        <span className="strip-label">Skin°C</span>
        <span className="strip-value">{fmt1(latestData.tmp1)}/{fmt1(latestData.tmp2)}/{fmt1(latestData.tmp3)}</span>
      </div>
      <div className="strip-item" title="Battery voltage">
        <BatteryMedium color="var(--accent-green)" size={14} />
        <span className="strip-value">{((latestData.vbat || 0) / 1000).toFixed(2)}<span className="strip-label">V</span></span>
      </div>
      <div className="strip-item" title="microSD card on the board (onboard logging)">
        <Gauge color="var(--accent-yellow)" size={14} />
        <span className="strip-label">SD</span>
        <span className="strip-value">{latestData.sdOk ? 'OK' : '--'}</span>
      </div>

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
      <div className="strip-item">
        <span className="toolbar-label">Pressure</span>
        {baroControlGroup}
      </div>

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
      ) : (
        <span className="chart-footnote" style={{ marginLeft: 'auto' }}>{baroBaseText}</span>
      )}
    </div>
  );

  const ppgOverlayChart = (title, color, keys, colors, latestKey) => {
    const firstLive = keys.findIndex((_, idx) => (latestData.ppgMask & (1 << idx)) !== 0);
    return (
    <div className="glass-card ppg-sub-card chart-card" key={title}>
      <div className="chart-head">
        <Activity color={color} size={15} />
        <h2 style={{ fontSize: '0.85rem' }}>{title}{ppgAc ? ' · AC' : ''}</h2>
        <span className="num" style={{ marginLeft: 'auto', fontSize: '0.9rem', fontWeight: 700 }}>
          {fmtCount(latestData[ppgKey(latestKey)])}
        </span>
      </div>
      <div className="chart-body">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={ppgData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis {...ppgAxisProps} />
            <YAxis stroke="var(--text-dim)" fontSize={10} domain={['auto', 'auto']} width={48} />
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
    <div className="dashboard-container">
      {/* Header Section */}
      <header className="glass-card header-card">
        <div style={{ minWidth: 0 }}>
          <h1>CPAP PI Dashboard - Full_v2</h1>
          <p style={{ color: 'var(--text-dim)', fontSize: '0.7rem', margin: '2px 0 0 0', whiteSpace: 'nowrap' }}>
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

          {/* Overlay / Split view — stacked, pick one (always available) */}
          <div className="segmented vertical">
            <button className={`segment ${!splitView ? 'active' : ''}`} onClick={() => setSplitView(false)}>
              <Layers size={16} style={{ marginRight: '0.5rem' }} />
              Overlay
            </button>
            <button className={`segment ${splitView ? 'active' : ''}`} onClick={() => setSplitView(true)}>
              <LayoutGrid size={16} style={{ marginRight: '0.5rem' }} />
              Split
            </button>
          </div>

          <div className={`status-badge ${streaming ? ((isPaused && !isDemo) ? 'status-paused' : 'status-online') : 'status-offline'}`}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'currentColor' }} />
            {isDemo ? 'DEMO' : (isConnected ? (isPaused ? 'PAUSED' : 'LIVE') : 'DISCONNECTED')}
          </div>

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

      {splitView ? (
        <>
          {/* Split view: one column per SITE — pressure on top, then that
              site's Red/IR/Green stacked beneath it. Channel-major render
              order + fixed lanes keep columns aligned even when a site is
              offline (its lane simply stays empty). */}
          {liveBaro.map(b => (
            <MiniChart key={`p${b + 1}`} lane={b} title={`Pressure ${b + 1}`} dataKey={baroKey(`p${b + 1}`)}
                       color={BARO_COLORS[b]} data={baroData} xAxis={timeAxisProps} tooltipFmt={fmtElapsed}
                       latest={fmt1(baroLatest(b + 1) ?? undefined)} unit={baroUnit} />
          ))}
          {[
            ['Red', 'r', PPG_RED_COLORS],
            ['IR', 'i', PPG_IR_COLORS],
            ['Green', 'g', PPG_GREEN_COLORS],
          ].map(([label, ch, colors]) =>
            livePpg.map(s => (
              <MiniChart key={`${ch}${s + 1}`} lane={s}
                         title={`PPG ${s + 1} ${label}${ppgAc ? ' (AC)' : ''}`} dataKey={ppgKey(`${ch}${s + 1}`)}
                         color={colors[s]} data={ppgData} xAxis={ppgAxisProps} tooltipFmt={ppgTooltip.labelFormatter}
                         dot={makeDot(true, (ppgYield[s + 1] ?? 1) < SPARSE_YIELD)}
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
              <span className="chart-footnote" style={{ marginLeft: 'auto' }}>{baroBaseText}</span>
            </div>
            <div className="chart-body">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={baroData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
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
