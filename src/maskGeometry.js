/*
 * Mask flex-board geometry for the Visualized view.
 *
 * Extracted 2026-08-01 from the hardware design
 * (Moamoa_CPAP_PI_hardware/kmm-pmask-mask/kmm-pmask-mask.kicad_pcb):
 * Edge.Cuts segments (lines + arc chords) stitched into closed loops
 * with 0.8 mm endpoint tolerance, then downsampled. KiCad and SVG are
 * both y-down, so coordinates map 1:1 in mm.
 *
 * The board is a RING following the mask rim: a closed outer profile
 * (including the connector strap at the top) and one large interior
 * cutout. A small tab hangs into the cutout at the top center — that's
 * where the U1 baro / U2 PPG sit. A third chained loop in the source
 * duplicated part of the right outer edge and was discarded.
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
  [86.2, 64.9], [90, 70], [91.7, 72.3], [93.4, 74.6], [95, 76.9],
  [96.5, 79.2], [98, 81.5], [99.5, 83.8], [100.9, 86.1], [102.3, 88.4],
  [103.7, 90.7], [105.1, 93], [106.5, 95.3], [107.8, 97.6], [109.2, 100],
  [110.7, 102.3], [112.1, 104.8], [113.6, 107.2], [115, 109.7],
  [116.4, 112.2], [117.7, 114.7], [118.7, 117.3], [119.6, 120],
  [120.1, 122.6], [120.2, 125.3], [120.1, 127.3], [119.9, 128.7],
  [119.7, 129.9], [119.3, 131.2], [118.9, 132.4], [118.4, 133.6],
  [117.8, 134.7], [117.1, 135.8], [116.3, 136.8], [115.4, 137.8],
  [114.5, 138.7], [113.5, 139.6], [112.4, 140.4], [111.3, 141.2],
  [110.1, 141.9], [108.8, 142.6], [107.5, 143.3], [106.2, 143.9],
  [104.8, 144.4], [103.4, 145], [102, 145.4], [100.5, 145.9], [99, 146.3],
  [97.6, 146.7], [96, 147], [94.5, 147.3], [93, 147.6], [91.5, 147.9],
  [90, 148.1], [88.6, 148.3], [87.1, 148.5], [85.6, 148.6], [84.1, 148.8],
  [82.7, 148.9], [81.2, 149], [79.7, 149], [78.2, 149], [76.8, 149],
  [75.3, 149], [73.8, 149], [72.4, 149], [70.9, 148.9], [69.4, 148.8],
  [68, 148.7], [66.5, 148.6], [65, 148.4], [63.5, 148.3], [62, 148.1],
  [60.5, 147.9], [59, 147.7], [57.5, 147.5], [56, 147.3], [54.5, 147.1],
  [52.9, 146.8], [51.4, 146.5], [49.9, 146.2], [48.5, 145.8], [47, 145.4],
  [45.6, 145], [44.2, 144.5], [42.9, 143.9], [41.6, 143.3], [40.4, 142.6],
  [39.2, 141.8], [38.1, 141], [37.1, 140.1], [36.1, 139.1], [35.2, 138.1],
  [34.3, 137.1], [33.5, 136], [32.8, 134.9], [32.2, 133.8], [31.6, 132.6],
  [31.1, 131.4], [30.7, 130.1], [30.4, 128.9], [30.1, 127.6], [29.9, 126.3],
  [29.8, 125], [29.8, 123.7], [29.9, 122.4], [30.1, 121.1], [30.3, 119.8],
  [30.7, 118.5], [31.2, 117.2], [31.7, 115.9], [32.2, 114.6], [32.9, 113.3],
  [33.6, 112], [34.3, 110.8], [35, 109.5], [35.8, 108.3], [36.5, 107.1],
  [37.3, 105.8], [38, 104.6], [38.8, 103.4], [39.5, 102.2], [40.2, 101],
  [41, 99.9], [41.7, 98.7], [42.4, 97.5], [43.1, 96.4], [43.8, 95.2],
  [44.5, 94.1], [45.2, 92.9], [45.9, 91.8], [46.6, 90.6], [47.2, 89.5],
  [47.9, 88.3], [48.6, 87.2], [49.3, 86], [50, 84.8], [50.7, 83.7],
  [51.4, 82.5], [52.2, 81.3], [52.9, 80.2], [53.7, 79], [54.4, 77.8],
  [55.2, 76.6], [56, 75.4], [56.9, 74.2], [57.7, 73], [58.6, 71.8],
  [59.6, 70.6], [63.3, 65.8], [64, 63.9], [64.9, 40.9], [83, 40], [86, 43],
];

// Interior cutout (the mask ring's central hole). The dip at x 70..80 /
// y ~75..81 is the top-center tab that carries U1/U2.
export const MASK_HOLE = [
  [110.2, 124.7], [109.8, 122], [108.6, 119], [107.2, 116.1], [105.6, 113.3],
  [103.9, 110.5], [102.2, 107.8], [100.6, 105], [98.9, 102.2], [97.3, 99.4],
  [95.6, 96.6], [93.9, 93.9], [92.2, 91.1], [90.5, 88.4], [88.8, 85.7],
  [87, 83], [85.1, 80.3], [83.2, 77.7], [81.3, 75.1], [80, 79.4],
  [80, 79.7], [79.9, 79.9], [79.7, 80.2], [79.5, 80.4], [79.3, 80.5],
  [79, 80.7], [78.4, 80.9], [77.6, 81.1], [76.8, 81.2], [76, 81.3],
  [75.1, 81.4], [74.3, 81.4], [73.5, 81.3], [72.7, 81.2], [71.9, 81],
  [71.1, 80.7], [70.8, 80.6], [70.5, 80.4], [70.3, 80.2], [70.2, 80],
  [70.1, 79.7], [70, 79.5], [68.7, 75.1], [66.7, 77.7], [64.8, 80.3],
  [63, 83], [61.2, 85.7], [59.5, 88.4], [57.9, 91.2], [56.2, 94],
  [54.5, 96.7], [52.9, 99.5], [51.2, 102.3], [49.5, 105], [47.8, 107.8],
  [46.1, 110.6], [44.4, 113.3], [42.8, 116.1], [41.2, 119], [40.1, 122],
  [39.8, 124.6], [40.5, 127.8], [42, 130.7], [44.2, 133], [46.9, 134.7],
  [50, 135.9], [53.1, 136.6], [56.3, 137.2], [59.5, 137.7], [62.7, 138.1],
  [65.9, 138.5], [69.1, 138.7], [72.4, 138.9], [75.6, 139], [78.8, 139],
  [82.1, 138.9], [85.3, 138.6], [88.5, 138.2], [91.7, 137.7], [94.9, 137],
  [98, 136.2], [101.1, 135.2], [104, 133.9], [106.8, 132.2], [109, 129.9],
  [110.1, 126.8],
];

const toPath = (poly) =>
  `M ${poly.map(p => p.join(' ')).join(' L ')} Z`;

// Outer + hole as one even-odd path: fill/clip covers the ring only,
// and a stroke draws both edges.
export const MASK_PATH_D = `${toPath(MASK_OUTLINE)} ${toPath(MASK_HOLE)}`;

export const MASK_VIEWBOX = { x: 28.5, y: 38.5, w: 93, h: 112 };

// Footprint centers (mm), keyed by the portal's DISPLAYED indices.
export const BARO_POS = {   // MS5611 contact pressure, keys match p1..p4
  1: { x: 75, y: 67 },      // U1 (mux ch1, top-center tab)
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
  1: { x: 75, y: 77 },      // U2  (mux ch1, top-center tab)
  2: { x: 47, y: 100 },     // U9  (mux ch0)
  3: { x: 80, y: 144 },     // U10 (mux ch2)
  4: { x: 95, y: 86 },      // U8  (mux ch3)
};

// ---- anatomical regions (A-D) ----
// The ring is divided into four named zones matching where the mask
// contacts the face: the top tab/apex (nasal bridge), the two descending
// arms (left / right), and the bottom arc (chin). Sensor positions are
// untouched — this is an overlay. Thresholds chosen so every current
// sensor lands in its anatomically sensible zone:
//   A: p1 (75,67)          B: p2, sht1, tmp1      C: p4, sht3, tmp3
//   D: p3, sht2, tmp2
export const REGIONS = [
  { id: 'A', name: 'Nasal bridge', label: { x: 75, y: 58 } },
  { id: 'B', name: 'Left',         label: { x: 35.5, y: 119 } },
  { id: 'C', name: 'Right',        label: { x: 114.5, y: 119 } },
  { id: 'D', name: 'Chin',         label: { x: 83, y: 145.5 } },
];

export const regionOf = (x, y) => {
  if (y < 84 && x >= 64 && x <= 86) return 'A'; // strap + tab + apex
  if (y > 135) return 'D';                      // bottom arc
  return x < 75 ? 'B' : 'C';                    // the two arms
};

// Boundary segments between regions; drawn clipped to the ring, so the
// parts crossing the central cutout simply vanish.
export const REGION_DIVIDERS = [
  [[64, 38.5], [64, 84]],     // A | B
  [[86, 38.5], [86, 84]],     // A | C
  [[64, 84], [86, 84]],       // A underside (mostly inside the cutout)
  [[28.5, 135], [121.5, 135]], // B|D and C|D across both arms
];

// ---- heatmap grid: cell centers on the ring, precomputed once ----

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

const onRing = (x, y) =>
  pointInPoly(x, y, MASK_OUTLINE) && !pointInPoly(x, y, MASK_HOLE);

export const GRID_STEP = 2.5; // mm per heatmap cell

export const MASK_CELLS = (() => {
  const cells = [];
  const { x, y, w, h } = MASK_VIEWBOX;
  const half = GRID_STEP / 2;
  for (let cy = y + half; cy < y + h; cy += GRID_STEP) {
    for (let cx = x + half; cx < x + w; cx += GRID_STEP) {
      // Keep the cell if its center OR any corner lands on the ring —
      // boundary cells then overdraw and the SVG even-odd clip trims
      // them, so the field meets both edges without stair-step notches.
      const inside =
        onRing(cx, cy) ||
        onRing(cx - half, cy - half) ||
        onRing(cx + half, cy - half) ||
        onRing(cx - half, cy + half) ||
        onRing(cx + half, cy + half);
      if (inside) cells.push([cx, cy]);
    }
  }
  return cells;
})();
