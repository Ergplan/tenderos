// Checks for the Live model sheet of the bid workbook (web/lib/liveModel.js): the formulas
// rebuild the app's financial model (web/src/rtc/engine.js) year by year. Three bids that between
// them use every branch: all six sources with a flat market price, WDV tax and annual battery
// augmentation; separate sites with hourly market revenue, annuity repayment, straight-line tax,
// a one-time augmentation, tariff escalation, a shortfall penalty and tax losses; solar alone
// with no debt.
//   1. the values the sheet carries match the app's rows and results;
//   2. LibreOffice recalculates every formula to the value the cell carries, with no error;
//   3. change an input (the tariff, a capex) and the recalculated returns match the app run on
//      the changed input: the sheet is live, not a picture.
// Step 2 and 3 need LibreOffice (soffice); without it they are reported as not run.
// Run from the repository root:   node tools/check_live_model.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import * as E from "../web/src/rtc/engine.js";
import { defaultBidState, modelInputs, opsFromLp } from "../web/src/bid/model.js";
import { liveModelRequest } from "../web/src/bid/liveModelRequest.js";
import { LIVE_SHEET, addLiveModel, liveModelInput } from "../web/lib/liveModel.js";

const require = createRequire(new URL("../web/package.json", import.meta.url));
const ExcelJS = require("exceljs");

const close = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

// ---- three bids
function bid({ sources, src = {}, fin = {}, market, sites, years = 25, lifetime, sizes, tariffLocked = false, tariff }) {
  const s = defaultBidState();
  s.bid = { baseMw: 1000, greenshoe: false };
  s.sources = { solar: false, wind: false, hydro: false, biomass: false, thermal: false, bess: false, ...sources };
  s.src.solar = { capacity: { mode: "optimise", mw: 8000 }, cuf: 0.26, dcAc: 1.4, degradation: 0.005, capex: 3.6, om: 4 };
  s.src.wind = { capacity: { mode: "optimise", mw: 4000 }, cuf: 0.35, capex: 6.8, om: 9 };
  s.src.hydro = { capacity: { mode: "fixed", mw: 300 }, cuf: 0.45, availability: 1, capex: 0.5, fixed: 150, energy: 1.2, escalation: 0.02, monthlyCuf: null };
  s.src.biomass = { capacity: { mode: "optimise", mw: 500 }, availability: 0.9, cuf: 0.8, minLoad: 0.3, ramp: 0.005, capex: 7, om: 35, fuel: 4, fuelEscalation: 0.04 };
  s.src.thermal = { capacity: { mode: "optimise", mw: 800 }, availability: 0.85, cuf: 0.85, minLoad: 0, ramp: 0.01, capex: 0, fixed: 120, energy: 3, rec: 0.15, escalation: 0.03 };
  s.src.bess = { capacity: { mode: "optimise", mw: 3000 }, duration: "4", rte: 0.87, minSoc: 0.05, maxSoc: 0.95, degradation: 0.02, augmentation: "annual", capex: 1.2, om: 1.2 };
  for (const [id, v] of Object.entries(src)) s.src[id] = { ...s.src[id], ...v };
  s.fin = { ...s.fin, targetEquityIrr: 0.14, debtFraction: 0.7, interestRate: 0.09, tenorYears: 15, taxRate: 0.2517, omEscalation: 0.05, insurancePct: 0.003, tariffEscalation: 0, ...fin };
  s.costs = { preopPct: 0.05, evacuationCr: 120 };
  s.market = market || { sell: false, source: "flat", escalation: 0, flatPrice: 0 };
  if (sites) s.sites = sites;
  if (tariffLocked) { s.tariffLocked = true; s.fin.tariff = tariff; }
  const terms = { years, sale: "allowed" };
  const m = modelInputs(s, terms);
  const lp = { sizes, tariff: 5, perYear: [{ year: 1, minMonthlyDfr: 0.7 }], lifetime, ...(sites?.split ? { sites: { split: true } } : {}), ...(market?.source && market.source !== "flat" ? { market: market.source } : {}) };
  const ops = opsFromLp(lp, m.fin, m.bess);
  const dfrTarget = 0.8;
  const run = (over = {}) => E.runFinancialModel(null, over.sizes || sizes, { costs: over.costs || m.costs, fin: over.fin || m.fin, bess: m.bess, dfrTarget, tariffLocked: over.tariffLocked ?? tariffLocked, ops, solveBy: "npv" });
  const finance = run();
  const req = liveModelRequest({ state: s, lp, finance, costs: m.costs, fin: m.fin, bess: m.bess, ops, dfrTarget });
  return { name: "", s, m, lp, ops, finance, req, run, dfrTarget };
}

const yearsOf = (n, f) => Array.from({ length: n }, (_, i) => ({ year: i + 1, ...f(i + 1) }));
const CASES = [
  ["six sources, flat market sale, WDV, annual augmentation", bid({
    sources: { solar: true, wind: true, hydro: true, biomass: true, thermal: true, bess: true },
    market: { sell: true, source: "flat", escalation: 0, flatPrice: 2.5 },
    sizes: { solarMw: 4000, windMw: 1200, bessMw: 900, bessMwh: 3600, biomassMw: 200, hydroMw: 300, thermalMw: 300 },
    lifetime: yearsOf(25, (y) => ({ demandMwh: 1000 * 8760, deliveredMwh: (0.86 - 0.002 * y) * 1000 * 8760, exportMwh: 1e6 - 1e4 * y, biomassMwh: 1.2e6, hydroMwh: 1.1e6, thermalMwh: 0.9e6 })),
  })],
  ["separate sites, hourly IEX, annuity, SLM, one-time augmentation, escalation, penalty, tax losses", bid({
    sources: { solar: true, wind: true, bess: true },
    src: { bess: { augmentation: "annual" } },
    fin: { tariffEscalation: 0.01, repayment: "annuity", taxDepreciation: "slm", shortfallPenalty: 2, tenorYears: 18 },
    market: { sell: true, source: "DAM", escalation: 0, flatPrice: 0 },
    sites: { split: true, chargeRsPerKwh: 0.45, lossPct: 0.03 },
    sizes: { solarMw: 2600, windMw: 900, bessMw: 700, bessMwh: 2800, bessSolarSiteMw: 500, bessSolarSiteMwh: 2000, bessWindSiteMw: 200, bessWindSiteMwh: 800 },
    lifetime: yearsOf(25, (y) => ({ demandMwh: 1000 * 8760, deliveredMwh: (y % 5 === 0 ? 0.76 : 0.83) * 1000 * 8760, exportMwh: 6e5, exportRevenueCr: 6e5 * (3.1 + 0.02 * y) * 1e-4, wheeledMwh: 2e5 })),
    tariffLocked: true, tariff: 2.6,
  })],
  ["solar alone, no debt", bid({
    sources: { solar: true },
    fin: { debtFraction: 0, tenorYears: 10 },
    sizes: { solarMw: 3000, windMw: 0, bessMw: 0, bessMwh: 0 },
    years: 20,
    lifetime: yearsOf(20, () => ({ demandMwh: 1000 * 8760, deliveredMwh: 0.25 * 1000 * 8760, exportMwh: 0 })),
  })],
];
// the second bid uses a one-time augmentation in year 10, with the battery price falling 3% a year
{
  const c = CASES[1][1];
  const bess = { ...c.m.bess, augmentation: "oneTime", augmentationYear: 10, costDeclinePct: 0.03 };
  c.finance = E.runFinancialModel(null, c.lp.sizes, { costs: c.m.costs, fin: c.m.fin, bess, dfrTarget: c.dfrTarget, tariffLocked: true, ops: c.ops, solveBy: "npv" });
  c.req = { ...liveModelRequest({ state: c.s, lp: c.lp, finance: c.finance, costs: c.m.costs, fin: c.m.fin, bess, ops: c.ops, dfrTarget: c.dfrTarget }) };
  c.run = (over = {}) => E.runFinancialModel(null, c.lp.sizes, { costs: over.costs || c.m.costs, fin: over.fin || c.m.fin, bess, dfrTarget: c.dfrTarget, tariffLocked: over.tariffLocked ?? true, ops: c.ops, solveBy: "npv" });
}

// the sheet's rows that are the app's rows
const SAME = {
  ppaRev: "energyRevenue", mktRev: "surplusRevenue", penaltyCr: "penalty", revenue: "revenue", opex: "opex", ebitda: "ebitda", aug: "augCapex",
  bookDep: "bookDep", openDebt: "openingDebt", interest: "interest", principal: "principal", closeDebt: "closingDebt", taxDep: "taxDep",
  pbt: "pbt", tax: "tax", pat: "pat", recv: "receivables", dWc: "dWc", cfads: "cfads", debtService: "debtService", dscr: "dscr",
  fcfe: "fcfe", cumEq: "cumEquity", projCf: "projectCf", trf: "tariff", delivered: "deliveredMu", demand: "demandMu", excess: "excessMu", dfr: "dfr",
};
const RESULTS = ["tariff", "equityIrr", "projectIrr", "equityNpv", "projectNpv", "minDscr", "avgDscr", "lcoe", "levelisedTariff", "capexTotal", "debt", "equity", "revenueTotal"];

// bare: every formula without its value, so LibreOffice must work each one out
async function build(c, { bare = false } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.calcProperties = { fullCalcOnLoad: true };
  const input = liveModelInput(JSON.parse(JSON.stringify(c.req)));
  const live = addLiveModel(wb, { ...input, title: "Check" });
  if (bare) {
    wb.getWorksheet(LIVE_SHEET).eachRow((row) => row.eachCell((cell) => {
      if (cell.formula) cell._value.model.result = undefined;
    }));
  }
  return { wb, live, buffer: Buffer.from(await wb.xlsx.writeBuffer()) };
}

// ---- 1. the values the sheet carries are the app's
for (const [name, c] of CASES) {
  const { live } = await build(c);
  for (const [key, appKey] of Object.entries(SAME)) {
    for (const row of c.finance.rows) {
      const a = live.rows[key][row.year];
      const b = row[appKey];
      if (b === null || b === undefined) { assert.equal(a, "", `${name}: ${key} y${row.year} is blank where the app has none`); continue; }
      assert.ok(close(a, b, 1e-9), `${name}: ${key} year ${row.year}: sheet ${a}, app ${b}`);
    }
  }
  for (const key of RESULTS) {
    const app = c.req.app[key];
    if (app === null || app === undefined) continue;
    assert.ok(close(live.values[key], app, key.endsWith("Irr") ? 1e-6 : 1e-9), `${name}: ${key}: sheet ${live.values[key]}, app ${app}`);
  }
  assert.equal(live.values.payback, c.finance.payback ?? "beyond the term", `${name}: payback`);
  assert.equal(live.values.checks, "OK");
  console.log(`ok   values  ${name}: tariff ₹${c.finance.tariff.toFixed(4)}/kWh, equity IRR ${(c.finance.equityIrr * 100).toFixed(3)}%`);
}
// the branches each bid was meant to reach
assert.ok(CASES[0][1].finance.rows.some((r) => r.augCapex > 0) && CASES[0][1].finance.rows[1].augCapex > 0, "annual augmentation");
assert.ok(CASES[1][1].finance.rows.filter((r) => r.augCapex > 0).map((r) => r.year).join() === "10", "one-time augmentation in year 10");
assert.ok(CASES[1][1].finance.rows.some((r) => r.penalty > 0), "a shortfall penalty");
assert.ok(CASES[1][1].finance.rows[0].tax === 0 && CASES[1][1].finance.rows.some((r) => r.tax > 0), "tax losses carried, then tax");
assert.ok(CASES[1][1].finance.rows[0].wheeling > 0 && CASES[1][1].finance.rows[0].surplusRevenue > 0);
assert.ok(CASES[2][1].finance.rows.every((r) => r.dscr === null), "no debt: no DSCR");

// ---- 2 and 3: LibreOffice
let soffice = null;
for (const bin of ["soffice", "libreoffice"]) {
  try { execFileSync("which", [bin], { stdio: "pipe" }); soffice = bin; break; } catch { /* next */ }
}
if (!soffice) {
  console.log("NOT RUN  LibreOffice recalculation: soffice not found (install LibreOffice to run steps 2 and 3)");
  process.exit(0);
}

async function recalc(buffer) {
  const dir = mkdtempSync(path.join(tmpdir(), "live-model-"));
  try {
    const src = path.join(dir, "in.xlsx");
    writeFileSync(src, buffer);
    // a LibreOffice profile that recalculates every formula when an xlsx is opened
    mkdirSync(path.join(dir, "profile", "user"), { recursive: true });
    writeFileSync(path.join(dir, "profile", "user", "registrymodifications.xcu"), `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="OOXMLRecalcMode" oor:op="fuse"><value>0</value></prop></item>
</oor:items>
`);
    execFileSync(soffice, [`-env:UserInstallation=file://${path.join(dir, "profile")}`, "--headless", "--calc", "--convert-to", "xlsx", "--outdir", path.join(dir, "out"), src], {
      stdio: "pipe", timeout: 180_000, env: { ...process.env, HOME: dir },
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(readFileSync(path.join(dir, "out", "in.xlsx")));
    return wb.getWorksheet(LIVE_SHEET);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// cell.result, not cell.value.result: exceljs's value drops a result of 0 or ""
const resultOf = (cell) => (cell.formula ? cell.result : cell.value);
const numberAt = (ws, addr) => {
  const v = resultOf(ws.getCell(addr.replace(/^'[^']+'!/, "").replace(/\$/g, "")));
  return typeof v === "object" && v !== null && "error" in v ? v.error : v;
};

for (const [name, c] of CASES) {
  const { wb, live } = await build(c);
  const mine = wb.getWorksheet(LIVE_SHEET);
  const ws = await recalc((await build(c, { bare: true })).buffer);
  let formulas = 0;
  mine.eachRow((row) => row.eachCell((cell) => {
    const v = cell.value;
    if (!v || typeof v !== "object" || !("formula" in v)) return;
    formulas += 1;
    const got = resultOf(ws.getCell(cell.address));
    assert.ok(!(got && typeof got === "object" && "error" in got), `${name}: ${cell.address} ${v.formula} → ${JSON.stringify(got)}`);
    const want = cell.result;
    if (typeof want === "number") {
      assert.ok(typeof got === "number" && close(got, want, cell.address.startsWith("C") && /IRR/.test(v.formula) ? 1e-6 : 1e-7),
        `${name}: ${cell.address} ${v.formula}: LibreOffice ${got}, carried ${want}`);
    } else if (want !== undefined) {
      assert.equal(got ?? "", want, `${name}: ${cell.address} ${v.formula}`);
    }
  }));
  for (const key of RESULTS) {
    const app = c.req.app[key];
    if (typeof app !== "number") continue;
    assert.ok(close(numberAt(ws, live.cells[key]), app, key.endsWith("Irr") ? 1e-6 : 1e-7), `${name}: ${key} recalculated: ${JSON.stringify(numberAt(ws, live.cells[key]))} vs ${app} at ${live.cells[key]}`);
  }
  console.log(`ok   recalc  ${name}: ${formulas} formulas: LibreOffice works each one out, from no value, to the value the cell carries`);
}

// a changed input moves the whole model: tariff + ₹0.25/kWh on the first bid, battery capex
// − 20% on the second; the recalculated returns are the app's on the same inputs
{
  const [name, c] = CASES[0];
  const newTariff = c.finance.tariff + 0.25;
  const { live, buffer } = await build(c);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws0 = wb.getWorksheet(LIVE_SHEET);
  // the tariff input cell (the key result row links to it)
  const tariffInput = ws0.getCell(live.cells.tariff.split("!")[1].replace(/\$/g, "")).value.formula.replace(/\$/g, "");
  ws0.getCell(tariffInput).value = newTariff;
  const ws = await recalc(Buffer.from(await wb.xlsx.writeBuffer()));
  const app = c.run({ fin: { ...c.m.fin, tariff: newTariff }, tariffLocked: true });
  for (const [key, want] of [["equityIrr", app.equityIrr], ["projectIrr", app.projectIrr], ["minDscr", app.minDscr], ["equityNpv", app.equityNpv], ["revenueTotal", app.totals.revenue]]) {
    assert.ok(close(numberAt(ws, live.cells[key]), want, 1e-6), `${name}, tariff +0.25: ${key} ${numberAt(ws, live.cells[key])} vs app ${want}`);
  }
  assert.equal(numberAt(ws, live.cells.checks), "OK");
  console.log(`ok   live    tariff ₹${newTariff.toFixed(3)}: equity IRR ${(app.equityIrr * 100).toFixed(3)}% in LibreOffice and in the app`);
}
{
  const [name, c] = CASES[1];
  const { live, buffer } = await build(c);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws0 = wb.getWorksheet(LIVE_SHEET);
  let capexCell = null;
  ws0.eachRow((row) => { if (row.getCell(1).value === "Battery energy" && row.getCell(2).value === "₹ cr/MWh") capexCell = row.getCell(3); });
  assert.ok(capexCell, "battery capex input");
  const newCapex = capexCell.value * 0.8;
  capexCell.value = newCapex;
  const ws = await recalc(Buffer.from(await wb.xlsx.writeBuffer()));
  const app = c.run({ costs: { ...c.m.costs, bessCrPerMwh: newCapex } });
  for (const [key, want] of [["capexTotal", app.capex.total], ["equityIrr", app.equityIrr], ["projectIrr", app.projectIrr], ["lcoe", app.lcoe], ["avgDscr", app.avgDscr]]) {
    assert.ok(close(numberAt(ws, live.cells[key]), want, 1e-6), `${name}, battery capex −20%: ${key} ${numberAt(ws, live.cells[key])} vs app ${want}`);
  }
  console.log(`ok   live    battery ₹${newCapex.toFixed(2)} cr/MWh: project cost ₹${app.capex.total.toFixed(1)} cr, equity IRR ${(app.equityIrr * 100).toFixed(3)}% in LibreOffice and in the app`);
}
console.log("live model checks passed");
