# Claude Session Log — CPAP PI Portal

Purpose: detailed record of what was done in each Claude Code session so
future sessions (and humans) can pick up without re-deriving anything.
Newest session at the top. Keep appending; do not rewrite history.

---

## Session 2026-08-03 (cont.) — ABS heatmaps: fixed scale -> live-centered window

User report: pressure heatmap numbers update but the COLOR never moves in
ABS mode (Delta was fine). Root cause, not a render bug: sensor matching
collapses the four sites to within a fraction of a mmHg of each other, so
on the fixed 730-750 scale every cell painted one clamped color; same
class of freeze for Temperature (bench values sit below the 34-41 span).
Delta worked because domain=undefined auto-fits.

Fix (MaskHeatmap `adapt` prop): in ABS the scale is now a WINDOW centered
on the live readings — at least `adapt` wide (pressure 2 mmHg, temp 1 C,
RH 5 %RH), growing 1.6x with the live spread, capped at the fixed
domain's span. Continuous by construction: a press widens the window
smoothly instead of snapping between a zoomed and a frozen scale (the
first cut used a 10%-crowding trigger and did exactly that snap — pressed
hard enough it jumped BACK to the frozen 730-750; replaced). Colorbar
always labels the window in use. SNR stays fixed 0-10 (quality metric).
Delta path untouched.

Verified with the stubbed board feeding DATA frames (matched sites ~740,
phase-shifted wobble): idle window 739.1-741.1 with visible texture;
+2.5 mmHg press -> window 739.3-743.3, pressed zone deep red; release ->
snaps home. A mid-test freeze turned out to be an HMR artifact (stale
notification closure after editing MaskHeatmap) — full reload + fresh
stub run confirmed the code path clean.

---

## Session 2026-08-03 (cont.) — TMP117 dropout falls back to cluster SHT40 air temp

The connected device's skin-temp sensor 1 has a flaky solder joint that
toggles it on/off. When a TMP117 drops out (tmpMask bit clears) its site
now borrows the CO-LOCATED SHT40's air temperature instead of going dark
- tmp_i and sht_i share a mux cluster, indices aligned, no SITE_MAP swap
on these masks. The moment the sensor answers again its real reading
takes over. Display only; CSV stays raw.

- Substituted readings are marked: zone value and strip Skin degC get a
  trailing *, and the sensor dot stays GHOSTED (the dot reflects the
  physical sensor, the number reflects the best available data).
- Heatmap field keeps the site: live = tmpLive || shtLive.
- Delta/tare paths (tareTmp, tmpVal) run on the displayed value, so
  toggling Delta mid-fallback stays consistent.
- MaskHeatmap memo now also compares the fallback flag (a flip can leave
  the value within the 0.02 close() window and the * would lag).
- Both sensors dead -> strip shows -- (was 0.0 via the sentinel).
- Matching baselines were already dropout-safe: 0 is filtered as the
  firmware no-data sentinel, so a dead tmp1 never poisons offsets.

Verified on 5172 with a stubbed navigator.bluetooth board (STATUS frames,
tmpMask toggling 0b110<->0b111): zone shows 24.8* ghost-dot while dead,
36.5 solid when alive, swaps instantly both directions; strip mirrors it.
(Stub gotcha: navigator.bluetooth is a readonly getter - plain assignment
silently no-ops and the click hits the REAL chooser; use
Object.defineProperty.)

---

## Session 2026-08-03 (cont.) — multi-board: two devices connected, picker chips

First slice of the multi-board port (handoff section 3), kept minimal on
purpose: EVERY connected board keeps its BLE link, ONE board drives the
display, and switching is instant.
- useComm: boardsRef registry (id -> {name, device, rxChar}), boards/
  activeId state, switchBoard(). The multi-board gate lives in each
  board's notification callback: `if (activeIdRef.current !== id) return`
  — inactive boards' frames are dropped before parsing, so the whole
  single-board pipeline (parser, matching, tares, charts) is untouched.
- Switching = a new stream: resetDisplay() clears history/baselines/
  telemetry; Dashboard resets all tares on activeId change and the
  sensor-matching capture re-runs (activeId added to its effect deps).
- 'T' tsync now broadcasts to every connected board each interval (each
  keeps its own RC clock + SD log); 'P' sensing goes to the ACTIVE board.
- Disconnect now drops only the active board; the next board takes over
  via the gattserverdisconnected bookkeeping. Full-reload behavior
  remains only for the RTT path.
- UI: dev-chips beside the title — one chip per board (active filled),
  "+" opens the chooser for another board. Re-picking a connected board
  just activates it.
- Two mishaps caught live: a hook-order crash that was really a stale
  destructure patch (pattern didn't match the actual field order, so
  `activeId` was undefined) — fixed by adding the fields for real; and
  the HMR hook-order warning noise that came with editing hook lists.
Verified with a stubbed navigator.bluetooth issuing two fake boards:
chips render (newest active), both boards stream different vbat
(1111/2222) SIMULTANEOUSLY and only the active board's value shows
(2.22V -> switch -> 1.11V), active chip follows the switch, badge LIVE.
NOT verified on real hardware (needs two powered boards); the android
branch does not have this yet.

---

## Session 2026-08-03 (cont.) — demo generator: separated PPG, requested heat bands

- Overlay demo PPG traces no longer tangle: per-site DC offsets now exceed
  the pulse amplitude (r +5000/site, i +9000, g +3500), so the four sites
  ride as four visibly separate traces (measured 22px apart on screen).
- Heatmap demo bands per user: pressure 735±3.5 (730-740), skin temp
  36.5±1.4 (35-38ish), RH 55±22 (30-80ish). KEY CONSTRAINT: sensor
  matching wipes fixed per-site offsets from the display, so the spread
  is built from slow PHASE-SHIFTED ripples (periods 20-50s), which
  matching preserves. Values start near the group mean and fan out as
  the phases separate.
- IR SNR spread: per-site IR noise [700, 1200, 2100, 6200] targets
  SNR roughly [6.5, 4.6, 2.9, 1.0] across the 0-10 scale. Not measured
  live here — the hidden browser pane throttles the demo timer so the
  50-sample SNR buffer never fills; foreground tabs fill it in ~1 s.

---

## Session 2026-08-03 (cont.) — overlay adopts the per-site ramps; pressure goes yellow

- Overlay now uses the SAME CH_RAMPS as split: each overlay chart draws
  its four sites as four shades of the channel hue (site 1 strongest).
  The legacy SITE_COLORS aliases (PPG_*_COLORS / BARO_COLORS) are gone;
  SiteLegend takes a `colors` prop so its numbered dots match the traces
  exactly. SITE_COLORS itself survives only for the ring-legend fallback.
- Pressure ramp switched from white->gray to YELLOW (user):
  ['#ffd400','#ffe14d','#ffeb8a','#fff4c2'] — applies to overlay traces,
  split cards, pins and legends alike since all read CH_RAMPS.p.
Verified in demo (overlay): pressure strokes and legend dots =
ffd400/ffe14d/ffeb8a/fff4c2, PPG green ramp on traces + dots; split
shares the same constants.

---

## Session 2026-08-03 — per-site channel ramps, Heatmap rename, pressure 730-750

- Split view: CH_COLORS (one color per channel) -> CH_RAMPS (4 shades per
  channel). Hue = channel, shade = site, site 1 strongest -> site 4
  palest; paler means less chroma, never darker, so every step stays
  legible on #05050a. Pressure white->gray, Red, IR pink, Green.
  Both the chart trace and its SitePin dot take the same shade.
- "Visualized" renamed "Heatmap" (button + comments); viewMode key stays
  'viz' internally.
- Pressure heat scale ceiling 900 -> 750 per user. NOTE: the old floor
  755 sat ABOVE that ceiling, so the floor moved to 730 (~local ambient
  in Atlanta) — the ramp now spans "no contact load" to 750. Flagged to
  the user in case they want a different floor.
Verified in demo: Heatmap button present / Visualized gone, pressure
colorbar reads 730.00-750.00, all four ramps step correctly per site.

---

## Session 2026-08-02 (cont.) — phone-landscape layout (S21)

The phone APK was a half-scaled desktop; ratios recomputed for a ~390px
working height via `@media (max-height:500px) and (orientation:
landscape)` — desktop/tablet untouched:
- Overlay keeps 2x2 and fits ONE screen (charts ~137px measured).
- Split -> 2-across, 150px cards; Visualized -> 2x2, 300px maps; both
  views scroll vertically (`.dashboard-container.scrolling`, class set
  by Dashboard when viewMode != overlay; only has effect inside the
  media query). 16 readable charts beat 16 slivers.
- Header/strip collapse: subtitle + Air sub-line hidden, slim buttons,
  RTT stack goes horizontal, pins/legends 2.2em, sandbox inputs shrink.
Verified at 915x412 (S21 css-px viewport): overlay no-scroll 137px
charts, split 2-col scrolling, viz 2x2 321px maps, no h-overflow.

---

## Session 2026-08-02 (cont.) — colorbar 2x, corner toggles, short titles

- Heatmap colorbar doubled (6 -> 12 px), end numbers up to 1rem bold,
  margins rebalanced.
- ABS/delta toggles moved to each map section's TOP-RIGHT corner. First
  try was absolute positioning — overlapped the centered title on three
  maps; landed on in-flow flex (title centers in the width the controls
  leave over, ellipsis as the safety valve), which cannot overlap.
- Titles: "Skin Temperature" -> "Temperature" (user), and "Contact
  Pressure" -> "Pressure" (measured 287 px needed vs ~242 available at
  the user's viewport — it would have ellipsized; one-word titles match
  the rest, the unit tag keeps the meaning).
- Note: the built APKs (PI_sensor_v2 / _phone) predate this round.

---

## Session 2026-08-02 (cont. 5) — demo sandbox inputs + zone-center readings

- Demo sandbox for the Visualized maps: while demo streams, each map
  grows a per-sensor input row (T1-3 / H1-3 / P1-4 / IR1-4, empty =
  follow the live demo value). Typed values override the FINAL displayed
  value (bypassing matching/delta - what you type is what the map shows)
  and clear when demo stops. Implemented as an `ov()` layer in the
  display accessors + `footer` prop on MaskHeatmap; input strings ride
  the memo `mode` signature so partial typing ('3.') still re-renders.
  Verified: typing 95 into H1 turns the left arm hot (cell heat 0.63 ->
  3.89) and the zone shows 95.0; clearing returns to the demo value.
- Readings moved from the sensor dots to the ZONE CENTERS (name above,
  value beneath; zones without a sensor of that kind show the name
  alone). Sensor dots are bare gray markers now.

---

## Session 2026-08-02 (cont. 4) — along-ring gradient field, SNR map, traffic-light ramp, strapless outline

- Heatmap field rebuilt twice on user feedback, landing on PIECEWISE-
  LINEAR interpolation between angularly adjacent sensors around the ring
  hub (circular, HUB exported from maskGeometry). Each sensor anchors its
  stretch of ring and its influence spreads ALL THE WAY to the neighbor
  sensors — whole zones shade, no blob around the dot: H3 (upper right)
  rising warms nasal bridge AND right; H2 warms right AND chin; H1 warms
  left AND chin. (First attempt was angular IDW — still re-concentrated
  around the sensors; user clarified and it became linear.) Euclidean IDW
  before that collapsed most of the ring to the global mean.
  Verified with a synthetic STATUS (H1=30 / H2=90 / H3=60 on the 30-100
  scale): heat rises monotonically left(0.48) -> nasal(0.89) ->
  rightUp(1.65) -> rightLo(2.69) -> chinR(3.67) and cools toward H1
  (chinL 1.1) — a continuous gradient along the ring.
- NEW 4th map: PPG IR SNR (viz-card span 4 -> 3). Per-site quality =
  RMS(iAc) / (RMS(first difference)/sqrt2) over the buffer — the pulse
  (1-3 Hz) barely reaches sample-to-sample steps at 100 Hz, broadband
  noise dominates them. INVERTED ramp (red at 0, green high), domain
  0-10 (~1 = white-noise floor, >5 = solid pulse). Demo: all sites 16.5
  -> clamped green (clean synthetic pulse, as expected).
- Ramp is traffic-light: green (#22c55e) safe -> yellow -> PURE red
  (#ff0000) alarm, per user ("경각심"); green low end replaced blue
  ("안전 표시색"). One shared THERMAL_STOPS for the three physical maps.
- Sensor markers: plain gray (#9ca3af), no outline; dead sensors become a
  translucent gray ghost. The field carries the value, the dot only marks
  position.
- FFC/mux strap removed from the drawn outline (no face contact, no
  sensors); first cut left a slanted top — leveled to a clean horizontal
  close at y=65. MASK_VIEWBOX tightened to y 61..151. The U1/U2 tab
  survives (it belongs to the hole polygon side). MASK_CELLS regenerate
  automatically; SitePin/SiteLegend/maps share the strapless profile.

---

## Session 2026-08-02 (cont. 3) — fixed physical heat scales + named zones

- All three Visualized maps now share ONE thermal ramp (blue -> yellow ->
  red, THERMAL_STOPS) with FIXED physical domains per user spec: skin
  34-41 °C, RH 30-100 %, pressure 755-900 mmHg (900 = the MS5611's
  1200 mbar measurable ceiling). Color now means the same value on every
  glance and across sessions; out-of-range clamps to the ends. Δ mode
  falls back to auto-fit (a fixed absolute scale is meaningless for
  deltas). MaskHeatmap gained a `domain` prop; the colorbar min/max show
  the domain even before sensors go live.
- Zone labels spell the names out (Nasal bridge / Left / Right / Chin,
  3.6 px) instead of bare letters.
- Split-view SitePin dots now take the PLOT's line color (pressure white,
  Red red, IR pink, Green green) instead of uniform yellow.
Verified in demo: colorbars read 34.0-41.0 / 30.0-100.0 / 755.00-900.00,
4 zone names per map, pin colors per channel row. Build clean.

---

## Session 2026-08-02 (cont. 2) — sensor matching, radial zones, legends

Rapid-fire user feedback round on `rev2-enhancement` (5172, HMR):

1. SENSOR MATCHING (display-only, CSV stays raw): units have no factory
   calibration, so constant sensor-to-sensor bias is removed by showing
   groupMean(baselines) + (value − ownBaseline) for p1-4 / tmp1-3 /
   sht h 1-3 / sht t 1-3. Baselines = per-sensor mean over 6 samples ×
   500 ms (~3 s) right after streaming starts; offsets cleared on
   disconnect and recaptured per session. 0 skipped as the no-data
   sentinel; sensors offline at capture keep offset 0. Demo verify:
   RH 45.2/44.9/45.6 → 45.2/45.2/45.2, skin 33.2/33.8/34.1 →
   33.7/33.7/33.7 (the group means). Charts (baroData), heatmaps, strip
   and all tares run on matched values.
2. Region dividers redrawn as SPOKES from the hub (75,110) per the
   user's second mockup, letters moved INSIDE the central cutout
   (A 75,91 / B 56,108 / C 94,108 / D 75,128); regionOf() now
   angle-based. All 14 sensors re-verified into sensible zones.
3. Tare buttons REMOVED everywhere — pressing Δ re-baselines at the
   current (matched) readings every time; ABS⇄Δ is the whole workflow.
4. Overlay charts: SiteLegend at the head center — the ring with all 4
   sensors of that kind as numbered dots in SITE_COLORS (BARO_POS for
   pressure, PPG_POS for the three PPG charts).
5. Strip: labels unified to the value size (1.7rem), icons 30; Air stays
   small under RH. In Visualized the RH/Skin readouts drop out (maps
   carry them); battery + SD stay. Header was doubled then reduced to
   2/3 on request (h1 1.4rem, subtitle 0.95rem).
6. Fix in passing: useRef missing from the React import crashed the
   page (ReferenceError) — caught live, fixed; vizCorner call sites
   updated when its signature lost the base/tare args.

Verified in demo: matching converges (values above), 0 Tare buttons,
8 overlay legends, 4 region letters w/ names, viz strip = battery+SD
only, no horizontal overflow, build clean.

Late-round follow-ups (same session):
- Strip type reduced to 2/3 (values/labels 1.15rem, icons 22); RH's main
  line now sits on the shared baseline — the Air sub-line hangs BELOW the
  row flow (absolute, strip reserves bottom padding), fixing the RH cell
  riding higher than its neighbors.
- Battery + SD moved to the FAR RIGHT of the strip (marginLeft auto on
  battery; offline-note gives up its auto margin inside the strip).
- Header doubled then settled at 2/3 (h1 1.4rem, subtitle 0.95rem).
- Overlay AC fit: recharts auto y-domain was hostage to the AC baseline's
  settling transient (slow EMA starts at the first raw sample, so the
  first seconds hold huge decaying values that flattened the real pulse).
  acYDomain() fits the 5th-95th percentile of the visible window (+25%
  pad, allowDataOverflow) in AC mode only. Axis tick fonts were doubled
  on request and then reverted to original on a follow-up request —
  only the AC domain fix remains.
- Verified: battery/SD flush right, AC y-ticks track the signal band,
  no overflow, build clean.

---

## Session 2026-08-02 (cont.) — strip consistency + site pins everywhere

Follow-up user feedback, same branch (5172, HMR live):
- Strip type unified LARGE: big labels 1.05rem, Air sub-line 0.85rem,
  strip-local toolbar labels/segments 1rem (`.strip-card` scoped so the
  compact viz-corner controls stay small). Values remain 1.7rem.
- Pressure ABS/Δ/Tare REMOVED from the strip — it lives on the pressure
  heatmap now (state is shared, so overlay/split still honor Δ; the
  overlay chart header keeps showing the baseline text).
- In Visualized view the strip also drops Window Full/5s and PPG RAW/AC
  (no time series there). Fault note stays in all views; the strip's
  baroBaseText fallback line was removed outright.
- SitePin enlarged ~3x (1.35em -> 4em, measured 64 px) and added to all
  PPG minis via PPG_POS (keys are display indices, same as BARO_POS) —
  every split card now shows where its sensor sits on the ring.
Verified in demo mode: strip has no ABS/Δ in any view, Window/PPG absent
only in viz, 4 pressure + 12 PPG pins at 64 px, controls at 16px/16.8px,
no horizontal overflow. (One earlier 12.16px reading was pre-HMR stale —
re-measured 16px after the style injection landed.)

---

## Session 2026-08-02 — viz zones + per-map Δ, split channel colors, big strip

On `rev2-enhancement` (user's working branch; 5172 dev server, HMR live).

1. Visualized view — per-map ABS/Δ + Tare, top-right of each heatmap:
   - New `tmpDelta/tmpBase` and `rhDelta/rhBase` states beside the existing
     baro pair; `vizCorner()` builds the corner control; `MaskHeatmap`
     gained `controls` + `mode` props (mode folds ABS/Δ + streaming into
     the React.memo comparator — the controls JSX itself must not be
     compared, it's a fresh element every render).
   - Skin temp / humidity deltas are per-sensor against their tare
     snapshot; unit label flips to 'Δ °C' / 'Δ %RH'. Pressure map reuses
     the shared baroControlGroup (same state as the charts).
2. Anatomical zones on the mask maps (user mockup): ring divided into
   A nasal bridge (strap+tab+apex: x 64-86, y<84), B left / C right
   (split at x=75), D chin (y>135) — `REGIONS`, `regionOf`,
   `REGION_DIVIDERS` in maskGeometry.js. Sensor positions untouched;
   every sensor verified to land in its sensible zone (p1→A; p2,sht1,
   tmp1→B; p4,sht3,tmp3→C; p3,sht2,tmp2→D). Drawn as dashed dividers
   clipped to the ring + bold letters with the zone name in a hover
   <title>. Letters render as "Nasal bridgeA" in textContent — that's
   the <title> child, not a bug.
3. Split view recolored by CHANNEL (user: site colors weren't intuitive):
   pressure white #f2f5ff, Red #ff5252, IR pink #ff4db8, Green #2ee880
   (`CH_COLORS`); columns still encode the site. Each Pressure card
   header now carries a `SitePin` — a tiny mask-ring SVG with a dot at
   that baro's real position (reuses MASK_PATH_D/BARO_POS).
   Overlay/Visualized keep the neon site colors.
4. Strip: SHT40 air temp is now a small gray line under RH% (same chip,
   context not primary); RH / Skin°C / battery / SD get doubled type
   (`.strip-item.big`, 0.85rem→1.7rem values). Strip is shared, so this
   applies in all three views.

Verified on :5172 with demo mode, DOM-checked: 3 maps each with ABS/Δ/
Tare + 4 dividers + A-D letters w/ name tooltips; Δ on skin temp flips
unit and shows T1-3 = 0.0 vs tare while humidity stays ABS (independent);
split rows uniform per channel and 4 white pressure cards each with a
pin; strip values 27.2px (doubled), Air sub-line present, no horizontal
overflow. `vite build` clean.

---

## Session 2026-08-01 (later still) — 'P' sensing toggle implemented on `rev2-enhancement`

Branch note: working on `rev2-enhancement` at the user's request. It was
fast-forwarded to `origin/rev2-enhancement-xinye` (0c42b4e) first, so the
two lines are identical apart from this commit.

Verification before coding (the established practice — it paid off):
- First pass found NO 'P' anywhere: commit 4c03bf3 absent, no `docs/`
  directory, `comm_protocol.h` listing only 'B'/'J'/'T', and flags byte 36
  with bits 0-1 only. Checked all four firmware branches (main,
  integration, eval, quartz). Reported rather than coding to the spec.
- xinye pushed during the session. Re-pulled and confirmed against source:
  `COMM_CMD_POWER 'P'` (comm_protocol.h:86), handler at comm_manager.c:447
  (`len >= 2`, `atomic_set(&sensing_enable, data[1] ? 1 : 0)`), and
  `p[36] |= (d->sensing_on ? BIT(2) : 0)` at comm_manager.c:282-283.
  docs/ble-protocol.md + docs/portal-integration.md now exist and match.
- Standing instruction from the user: `git pull` before every read of the
  firmware repo (`../Moamoa_CPAP_PI_firmware`).

Implementation:
- `useComm.js`: parse `sensingOn: (flags & 4) !== 0`; add
  `setSensing(on)` writing `[0x50, on?1:0]` via the existing `rxCharRef`
  (same write-without-response path as the 'T' tsync). Nothing is sent on
  connect — the board keeps its setting across disconnects, so the UI
  reads bit2 and reflects it. `emptyLatest.sensingOn` defaults true
  (boot default is ON) so a fresh connect does not flash "paused".
- `Dashboard.jsx`: `sensingOn` from device state only; `sensingIdle =
  isConnected && !sensingOn`; bit0 separates the two idle causes. Toggle
  button (Power icon) disabled unless BLE — 'P' rides the NUS RX
  characteristic, which the RTT path does not have.
- Badge: LIVE / SENSING OFF (mask present) / NO MASK (mask absent) /
  PAUSED (local display freeze) / DEMO / DISCONNECTED.
- `index.css`: `.sensing-idle .chart-card` greys + dims the charts so a
  stale trace cannot be mistaken for live signal, while the strip
  (battery, mask, SD) stays legible. Not a frozen screen, per the doc.

Verified: `vite build` clean. Bit-2 parsing driven with synthetic STATUS
frames via `window.__feedFrame`. Then the connection-gated paths were
driven for real through the RTT WebSocket path using a throwaway bridge
(scratchpad `fake_rtt.py` serving ws://localhost:8765) that steps the
flags byte 0b111 -> 0b011 -> 0b010 -> 0b111. Observed, in order:
LIVE/"Sensing"/not greyed -> SENSING OFF/"Sensing Off"/greyed ->
NO MASK/"Sensing Off"/greyed -> LIVE again. Recovery needs no 'P',
matching the firmware's auto-resume. No console errors.

NOT verified (needs hardware): the outgoing 'P' write itself. The button
is BLE-only and no board was available, so `setSensing` has never actually
put bytes on the wire. It uses the identical characteristic and method as
the working tsync write. Fold this into the §7-item-2 live-board retest.

Still open: port this commit to `android-tablet-app` (the bleTransport
seam makes it near-identical — `conn.write(new Uint8Array([0x50, x]))`).

---

## Session 2026-08-01 (later) — compact one-screen layout on `rev2-enhancement-xinye`

User request: make the portal fit ONE screen with no scrolling (web first;
the Android app will be updated LATER — explicitly deferred by the user).
Working branch: `rev2-enhancement-xinye` (created from
`origin/rev2-enhancement`; session log carried over from main).

Layout architecture (src/index.css + src/Dashboard.jsx):
- `#root` is 100vh (`overflow: auto` + container `min-height: 540px` as a
  floor — below that a scrollbar appears instead of clipping).
- NOTE: App.jsx wraps the dashboard in `<div class="App">`; that div needs
  `height: 100%` or the whole percentage-height chain silently collapses
  to the min-height floor (found live via computed styles).
- `.dashboard-container`: 12-col grid, `grid-template-rows: auto auto`
  (header, strip) + `grid-auto-rows: minmax(0, 1fr)` — every implicit
  chart row splits the leftover height evenly, so BOTH views fit
  automatically: Overlay = 2 rows (2x2), Split = 4 rows (4-across).
- Chart cards are `.chart-card` flex columns (`.chart-head` auto +
  `.chart-body` flex-1 min-height:0) with `ResponsiveContainer
  height="100%"` — no fixed pixel chart heights anywhere anymore.
- The old env-card + two toolbar cards merged into ONE `.strip-card` row:
  RH / Air C / Skin C / battery / SD + Window Full-5s + PPG RAW-AC +
  Pressure ABS-delta-Tare + fault note (ellipsized, tooltip carries detail).
- Compacted: paddings, button/segment sizes, axis fonts 10px, axis height
  16, Y-axis width 44-48, legend 14px (pressure chart only), PPG latest
  value moved into the card header, header subtitle one line, Record
  button labels shortened.
- Overlay: pressure + 3 PPG each `span 6` (2x2). Split: minis `span 3`
  (4-across; 16 cards + strip + header all on screen).

Verified in Chrome (dev server :5199) with Demo mode: Overlay and Split
both fill exactly one 1568x774 viewport, no scrollbars, all controls
visible. Split = 16 readable charts.

Not done yet (deferred by user): the same compact treatment for the
Android app branch.

---

## Session 2026-08-01 (handoff) — protocol update received, NOT yet implemented

Firmware commit 4c03bf3 (Moamoa_CPAP_PI_firmware) adds a 'P' sensing
on/off command; full spec in that repo's docs/ble-protocol.md and
docs/portal-integration.md. PORTAL WORK IS PENDING. Summary:
- RX 'P' (0x50) + 1 byte: 0x00 sensing off (~10 mA saved), 0x01 on.
  Idempotent, write-without-response, same RX char as 'B'/'T'.
- STATUS flags byte @36 gains bit 2 = sensingOn (bit0 mask present,
  bit1 SD logging). UI must derive the toggle from bit 2, NOT from the
  last command sent. While off: DATA frames stop, STATUS keeps 1 Hz —
  render "sensing paused" (gray charts, keep battery/mask), not a
  broken stream.
- Sensing runs only when remote-enable AND mask present; the board
  auto-pauses when the mask is unplugged >=5 s and auto-resumes on
  reattach — so bit 2 can clear without any 'P'. Distinguish via bit 0:
  mask absent -> "mask disconnected"; present but bit2 clear ->
  "paused by user".
- State persists across BLE disconnects (boot default ON); on
  reconnect read bit 2 to restore the toggle. Multi-board: send per
  connection.
- RENAME: the board now advertises CPAP_PI_Control (was
  KMM_PMask_Control). Web Bluetooth filter already includes prefix
  'CPAP' (kept alongside 'KMM'); the native scanner filters on the NUS
  service UUID, so both keep working unchanged.

---

## Session 2026-08-01 (cont.) — rev2 app ported to the Android tablet

User request: (1) sync the session log to main (done, main 531b718) and
(2) port the up-to-date web app to the tablet app.

On `android-tablet-app` (commits 0e1d726 + 2aa85ef):
- rev2-enhancement-xinye src brought over wholesale (compact layout,
  neon theme, Visualized view, rev2 fixes, v2.1 tsync).
- IMPORTANT TRADE-OFF: this REPLACED the multi-board (10 tabs)
  dashboard that previously lived on this branch — the rev2 line is
  single-board. Multi-board on the rev2 codebase is still future work;
  the old multi-board code survives on `main` and in this branch's
  history (a886b97 and earlier).
- `src/bleTransport.js` rewritten to the rev2 interface: uniform handle
  {id, name, write, disconnect} — Web Bluetooth on web, BleClient on
  Android. write() carries the RX commands, so 'B' + 'T' (initial and
  10-min re-sync) work identically natively. CSV export: browser
  download on web; Documents + share sheet on Android (timestamped).
  RTT toggle hidden natively; connect() forces BLE in the app.
- Built (JAVA_HOME + gradlew assembleDebug), installed on SM-X820,
  verified fullscreen via adb screenshots: compact neon UI identical to
  web, no RTT toggle, native scanner opens on Connect, demo mode
  streams, Visualized view renders the 3 mask-ring heatmaps.
- NOT retested live: a real board link (no board was advertising —
  "No device found"; the board from the 07-30 test was powered off).
  The native BLE path (requestDevice/connect/notifications/write) is
  the same plugin sequence that streamed live on 07-30; the new write()
  wrapper is the only delta. Retest when a board is next powered.

---

## Session 2026-08-01 (cont.) — Visualized view: mask-shape heatmaps

User request: third view ("Visualized") beside Overlay/Split — heatmaps
of temperature, humidity, and pressure over the REAL mask shape with
REAL sensor positions. PPG visualization explicitly deferred.

Geometry provenance (all verified, scripts in session scratchpad):
- Outline + footprint centers parsed from
  Moamoa_CPAP_PI_hardware/kmm-pmask-mask/kmm-pmask-mask.kicad_pcb
  (outer Edge.Cuts loop: 355 chained segments, downsampled ~120 pts;
  flex connector tail trimmed — no sensors there; neck shoulders kept
  so U1 stays inside). KiCad and SVG are both y-down: coords map 1:1.
- refdes -> mux channel read from PCB pad nets (/I2Cn_SDA|SCL):
  ch0 = U5 baro + U11 SHT + U4 TMP (+U9 PPG),  ch1 = U1 baro (+U2 PPG),
  ch2 = U7 + U12 + U14 (+U10),  ch3 = U6 + U3 + U13 (+U8).
  Matches board dts exactly (ch1 cluster has no SHT/TMP).
- Channel -> displayed key via dts stream order + this branch's
  SITE_MAP: p1=U1, p2=U5, p3=U7, p4=U6; sht1..3 = U11,U12,U3;
  tmp1..3 = U4,U14,U13. All recorded in src/maskGeometry.js (with PPG
  positions saved for later).

Implementation:
- src/maskGeometry.js — outline poly, viewBox, per-key sensor coords,
  precomputed heatmap cell grid (2.5 mm cells; a cell is kept if center
  OR any corner is inside, then the SVG clip trims overflow so the
  field meets the outline cleanly).
- src/MaskHeatmap.jsx — IDW (power 2) field over live sensors, 3-stop
  sequential dark->neon ramp (monotonic lightness), sensor dots with
  direct value labels ("off" + hollow dot when masked out), min/max
  colorbar. React.memo with 0.02 tolerance = natural throttle against
  the 25 Hz pressure stream. Domain padded so noise on a uniform field
  doesn't paint full-scale.
- Dashboard: splitView bool -> viewMode 'overlay'|'split'|'viz';
  third segment button "Visualized". Pressure map honors ABS/delta+Tare
  and uses SITE_COLORS dots; temp = TMP117 (skin), humidity = SHT40 RH.
  Ramps: temp pink, RH cyan, pressure amber (all sequential).
- Verified in Chrome demo mode: three mask-shaped maps on one screen,
  gradients track the per-sensor values.

---

## Session 2026-08-01 (cont.) — protocol v2.1: 'T' wall-clock sync complete

User supplied the v2.1 protocol integration spec (adds RX command
'T' 0x54 + u64 LE epoch-ms, 9 B total). Cross-checked against
Moamoa_CPAP_PI_firmware @ 14f741f: confirmed TSYNC record type 0x13
(16 B) is SD-LOG ONLY — never sent over BLE, portal parses nothing new.
Firmware maps monotonic uptime -> wall clock retroactively for the whole
boot; the offline doctor-facing SD reader (firmware repo 3af8d89)
drift-corrects between TSYNC records.

State on `rev2-enhancement-xinye`:
- On-connect 'B' then 'T' write: ALREADY PRESENT (user's commit 5ce1366)
  — the spec's own caution; verified before touching anything.
- ADDED this session: periodic re-sync every 10 min while connected
  (TSYNC_INTERVAL_MS). NUS RX characteristic kept in `rxCharRef`;
  `sendTimeSync()` helper; interval started after the on-connect sync,
  cleared on gattserverdisconnected (and 'T' failures are swallowed —
  next interval retries). RTT path unchanged (bridge is read-only).
- For the future multi-board port (main branch): the spec requires ONE
  sync per board connection + its own 10-min timer per store — put both
  in the per-board store, not module-level.

---

## Session 2026-08-01 (later still) — split-view site columns + sweet-neon theme

On `rev2-enhancement-xinye`, after the compact layout:

1. Split view reorganized (552fbd3): channel-major render order + each
   mini chart pinned to a fixed site lane (explicit grid-column), so
   column N = Pressure N / Red N / IR N / Green N top-to-bottom, and an
   offline site leaves an empty lane instead of shifting the grid.
2. Sweet-neon theme (user request, replacing the slate/purple look):
   - KEY DESIGN CHANGE: series color now follows the SITE, not the
     channel. One fixed categorical palette everywhere:
     S1 #2ee880 green / S2 #ff4db8 pink / S3 #f0b000 amber / S4 #00c4ea
     cyan. Chart title/icon carries the channel. Split-view columns
     inherit their site's color.
   - Palette validated with the dataviz skill checker against surface
     #0f111b: worst adjacent pair dE 16.0 (deutan), 28.2 (normal), all
     >= 3:1 contrast, chroma pass. Lightness 0.70-0.82 sits ABOVE the
     dark-mode band (0.48-0.67) DELIBERATELY — neon aesthetic on thin
     line marks; legends/tooltips/columns are the secondary encoding.
     (Same-hue 4-step ramps — the old approach — cannot pass the
     separation floors on a dark surface; validator proved it.)
   - CSS: bg #05050a with twin magenta/cyan radial glows, cyan-tinted
     card borders, neon accent vars, cyan->pink title gradient, tinted
     chart grid + tooltip bg.
   - NOTE: user committed 5ce1366 mid-session (wall-clock 'T' sync in
     useComm.js + .gitignore android/) — theme work rebased cleanly on
     top; one grid-stroke edit had been clobbered by the file shuffle
     and was reapplied.
   - Verified in Chrome demo mode, Overlay + Split, one screen each.

---

## Session 2026-08-01 — review of collaborator branch `rev2-enhancement`

Reviewed (not merged) two branches pushed by ysw0624z:

- `origin/rev2-enhancement` — ONE commit `96d5f57` ("Rev2: fix waveform
  rendering, surface sensor faults, add pressure delta mode"), forked
  from `b388ef2` = BEFORE this repo's multi-board refactor (919aba1) and
  protocol README (b94f2bb). It rewrites `useComm.js`/`Dashboard.jsx`
  on the old single-board architecture.
- `origin/feature/dashboard-enhancements` — 4 earlier commits (demo
  mode, markers, window/AC controls, docs), forked from f51f8df.
  Superseded: rev2-enhancement carries all of it forward.

What rev2 contains (verified against the diff + firmware source):
1. Numeric Recharts time axis (type="number", dataMin/dataMax) — fixes
   the ~9x timebase distortion at decimated-frame seams that made clean
   waveforms look like noise. THIS BUG STILL EXISTS ON MAIN (multi-board
   Dashboard kept the category axis).
2. Dropout nulling — honours DATA validity masks (bytes 8/10) plus the
   all-three-zero zero-fill signature (correct: firmware derives the
   mask from the LAST tick only, verified in comm_manager.c). Baro 0 Pa
   -> null. Single-channel zero kept (real dead-LED fault).
3. Fault chips: OFFLINE / ALL-ZERO / per-site yield %, mapped to mux
   channels; site visibility = STATUS mask OR actual data yield.
4. SITE_MAP = [2,1,3,4]: display sites 1<->2 swapped (incl. bit-swapped
   status masks) to match rev2 mask physical wiring. CAUTION: baked-in
   hardware assumption — confirm whether rev1 masks / tablet-app boards
   share this wiring before adopting globally.
5. mbar -> mmHg (/133.322) + ABS/delta toggle + Tare; CSV format change
   (Time_s first, Marker/Time (s) last); HISTORY_LEN 300->800; demo
   mode, pause, markers (M), adjustable EMA, Full/5s window, RAW/AC;
   Launch-CPAP-FULL-v2.bat (port 5172); title "CPAP PI Dashboard -
   Full_v2".

Assessment given to user: a git merge into main will conflict on nearly
every hunk (same two files rewritten both sides). Correct path is a
PORT onto main's per-board-store architecture (ingest changes into the
per-board parser; UI onto the tabbed dashboard; decide per-board vs
global for pause/tare/markers). Android app inherits via shared parser
once ported. mmHg + site-swap need README updates; CSV schema change
may affect downstream scripts. Port not yet started — awaiting user
decision.

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

Implementation (done, commit on `main`):
- `src/useComm.js` fully refactored around per-board mutable stores in a
  ref (`storesRef: Map<id, store>`). Each store owns: `history` (300 pts),
  `latest`, `status`, `filterState` (EMA), `recorded` (CSV rows),
  `lastDevTime` (loss-break detection), `textBuffer` (JSON debug mode),
  plus the `device` (BLE) or `ws` (RTT) handle.
- Ingest happens entirely in refs; React re-renders come from a 40 ms
  snapshot interval that copies only the ACTIVE board's history/latest
  into state. 10 boards x 25 frames/s therefore never means 250 React
  renders/s — render load is flat regardless of board count.
- `addBoard()`: BLE path calls `requestDevice` once per click (the Web
  Bluetooth chooser can only return one device), keyed by `device.id`
  (stable per origin). Re-picking an already-connected board just
  activates its tab; re-picking a disconnected one reuses its store so
  history/recording continue. RTT path is a singleton board id `'rtt'`.
- `disconnectBoard(id)` closes GATT/WS and removes the tab; on
  `gattserverdisconnected` the tab stays (red dot) so data isn't lost.
- Recording is global; stop downloads one CSV per board:
  `KMM_PMask_<name>.csv` (browser may prompt to allow multiple downloads).
- Filter toggle is global; EMA state is per board. Filter now also resets
  its state across loss-break null points (small correctness improvement).
- `src/Dashboard.jsx`: tab bar under the header (`.board-tabs` in
  `index.css`) with connection dot + kind icon + name and an "N/10
  boards" counter; "+ Add Board" replaces "Connect"; "Disconnect" acts on
  the active board only; the RTT/BLE toggle picks the interface for the
  NEXT added board and hides at 10 boards.
- The old `disconnect()` = `window.location.reload()` is gone.
- Verified: `npm run build` passes. ESLint reports only pre-existing
  issues (react/prop-types in App/Dashboard, one empty catch) that also
  existed before this session.

### Part 3 — Android tablet app (branch `android-tablet-app`)

Implemented on branch `android-tablet-app` (branched from `main` after the
multi-board commit, so the app has 10-board support too):

- Capacitor 6 (`@capacitor/core|cli|android@6`) +
  `@capacitor-community/bluetooth-le@6.1.0`, `@capacitor/filesystem@6`,
  `@capacitor/share@6`. `capacitor.config.json`: appId
  `edu.gatech.kmm.pmask`, appName "KMM PMask Portal", webDir `dist`.
- `npx cap add android` generated the `android/` Gradle project
  (committed; template .gitignore excludes build outputs + copied web
  assets). Gradle 8.2.1, AGP per Capacitor 6, compileSdk 34, minSdk 22.
- Manifest permissions added: BLUETOOTH_SCAN (neverForLocation) +
  BLUETOOTH_CONNECT (Android 12+), legacy BLUETOOTH/BLUETOOTH_ADMIN/
  ACCESS_FINE_LOCATION capped at maxSdkVersion 30, `bluetooth_le`
  hardware feature required.
- New `src/bleTransport.js` — the ONLY platform-specific file:
  `requestAndConnect({onData, onDisconnect})` → `{id, name, disconnect}`.
  Web impl = Web Bluetooth (name prefixes KMM/CPAP); native impl =
  BleClient with a scan filter on the NUS service UUID (the boards
  advertise it). Both deliver DataView notifications, both write 'B'
  (binary mode) to NUS RX on connect. Native plugin requests MTU 512 →
  board grants 247 → 204 B frames fit one notification.
  Also `saveCsv()` (web: anchor download; native: Documents via
  Filesystem) and `shareFiles()` (native share sheet).
- `useComm.js` refactored to use the transport (uniform `store.conn`
  handle); CSV filenames now timestamped; on native, `addBoard` always
  uses BLE and Dashboard hides the RTT toggle (`isNative` export).
- No RTT in the app per user instruction — web portal keeps it.

Toolchain set up on this PC (nothing was installed system-wide; no PATH
or registry changes — future sessions must set JAVA_HOME explicitly):
- Portable Temurin JDK 17.0.20 at `%LOCALAPPDATA%\Android\jdk\jdk-17.0.20+8`.
- Android SDK at `%LOCALAPPDATA%\Android\Sdk` (cmdline-tools "latest",
  platform-tools/adb, platforms;android-34, build-tools;34.0.0).
  License acceptance: sdkmanager --licenses could not read piped input,
  so the standard license hash files were written to `Sdk\licenses\`.
- `android/local.properties` (not committed) has
  `sdk.dir=C:/Users/xwang3239/AppData/Local/Android/Sdk`.

Build verified: `gradlew.bat assembleDebug` → BUILD SUCCESSFUL →
`android/app/build/outputs/apk/debug/app-debug.apk`.

Device install + on-device test (PASSED, 2026-07-30 ~17:23):
- Samsung tablet SM-X820, serial `R52Y20DR3JF`. First `adb` contact was
  "unauthorized"; after the user authorized USB debugging (an
  `adb kill-server`/restart re-triggered the prompt), `adb install -r`
  succeeded.
- Verified via adb screenshots, driving the UI with `adb shell input tap`:
  1. App launches; dashboard identical to web portal; RTT toggle
     correctly absent (native build).
  2. Tapping "+ Add Board" triggered the Android "Nearby devices"
     runtime permission, then the plugin's scan dialog.
  3. Scanner listed the real board: `[E8:F8:35:BC:56:37]
     KMM_PMask_Control` (NUS service UUID filter works).
  4. Selecting it connected and STREAMED LIVE: header showed
     "4x PPG @ 96Hz, 4x Baro @ 48Hz, mask attached, link full rate",
     LIVE badge, board tab "KMM_PMask_Control 1/10 boards", real
     telemetry (air 24.7/24.2/24.6 C, RH 42.3/43.6/41.3 %, skin
     24.3/24.0/23.8 C, vbat 3.67 V), and the 4-site contact-pressure
     chart plotting ~979 mbar traces. So the 204 B v2 frames arrive
     intact through the native BLE plugin (MTU OK) and the shared
     parser renders them.
- Not yet exercised on-device: CSV export via share sheet, multi-board
  with >1 physical board, JSON debug mode.

See `ANDROID.md` (on the branch) for the full build/install guide.

### Commits this session

(appended as they are made)

- `main` b94f2bb: "docs: verified BLE v2 protocol vs Moamoa firmware; fix stale refs"
- `main` 919aba1: "feat: connect up to 10 boards concurrently with board tabs"
- `android-tablet-app` c1e13d3: "chore(android): Capacitor 6 scaffold for the Samsung tablet app"
- `android-tablet-app` 2d271f9: "feat(android): platform BLE transport adapter; app is BLE-only"
- `android-tablet-app`: "docs(android): build/install guide; session log for APK build + toolchain"

### Open items / notes for the next session

- On-device smoke test PASSED (live board streaming; see Part 3). Still
  untested on the tablet: CSV export/share sheet, >1 simultaneous
  physical board, JSON debug mode.
- The Android branch intentionally does NOT merge back to `main` — the
  web portal stays Capacitor-free. If web-portal fixes land on `main`,
  rebase/merge `main` into `android-tablet-app` (there should be no
  conflicts outside package.json/package-lock.json).
- Web `useComm`/`Dashboard`/`bleTransport` changes on the branch are a
  superset of `main`'s multi-board code (main still has the pre-adapter
  in-hook Web Bluetooth code). If you want the adapter refactor on the
  web portal too, cherry-pick 2d271f9's src/ changes onto main minus the
  Capacitor imports — they are dynamic imports, so the web build works
  either way (vite code-splits them; verified in the branch build).
- ESLint has pre-existing errors (react/prop-types, one empty catch);
  `npm run build` is the working verification gate.
- 17 npm audit findings predate this session (dev-dependency chain).
