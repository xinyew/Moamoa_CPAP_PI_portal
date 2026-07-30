import React, { useState } from 'react';
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
import { Activity, Thermometer, Droplets, BatteryMedium, Download, Play, Square, Bluetooth, Cable, Gauge, LayoutGrid, Layers } from 'lucide-react';
import { useComm } from './useComm';

// Line colors per sensor site (1..4)
const PPG_RED_COLORS   = ['#fecaca', '#f87171', '#dc2626', '#7f1d1d'];
const PPG_IR_COLORS    = ['#ddd6fe', '#a78bfa', '#7c3aed', '#4c1d95'];
const PPG_GREEN_COLORS = ['#bbf7d0', '#4ade80', '#16a34a', '#14532d'];
const BARO_COLORS      = ['#fde68a', '#fbbf24', '#d97706', '#92400e'];

const fmt1 = (v) => (v === undefined ? '--' : (+v).toFixed(1));

// Single-signal card used by split view
const MiniChart = ({ title, dataKey, color, history, latest, unit }) => (
  <div className="glass-card mini-card">
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
      <h2 style={{ fontSize: '0.875rem', color: color }}>{title}</h2>
      <span style={{ fontSize: '1rem', fontWeight: 700 }}>
        {latest}{unit && <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}> {unit}</span>}
      </span>
    </div>
    <ResponsiveContainer width="100%" height="75%">
      <LineChart data={history}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
        <XAxis dataKey="timestamp" hide />
        <YAxis stroke="var(--text-dim)" fontSize={9} domain={['auto', 'auto']} width={45} />
        <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
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
    commMode,
    setCommMode
  } = useComm();

  const [splitView, setSplitView] = useState(false);

  const livePpg = [0, 1, 2, 3].filter(s => (latestData.ppgMask & (1 << s)) !== 0);
  const liveBaro = [0, 1, 2, 3].filter(b => (latestData.baroMask & (1 << b)) !== 0);

  const ppgOverlayChart = (title, color, keys, colors, latestKey) => (
    <div className="glass-card ppg-sub-card" key={title}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
        <Activity color={color} size={18} />
        <h2 style={{ fontSize: '1rem' }}>{title}</h2>
      </div>
      <ResponsiveContainer width="100%" height="70%">
        <LineChart data={history}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis dataKey="timestamp" hide />
          <YAxis stroke="var(--text-dim)" fontSize={10} domain={['auto', 'auto']} hide />
          <Legend />
          {keys.map((k, idx) => (
            (latestData.ppgMask & (1 << idx)) !== 0 &&
            <Line key={k} type="monotone" dataKey={k} stroke={colors[idx]}
                  strokeWidth={2} dot={false} name={`Site ${idx + 1}`} isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <div style={{ textAlign: 'right', fontSize: '1.25rem', fontWeight: '700' }}>
        {latestData[latestKey] || 0}
      </div>
    </div>
  );

  return (
    <div className="dashboard-container">
      {/* Header Section */}
      <header className="glass-card header-card">
        <div>
          <h1>KMM PMask Portal</h1>
          <p style={{ color: 'var(--text-dim)', fontSize: '0.875rem', margin: '4px 0 0 0' }}>
            4× PPG @ {latestData.ppgRate || 0}Hz · 4× Baro @ {latestData.baroRate || 0}Hz ·
            3× SHT40 · 3× TMP117 · mask {latestData.maskPresent ? 'attached' : '—'} ·
            link {latestData.bleDecim > 1
              ? <span style={{ color: 'var(--accent-amber)' }}>paced ×{latestData.bleDecim}</span>
              : 'full rate'}{latestData.bleDrops > 0 &&
              <span style={{ color: 'var(--accent-red)' }}> ({latestData.bleDrops} drops/s)</span>}
          </p>
        </div>

        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          {!isConnected && (
            <div style={{
              display: 'flex',
              background: 'rgba(255,255,255,0.05)',
              borderRadius: '0.75rem',
              padding: '0.25rem',
              border: '1px solid var(--border-glass)'
            }}>
              <button
                onClick={() => setCommMode('rtt')}
                style={{
                  background: commMode === 'rtt' ? 'var(--accent-blue)' : 'transparent',
                  color: commMode === 'rtt' ? '#000' : 'var(--text-dim)',
                  padding: '0.5rem 1rem',
                  fontSize: '0.875rem'
                }}
              >
                <Cable size={16} style={{ marginRight: '0.5rem' }} />
                RTT (wired)
              </button>
              <button
                onClick={() => setCommMode('bluetooth')}
                style={{
                  background: commMode === 'bluetooth' ? 'var(--accent-blue)' : 'transparent',
                  color: commMode === 'bluetooth' ? '#000' : 'var(--text-dim)',
                  padding: '0.5rem 1rem',
                  fontSize: '0.875rem'
                }}
              >
                <Bluetooth size={16} style={{ marginRight: '0.5rem' }} />
                BLE
              </button>
            </div>
          )}

          <button
            onClick={() => setSplitView(!splitView)}
            style={{
              background: 'transparent',
              color: 'var(--accent-blue)',
              border: '1px solid var(--accent-blue)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}
          >
            {splitView ? <LayoutGrid size={16} /> : <Layers size={16} />}
            {splitView ? 'Split' : 'Overlay'}
          </button>

          <div className={`status-badge ${isConnected ? 'status-online' : 'status-offline'}`}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'currentColor' }} />
            {isConnected ? 'LIVE' : 'DISCONNECTED'}
          </div>

          {!isConnected ? (
            <button onClick={connect}>Connect</button>
          ) : (
            <>
              <button
                onClick={toggleFilter}
                style={{
                  background: isFiltered ? 'var(--accent-green)' : 'transparent',
                  color: isFiltered ? '#000' : 'var(--accent-green)',
                  border: '1px solid var(--accent-green)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem'
                }}
              >
                <Download size={16} style={{ transform: 'rotate(180deg)' }} />
                {isFiltered ? 'Filter ON' : 'Filter OFF'}
              </button>

              <button
                className={isRecording ? 'recording' : ''}
                onClick={toggleRecording}
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
              >
                {isRecording ? <Square size={16} /> : <Play size={16} />}
                {isRecording ? 'Stop & Save CSV' : 'Start Recording'}
              </button>
              <button className="disconnect" onClick={disconnect}>Disconnect</button>
            </>
          )}
        </div>
      </header>

      {/* Environment / status telemetry */}
      <div className="glass-card env-card">
        <div className="telemetry-item">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
            <Thermometer color="var(--accent-blue)" size={16} />
            <span className="telemetry-label">Air °C (1/2/3)</span>
          </div>
          <div className="telemetry-value" style={{ fontSize: '1.25rem' }}>
            {fmt1(latestData.sht1t)}/{fmt1(latestData.sht2t)}/{fmt1(latestData.sht3t)}
          </div>
        </div>

        <div className="telemetry-item">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
            <Droplets color="var(--accent-blue)" size={16} />
            <span className="telemetry-label">RH % (1/2/3)</span>
          </div>
          <div className="telemetry-value" style={{ fontSize: '1.25rem' }}>
            {fmt1(latestData.sht1h)}/{fmt1(latestData.sht2h)}/{fmt1(latestData.sht3h)}
          </div>
        </div>

        <div className="telemetry-item">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
            <Thermometer color="var(--accent-amber)" size={16} />
            <span className="telemetry-label">Skin °C (1/2/3)</span>
          </div>
          <div className="telemetry-value" style={{ fontSize: '1.25rem' }}>
            {fmt1(latestData.tmp1)}/{fmt1(latestData.tmp2)}/{fmt1(latestData.tmp3)}
          </div>
        </div>

        <div className="telemetry-item" style={{ borderLeft: '1px solid var(--border-glass)', paddingLeft: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
            <BatteryMedium color="var(--accent-green)" size={16} />
            <span className="telemetry-label">Battery</span>
          </div>
          <div className="telemetry-value" style={{ fontSize: '1.75rem' }}>
            {((latestData.vbat || 0) / 1000).toFixed(2)}<span className="telemetry-unit">V</span>
          </div>
        </div>

        <div className="telemetry-item">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
            <Gauge color="var(--accent-yellow)" size={16} />
            <span className="telemetry-label">SD</span>
          </div>
          <div className="telemetry-value" style={{ fontSize: '1.75rem' }}>
            {latestData.sdOk ? 'OK' : '--'}
          </div>
        </div>
      </div>

      {splitView ? (
        <>
          {/* Split view: one card per live signal */}
          {liveBaro.map(b => (
            <MiniChart key={`p${b + 1}`} title={`Pressure ${b + 1}`} dataKey={`p${b + 1}`}
                       color={BARO_COLORS[b]} history={history}
                       latest={(latestData[`p${b + 1}`] || 0).toFixed(1)} unit="mbar" />
          ))}
          {livePpg.map(s => (
            <React.Fragment key={`ppg${s}`}>
              <MiniChart title={`PPG ${s + 1} Red`} dataKey={`r${s + 1}`}
                         color={PPG_RED_COLORS[s]} history={history}
                         latest={latestData[`r${s + 1}`] || 0} />
              <MiniChart title={`PPG ${s + 1} IR`} dataKey={`i${s + 1}`}
                         color={PPG_IR_COLORS[s]} history={history}
                         latest={latestData[`i${s + 1}`] || 0} />
              <MiniChart title={`PPG ${s + 1} Green`} dataKey={`g${s + 1}`}
                         color={PPG_GREEN_COLORS[s]} history={history}
                         latest={latestData[`g${s + 1}`] || 0} />
            </React.Fragment>
          ))}
        </>
      ) : (
        <>
          {/* Overlay view: grouped multi-line charts */}
          <div className="glass-card force-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
              <Gauge color="var(--accent-amber)" size={20} />
              <h2>Contact Pressure (MS5611 ×4)</h2>
            </div>
            <ResponsiveContainer width="100%" height="80%">
              <LineChart data={history}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="timestamp" hide />
                <YAxis stroke="var(--text-dim)" fontSize={12} domain={['auto', 'auto']} label={{ value: 'mbar', angle: -90, position: 'insideLeft', fill: 'var(--text-dim)' }} />
                <Tooltip
                  contentStyle={{ background: '#1e293b', border: '1px solid var(--border-glass)', borderRadius: '8px' }}
                  labelStyle={{ display: 'none' }}
                />
                <Legend />
                {liveBaro.map((b) => (
                  <Line key={b} type="monotone" dataKey={`p${b + 1}`} stroke={BARO_COLORS[b]}
                        strokeWidth={2} dot={false} name={`Site ${b + 1}`} isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
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
