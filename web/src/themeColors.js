// Night colour -> day colour for everything drawn outside CSS (ECharts options, the hour Sankey's
// SVG). Plain JavaScript with no imports, so the Node checks can load it.

// Ink and greys flip; data colours keep their hue but get darker so
// lines and labels read on a white page; the lime signal becomes olive.
const DAY = {
  "#f4f4f1": "#141414",
  "#ffffff": "#141414",
  "#d4ff3f": "#5e7d00",
  "#c2c2bc": "#45453f",
  "#86867f": "#6b6b64",
  "#6a6a64": "#8f8f88",
  "#6b6b66": "#8f8f88",
  "#4a4a4a": "#b4b4ac",
  "#3a3a3a": "#c8c8c0",
  "#333333": "#d4d4cc",
  "#2a2a2a": "#deded8",
  "#26262a": "#ecece7",
  "#1f1f1f": "#e8e8e2",
  "#181818": "#ffffff",
  "#151515": "#f2f2ed",
  "#121212": "#ffffff",
  "#3d4a12": "#d3e396",
  "#6b4f16": "#f0d595",
  "#1d4660": "#a9d2ee",
  "#f5b83d": "#d4930c",
  "#f2b84b": "#c98a12",
  "#5ab4e8": "#1f86c7",
  "#3fa7d6": "#1a7fb0",
  "#a98bff": "#7b5ce0",
  "#b79cff": "#7b5ce0",
  "#c9b8ff": "#7a5cff",
  "#7ddc9a": "#2e9a5a",
  "#6fcf97": "#2b9460",
  "#4fd1c5": "#14988b",
  "#ff6b5f": "#dc4437",
  "#ff8a5f": "#d9612f",
  "#e07b39": "#c4621f",
  "#8d8d99": "#8d8d99",
  "#7a8cff": "#4f63e0",
};
const DAY_RGB = Object.fromEntries(Object.entries(DAY).map(([k, v]) => [hexRgb(k).join(","), hexRgb(v)]));

function hexRgb(hex) {
  const h = hex.slice(1);
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** One colour for a mode. Unknown colours (the viridis scale, paper whites) are kept. */
export function chartColor(value, mode, key = "") {
  if (mode !== "light" || typeof value !== "string") return value;
  const v = value.trim();
  if (v[0] === "#") {
    // dark label text on bright cells stays dark; a near-black cell border becomes the page
    if (v.toLowerCase() === "#0a0a0a" || v.toLowerCase() === "#0b0b0b") return key === "borderColor" ? "#fafaf7" : v;
    return DAY[v.toLowerCase()] || v;
  }
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(v);
  if (!m) return v;
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const a = m[4] === undefined ? 1 : Number(m[4]);
  if (r >= 240 && g >= 240 && b >= 240) return `rgba(0,0,0,${round(Math.min(1, a * 1.4))})`; // white hairlines and washes
  if (r <= 24 && g <= 24 && b <= 24) return `rgba(255,255,255,${round(Math.min(0.96, a + 0.3))})`; // dark glass
  const day = DAY_RGB[`${r},${g},${b}`];
  return day ? `rgba(${day.join(",")},${a})` : v;
}

const round = (x) => Math.round(x * 1000) / 1000;
const COLOR_KEY = /colou?r|background|fill|stroke|border/i;

/** A chart option (ECharts or the hour Sankey's) with every colour mapped to the mode. */
export function chartColors(option, mode, key = "") {
  if (mode !== "light" || option == null) return option;
  if (typeof option === "string") return COLOR_KEY.test(key) || key === "" ? chartColor(option, mode, key) : option;
  if (Array.isArray(option)) return option.map((x) => chartColors(x, mode, key));
  if (typeof option !== "object" || option instanceof Date || ArrayBuffer.isView(option)) return option;
  if (Object.getPrototypeOf(option) !== Object.prototype) return option; // gradients, typed objects
  const out = {};
  for (const [k, v] of Object.entries(option)) {
    out[k] = typeof v === "string" ? (COLOR_KEY.test(k) ? chartColor(v, mode, k) : v) : chartColors(v, mode, COLOR_KEY.test(k) ? k : "_");
  }
  return out;
}
