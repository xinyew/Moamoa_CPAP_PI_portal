import React from 'react';
import { MASK_PATH_D, MASK_VIEWBOX, MASK_CELLS, GRID_STEP, REGIONS, REGION_DIVIDERS } from './maskGeometry';

/*
 * One heatmap of the mask flex board: inverse-distance-weighted field
 * from the few physical sensors, rendered as a cell grid clipped to the
 * board outline, with a dot + direct value label per sensor and a
 * min→max colorbar. Sequential single-hue ramp (dark → neon) so
 * magnitude reads as brightness on the near-black surface.
 */

const hex2rgb = (h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];
const lerp = (a, b, t) => a + (b - a) * t;

// 3-stop ramp: t in [0,1] -> css color
const makeRamp = (stops) => {
  const [a, b, c] = stops.map(hex2rgb);
  return (t) => {
    const tt = Math.max(0, Math.min(1, t));
    const [p, q, u] = tt < 0.5 ? [a, b, tt * 2] : [b, c, (tt - 0.5) * 2];
    return `rgb(${Math.round(lerp(p[0], q[0], u))},${Math.round(lerp(p[1], q[1], u))},${Math.round(lerp(p[2], q[2], u))})`;
  };
};

// IDW (power 2) over the live sensors; d clamped so a cell on top of a
// sensor takes exactly its value.
const idw = (cx, cy, pts) => {
  let num = 0, den = 0;
  for (const p of pts) {
    const d2 = Math.max((cx - p.x) ** 2 + (cy - p.y) ** 2, 1);
    const w = 1 / d2;
    num += w * p.value;
    den += w;
  }
  return num / den;
};

const MaskHeatmap = ({ title, unit, sensors, stops, fmt, controls, mode, domain }) => {
  const ramp = makeRamp(stops);
  const live = sensors.filter(s => s.live && s.value != null && !isNaN(s.value));

  // FIXED physical domain when given (e.g. skin 34-41 °C): color then means
  // the same thing on every glance and across sessions; out-of-range values
  // clamp to the ends. Without one (Δ mode), fall back to fitting the live
  // values, padded so sensor noise doesn't paint a full-scale rainbow when
  // the field is nearly uniform.
  let lo = 0, hi = 1;
  if (domain) {
    [lo, hi] = domain;
  } else if (live.length) {
    lo = Math.min(...live.map(s => s.value));
    hi = Math.max(...live.map(s => s.value));
    const pad = Math.max((hi - lo) * 0.15, 0.25);
    lo -= pad; hi += pad;
  }

  const { x, y, w, h } = MASK_VIEWBOX;
  const clipId = `maskclip-${title.replace(/\W+/g, '')}`;

  return (
    <div className="glass-card viz-card chart-card">
      <div className="chart-head" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
          {title} <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>({unit})</span>
        </h2>
        {/* top-right corner: per-map controls (ABS/Δ + Tare), plus the
            no-sensor warning when the map has nothing live to draw */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {live.length === 0 && (
            <span style={{ fontSize: '0.72rem', color: 'var(--accent-amber)' }}>no live sensors</span>
          )}
          {controls}
        </div>
      </div>
      <div className="chart-body" style={{ display: 'flex', flexDirection: 'column' }}>
        <svg viewBox={`${x} ${y} ${w} ${h}`} style={{ flex: 1, minHeight: 0, width: '100%' }}
             preserveAspectRatio="xMidYMid meet">
          <defs>
            <clipPath id={clipId}>
              {/* even-odd: clip region is the ring (outer minus hole) */}
              <path d={MASK_PATH_D} clipRule="evenodd" />
            </clipPath>
          </defs>
          <g clipPath={`url(#${clipId})`}>
            {live.length > 0
              ? MASK_CELLS.map(([cx, cy], i) => (
                  <rect key={i} x={cx - GRID_STEP / 2} y={cy - GRID_STEP / 2}
                        width={GRID_STEP + 0.05} height={GRID_STEP + 0.05}
                        fill={ramp((idw(cx, cy, live) - lo) / (hi - lo))} />
                ))
              : <rect x={x} y={y} width={w} height={h} fill="rgba(255,255,255,0.03)" />}
          </g>
          {/* anatomical zones A-D: dashed dividers (clipped to the ring, so
              the parts crossing the cutout vanish) + a letter per zone */}
          <g clipPath={`url(#${clipId})`}>
            {REGION_DIVIDERS.map(([[x1, y1], [x2, y2]], i) => (
              <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
                    stroke="rgba(255,255,255,0.4)" strokeWidth="0.6"
                    strokeDasharray="2 1.4" />
            ))}
          </g>
          {/* zone names spelled out (user request — not just letters) */}
          {REGIONS.map(r => (
            <text key={r.id} x={r.label.x} y={r.label.y} textAnchor="middle"
                  fontSize="3.6" fontWeight="800" fill="rgba(255,255,255,0.92)"
                  stroke="#05050a" strokeWidth="0.8" paintOrder="stroke">
              {r.name}
            </text>
          ))}
          {/* one path strokes both the outer profile and the hole edge */}
          <path d={MASK_PATH_D} fill="none"
                stroke="rgba(160,220,255,0.45)" strokeWidth="0.7" />
          {sensors.map(s => (
            <g key={s.label}>
              <circle cx={s.x} cy={s.y} r="2.1"
                      fill={s.live && s.value != null ? (s.color || '#ffffff') : 'none'}
                      stroke={s.live && s.value != null ? '#05050a' : 'rgba(255,255,255,0.4)'}
                      strokeWidth="0.6" strokeDasharray={s.live && s.value != null ? undefined : '1 1'} />
              <text x={s.x} y={s.y - 3.4} textAnchor="middle" fontSize="4"
                    fontWeight="700" fill="#ffffff" stroke="#05050a"
                    strokeWidth="0.8" paintOrder="stroke">
                {s.label} {s.live && s.value != null ? fmt(s.value) : 'off'}
              </text>
            </g>
          ))}
        </svg>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
          <span className="num" style={{ fontSize: '0.68rem', color: 'var(--text-dim)' }}>
            {(domain || live.length) ? fmt(lo) : '--'}
          </span>
          <div style={{
            flex: 1, height: 6, borderRadius: 3,
            background: `linear-gradient(to right, ${stops[0]}, ${stops[1]}, ${stops[2]})`
          }} />
          <span className="num" style={{ fontSize: '0.68rem', color: 'var(--text-dim)' }}>
            {(domain || live.length) ? fmt(hi) : '--'}
          </span>
        </div>
      </div>
    </div>
  );
};

// Skip re-renders unless a value moved meaningfully (natural throttle
// for the 25 Hz pressure stream feeding ~900 SVG cells).
const close = (a, b) => (a == null && b == null) ||
  (a != null && b != null && Math.abs(a - b) < 0.02);
export default React.memo(MaskHeatmap, (prev, next) =>
  prev.title === next.title &&
  prev.unit === next.unit &&
  // `mode` folds in anything the corner controls render from (ABS/Δ state,
  // streaming) — the `controls` node itself is a fresh JSX element every
  // render and must NOT be compared directly.
  prev.mode === next.mode &&
  prev.sensors.length === next.sensors.length &&
  prev.sensors.every((s, i) =>
    s.live === next.sensors[i].live && close(s.value, next.sensors[i].value)));
