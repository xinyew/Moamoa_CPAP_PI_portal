import React from 'react';
import { MASK_PATH_D, MASK_VIEWBOX, MASK_CELLS, GRID_STEP, REGIONS, REGION_DIVIDERS, HUB, regionOf } from './maskGeometry';

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

// Field ALONG the ring: piecewise-LINEAR interpolation between angularly
// adjacent sensors (circular). A sensor is the anchor point of its stretch
// of ring, and its influence spreads all the way to the neighboring
// sensors — the whole zones between them shade, not a blob around the dot.
// e.g. H3 (upper right) rising warms nasal bridge AND the right arm; H2
// (lower right) rising warms right AND chin; H1 (left) warms left AND
// chin. IDW variants could not express this: they re-concentrate around
// the sensor and flatten everything else toward the mean.
const angOf = (x, y) => Math.atan2(y - HUB.y, x - HUB.x);
const idw = (cx, cy, pts) => {  // pts sorted ascending by .ang
  const n = pts.length;
  if (n === 1) return pts[0].value;
  const a = angOf(cx, cy);
  let i = pts.findIndex(p => p.ang > a);
  const next = i === -1 ? pts[0] : pts[i];
  const prev = i <= 0 ? pts[n - 1] : pts[i - 1];
  let span = next.ang - prev.ang;
  if (span <= 0) span += 2 * Math.PI;          // wrap across ±180°
  let t = a - prev.ang;
  if (t < 0) t += 2 * Math.PI;
  return prev.value + (next.value - prev.value) * (t / span);
};

const MaskHeatmap = ({ title, unit, sensors, stops, fmt, controls, mode, domain, adapt, footer }) => {
  const ramp = makeRamp(stops);
  const live = sensors.filter(s => s.live && s.value != null && !isNaN(s.value))
    .map(s => ({ ...s, ang: angOf(s.x, s.y) }))
    .sort((a, b) => a.ang - b.ang);

  // FIXED physical domain when given (e.g. skin 34-41 °C): color then means
  // the same thing on every glance and across sessions; out-of-range values
  // clamp to the ends. Without one (Δ mode), fall back to fitting the live
  // values, padded so sensor noise doesn't paint a full-scale rainbow when
  // the field is nearly uniform.
  let lo = 0, hi = 1;
  if (domain) [lo, hi] = domain;
  if (live.length) {
    const vmin = Math.min(...live.map(s => s.value));
    const vmax = Math.max(...live.map(s => s.value));
    if (!domain) {
      const pad = Math.max((vmax - vmin) * 0.15, 0.25);
      lo = vmin - pad; hi = vmax + pad;
    } else if (adapt != null) {
      // A fixed physical scale FREEZES on live hardware: sensor matching
      // collapses the sites to within a fraction of a unit of each other
      // (and the local absolute value can sit outside the span entirely),
      // so every cell paints one clamped color no matter how the numbers
      // move. So in ABS the scale is a WINDOW centered on the live
      // readings: at least `adapt` wide (the quantity's own units — noise
      // can't paint a full-scale rainbow), growing with the live spread,
      // capped at the fixed domain's span. Continuous by construction: a
      // press widens the window smoothly instead of snapping between a
      // zoomed and a frozen scale. The colorbar always labels the window
      // actually in use, so color stays interpretable.
      const mid = (vmin + vmax) / 2;
      const s2 = Math.min(Math.max((vmax - vmin) * 1.6, adapt), hi - lo);
      lo = mid - s2 / 2; hi = mid + s2 / 2;
    }
  }

  const { x, y, w, h } = MASK_VIEWBOX;
  const clipId = `maskclip-${title.replace(/\W+/g, '')}`;

  return (
    <div className="glass-card viz-card chart-card" style={{ position: 'relative' }}>
      {/* Title CENTERED and doubled. The card is too narrow for a big title
          plus corner controls on one line, so ABS/Δ (and the demo inputs)
          live on a centered second line instead of overlapping the title. */}
      {/* Big centered title with the ABS/Δ toggle in the section's top-right
          corner — in flow (not absolute), so they can never overlap: the
          title centers in whatever width the controls leave over. */}
      <div className="chart-head">
        <h2 style={{ flex: 1, minWidth: 0, fontSize: '1.7rem', whiteSpace: 'nowrap',
                     textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {title} <span style={{ color: 'var(--text-dim)', fontWeight: 400, fontSize: '1rem' }}>({unit})</span>
        </h2>
        {(controls || live.length === 0) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: '0 0 auto' }}>
            {live.length === 0 && (
              <span style={{ fontSize: '0.72rem', color: 'var(--accent-amber)' }}>no live sensors</span>
            )}
            {controls}
          </div>
        )}
      </div>
      {footer && (
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.2rem' }}>
          {footer}
        </div>
      )}
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
          {/* zone name + that zone's sensor reading, both at the ZONE CENTER
              (user request): the number belongs to the region the sensor
              represents, not to the dot. Zones without a sensor of this
              kind (e.g. nasal bridge has no SHT/TMP) just show the name. */}
          {REGIONS.map(r => {
            const rs = sensors.filter(s => regionOf(s.x, s.y) === r.id);
            const txt = rs.length
              // A * marks a substituted reading (e.g. dead TMP117 borrowing
              // its cluster's SHT40 air temp) — data, but not this sensor's.
              ? rs.map(s => (s.live && s.value != null
                  ? fmt(s.value) + (s.fallback ? '*' : '') : 'off')).join(' · ')
              : null;
            return (
              <g key={r.id}>
                <text x={r.label.x} y={r.label.y} textAnchor="middle"
                      fontSize="3.6" fontWeight="800" fill="rgba(255,255,255,0.92)"
                      stroke="#05050a" strokeWidth="0.8" paintOrder="stroke">
                  {r.name}
                </text>
                {txt && (
                  <text x={r.label.x} y={r.label.y + 5.4} textAnchor="middle"
                        fontSize="4.6" fontWeight="800" fill="#ffffff"
                        stroke="#05050a" strokeWidth="0.9" paintOrder="stroke">
                    {txt}
                  </text>
                )}
              </g>
            );
          })}
          {/* one path strokes both the outer profile and the hole edge */}
          <path d={MASK_PATH_D} fill="none"
                stroke="rgba(160,220,255,0.45)" strokeWidth="0.7" />
          {/* gray dot + ID tag per sensor (T1/H2/...): the reading lives at
              the zone center, the tag says which sensor sits where. A dead
              sensor fades to a translucent ghost. */}
          {sensors.map(s => (
            <g key={s.label}>
              {/* the dot reflects the PHYSICAL sensor: it stays ghosted while
                  its value is a fallback from a neighbor in the cluster */}
              <circle cx={s.x} cy={s.y} r="2.1"
                      fill={s.live && !s.fallback && s.value != null ? '#9ca3af' : 'rgba(156,163,175,0.25)'} />
              <text x={s.x} y={s.y - 3.2} textAnchor="middle" fontSize="3.5"
                    fontWeight="700" fill="#cdd6f4" stroke="#05050a"
                    strokeWidth="0.7" paintOrder="stroke">
                {s.label}
              </text>
            </g>
          ))}
        </svg>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', margin: '0.4rem 0.15rem 0.1rem' }}>
          <span className="num" style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-dim)' }}>
            {(domain || live.length) ? fmt(lo) : '--'}
          </span>
          <div style={{
            flex: 1, height: 12, borderRadius: 6,
            background: `linear-gradient(to right, ${stops[0]}, ${stops[1]}, ${stops[2]})`
          }} />
          <span className="num" style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-dim)' }}>
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
    s.live === next.sensors[i].live &&
    // fallback flips can leave the value nearly unchanged (air ≈ skin after
    // matching) — compare it explicitly so the * appears/disappears on time
    !!s.fallback === !!next.sensors[i].fallback &&
    close(s.value, next.sensors[i].value)));
