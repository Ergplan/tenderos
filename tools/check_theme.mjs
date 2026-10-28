// Checks for day mode's chart colours (web/src/themeColors.js) and the hour Sankey in each mode.
// Run from the repository root:
//   node tools/check_theme.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chartColor, chartColors } from "../web/src/themeColors.js";
import { hourSankeyHtml } from "../web/src/bid/hourSankey.js";
import { PRE_PAINT, THEME_KEY } from "../web/src/themeScript.js";

// night is untouched
const night = { color: ["#d4ff3f"], series: [{ itemStyle: { color: "#f4f4f1" } }] };
assert.equal(chartColors(night, "dark"), night, "night options are passed through as they are");
assert.equal(chartColor("#d4ff3f", "dark"), "#d4ff3f");

// day: ink and greys flip, the lime signal turns olive, data hues darken, unknown colours stay
assert.equal(chartColor("#f4f4f1", "light"), "#141414");
assert.equal(chartColor("#D4FF3F", "light"), "#5e7d00", "hex case does not matter");
assert.equal(chartColor("#1f1f1f", "light"), "#e8e8e2", "grid lines become light");
assert.equal(chartColor("#fde725", "light"), "#fde725", "the viridis scale is kept");
assert.equal(chartColor("rgba(255,255,255,0.06)", "light"), "rgba(0,0,0,0.084)", "white hairlines become black ones");
assert.equal(chartColor("rgba(14,14,14,0.42)", "light"), "rgba(255,255,255,0.72)", "dark glass becomes light glass");
assert.equal(chartColor("rgba(212, 255, 63, 0.08)", "light"), "rgba(94,125,0,0.08)", "signal washes keep their alpha");
assert.equal(chartColor("rgba(253,231,37,0.5)", "light"), "rgba(253,231,37,0.5)");
assert.equal(chartColor("#0a0a0a", "light"), "#0a0a0a", "dark labels on bright cells stay dark");
assert.equal(chartColor("#0a0a0a", "light", "borderColor"), "#fafaf7", "a near-black cell border becomes the page");

// a whole option: colours under colour keys only; names, data, formatters untouched
const fmt = (p) => p;
const day = chartColors({
  color: ["#5ab4e8", "#fde725"],
  tooltip: { backgroundColor: "rgba(14,14,14,0.42)", formatter: fmt, textStyle: { color: "#f4f4f1" } },
  xAxis: { data: ["#f4f4f1", "Jan"], splitLine: { lineStyle: { color: "rgba(255,255,255,0.06)" } } },
  series: [{ name: "#d4ff3f", data: [1, 2], itemStyle: { color: "#3a3a3a", borderColor: "#0a0a0a" }, label: { color: "#0a0a0a" }, markArea: { itemStyle: { color: "rgba(212,255,63,0.07)" } } }],
}, "light");
assert.deepEqual(day.color, ["#1f86c7", "#fde725"]);
assert.equal(day.tooltip.backgroundColor, "rgba(255,255,255,0.72)");
assert.equal(day.tooltip.formatter, fmt, "functions are kept");
assert.equal(day.tooltip.textStyle.color, "#141414");
assert.deepEqual(day.xAxis.data, ["#f4f4f1", "Jan"], "category names are not colours");
assert.equal(day.xAxis.splitLine.lineStyle.color, "rgba(0,0,0,0.084)");
assert.equal(day.series[0].name, "#d4ff3f", "series names are not colours");
assert.equal(day.series[0].itemStyle.color, "#c8c8c0");
assert.equal(day.series[0].itemStyle.borderColor, "#fafaf7");
assert.equal(day.series[0].label.color, "#0a0a0a");
assert.equal(day.series[0].markArea.itemStyle.color, "rgba(94,125,0,0.07)");

// the hour Sankey: night draws light type with a dark halo, day the other way round
const hr = {
  solar: [300], wind: [200], discharge: [50], export: [0], charge: [40], curtail: [10], evacLoss: [5],
  direct: [450], demand: [500], contracted: [500], soc: [0.5],
};
const opts = { gens: ["solar", "wind"], titles: { solar: "Solar", wind: "Wind" }, colors: { solar: "#f5b83d", wind: "#5ab4e8", bess: "#a98bff" }, rules: [], peakHour: () => true, label: "Jan 10h" };
const n = hourSankeyHtml(hr, 0, opts);
const d = hourSankeyHtml(hr, 0, { ...opts, mode: "light" });
assert.ok(/fill:#f4f4f1/.test(n) && /rgba\(10,10,10,0\.55\)/.test(n), "night: light type, dark halo");
assert.ok(/fill:#141414/.test(d) && /rgba\(255,255,255,0\.75\)/.test(d), "day: dark type, light halo");
assert.ok(n.includes('fill="#f5b83d"') && d.includes('fill="#d4930c"'), "source colours follow the mode");

// the pre-paint script: only "light" switches to day; anything else is night
for (const [stored, want] of [["light", "light"], ["dark", "dark"], [null, "dark"], ["blue", "dark"]]) {
  const el = { dataset: {}, style: {} };
  const ls = { getItem: (k) => (k === THEME_KEY ? stored : null) };
  new Function("localStorage", "document", PRE_PAINT)(ls, { documentElement: el });
  assert.equal(el.dataset.theme, want, `stored ${stored}`);
  assert.equal(el.style.colorScheme, want);
}
assert.doesNotThrow(() => new Function("localStorage", "document", PRE_PAINT)({ getItem() { throw new Error("blocked"); } }, {}), "blocked storage is ignored");

// every stylesheet colour token night defines, day defines too
const css = readFileSync(new URL("../web/src/styles.css", import.meta.url), "utf8");
const block = (sel) => css.slice(css.indexOf(sel), css.indexOf("}", css.indexOf(sel)));
const names = (b) => new Set([...b.matchAll(/(--[a-z0-9-]+):/g)].map((m) => m[1]));
const nightTokens = names(block(":root, .theatre {"));
const dayTokens = names(block(':root[data-theme="light"] {'));
const missing = [...nightTokens].filter((t) => !dayTokens.has(t));
assert.deepEqual(missing, [], "day mode defines every night token");
assert.ok(nightTokens.size > 40);

console.log("theme checks passed");
