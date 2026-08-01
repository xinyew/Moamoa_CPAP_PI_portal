/*
 * Mask flex-board geometry for the Visualized view.
 *
 * Extracted 2026-08-01 from the hardware design
 * (Moamoa_CPAP_PI_hardware/kmm-pmask-mask/kmm-pmask-mask.kicad_pcb):
 * outer Edge.Cuts loop chained from 355 segments (downsampled), and
 * sensor footprint centers in the PCB's own mm coordinates (KiCad and
 * SVG both have y pointing down, so coordinates map 1:1).
 *
 * The flex connector tail (runs up to y=40 toward the control board)
 * is trimmed — no sensors live there, and a heatmap over it would be
 * pure extrapolation. The outline bridges straight across its base.
 *
 * Sensor index mapping (PCB pad nets -> mux channel -> stream index ->
 * displayed key, verified against the board dts and this portal's
 * SITE_MAP in useComm.js):
 *   mux ch0: U5 MS5611, U11 SHT40, U4 TMP117, (U9 PPG)  -> p2, sht1, tmp1
 *   mux ch1: U1 MS5611, (U2 PPG)                        -> p1
 *   mux ch2: U7 MS5611, U12 SHT40, U14 TMP117, (U10 PPG)-> p3, sht2, tmp2
 *   mux ch3: U6 MS5611, U3 SHT40, U13 TMP117, (U8 PPG)  -> p4, sht3, tmp3
 * (PPG positions recorded for the future PPG visualization.)
 */

export const MASK_OUTLINE = [
  [29.8, 124.3], [29.9, 122.4], [30.2, 120.4], [30.7, 118.5], [31.4, 116.5],
  [32.2, 114.6], [33.2, 112.7], [34.3, 110.8], [35.4, 108.9], [36.5, 107.1],
  [37.7, 105.2], [38.8, 103.4], [39.9, 101.6], [41, 99.9], [42, 98.1],
  [43.1, 96.4], [44.1, 94.6], [45.2, 92.9], [46.2, 91.2], [47.2, 89.5],
  [48.3, 87.7], [49.3, 86], [50.4, 84.3], [51.4, 82.5], [52.5, 80.8],
  [53.7, 79], [54.8, 77.2], [56, 75.4], [57.3, 73.6], [58.6, 71.8],
  [60, 70],
  // tail trimmed here — bridge across the strap base, keeping the neck
  // shoulders so the U1 baro (75, 67) stays inside the outline
  [64, 63.9], [86.7, 65.8],
  [91.3, 71.8],
  [92.6, 73.5], [93.8, 75.2], [95, 76.9], [96.1, 78.7], [97.3, 80.4],
  [98.4, 82.1], [99.5, 83.8], [100.5, 85.5], [101.6, 87.2], [102.7, 88.9],
  [103.7, 90.7], [104.7, 92.4], [105.8, 94.1], [106.8, 95.9], [107.8, 97.6],
  [108.9, 99.4], [109.9, 101.2], [111, 102.9], [112.1, 104.8], [113.2, 106.6],
  [114.3, 108.4], [115.4, 110.3], [116.4, 112.2], [117.4, 114.1], [118.2, 116],
  [119, 118], [119.6, 120], [120, 122], [120.2, 124], [120.2, 126],
  [120, 128], [119.7, 129.9], [119.1, 131.8], [118.4, 133.6], [117.4, 135.3],
  [116.3, 136.8], [115, 138.3], [113.5, 139.6], [111.8, 140.8], [110.1, 141.9],
  [108.2, 143], [106.2, 143.9], [104.1, 144.7], [102, 145.4], [99.8, 146.1],
  [97.6, 146.7], [95.3, 147.2], [93, 147.6], [90.8, 148], [88.6, 148.3],
  [86.3, 148.6], [84.1, 148.8], [81.9, 148.9], [79.7, 149], [77.5, 149],
  [75.3, 149], [73.1, 149], [70.9, 148.9], [68.7, 148.7], [66.5, 148.6],
  [64.3, 148.4], [62, 148.1], [59.8, 147.8], [57.5, 147.5], [55.2, 147.2],
  [52.9, 146.8], [50.7, 146.3], [48.5, 145.8], [46.3, 145.2], [44.2, 144.5],
  [42.3, 143.6], [40.4, 142.6], [38.7, 141.4], [37.1, 140.1], [35.6, 138.7],
  [34.3, 137.1], [33.2, 135.5], [32.2, 133.8], [31.4, 132], [30.7, 130.1],
  [30.2, 128.2], [29.9, 126.3],
];

export const MASK_VIEWBOX = { x: 28.5, y: 62.5, w: 93, h: 88 };

// Footprint centers (mm), keyed by the portal's DISPLAYED indices.
export const BARO_POS = {   // MS5611 contact pressure, keys match p1..p4
  1: { x: 75, y: 67 },      // U1 (mux ch1, top center)
  2: { x: 55, y: 86 },      // U5 (mux ch0, left)
  3: { x: 70, y: 143 },     // U7 (mux ch2, bottom)
  4: { x: 103, y: 100 },    // U6 (mux ch3, right)
};
export const SHT_POS = {    // SHT40 air temp + RH, keys match sht1..3
  1: { x: 42, y: 109 },     // U11 (mux ch0, left)
  2: { x: 95, y: 143 },     // U12 (mux ch2, bottom right)
  3: { x: 89, y: 77 },      // U3  (mux ch3, top right)
};
export const TMP_POS = {    // TMP117 skin temp, keys match tmp1..3
  1: { x: 61, y: 77 },      // U4  (mux ch0, top left)
  2: { x: 55, y: 143 },     // U14 (mux ch2, bottom left)
  3: { x: 108, y: 109 },    // U13 (mux ch3, right)
};
export const PPG_POS = {    // MAX30101, for the future PPG visualization
  1: { x: 75, y: 77 },      // U2  (mux ch1)
  2: { x: 47, y: 100 },     // U9  (mux ch0)
  3: { x: 80, y: 144 },     // U10 (mux ch2)
  4: { x: 95, y: 86 },      // U8  (mux ch3)
};

// ---- heatmap grid: cell centers inside the outline, precomputed once ----

const pointInPoly = (x, y, poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
};

export const GRID_STEP = 2.5; // mm per heatmap cell

export const MASK_CELLS = (() => {
  const cells = [];
  const { x, y, w, h } = MASK_VIEWBOX;
  const half = GRID_STEP / 2;
  for (let cy = y + half; cy < y + h; cy += GRID_STEP) {
    for (let cx = x + half; cx < x + w; cx += GRID_STEP) {
      // Keep the cell if its center OR any corner is inside — boundary
      // cells then overdraw and the SVG clip trims them, so the filled
      // field meets the outline without stair-step notches.
      const inside =
        pointInPoly(cx, cy, MASK_OUTLINE) ||
        pointInPoly(cx - half, cy - half, MASK_OUTLINE) ||
        pointInPoly(cx + half, cy - half, MASK_OUTLINE) ||
        pointInPoly(cx - half, cy + half, MASK_OUTLINE) ||
        pointInPoly(cx + half, cy + half, MASK_OUTLINE);
      if (inside) cells.push([cx, cy]);
    }
  }
  return cells;
})();
