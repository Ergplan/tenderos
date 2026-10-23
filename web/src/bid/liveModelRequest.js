// Tender to Bid: the request for the workbook's Live model sheet (web/lib/liveModel.js), which
// rebuilds the financial model as Excel formulas. Kept apart from exportModel.js so the check
// (tools/check_live_model.mjs) can build it in Node.
import { FINANCE_FIELDS, SOURCES, SOURCE_FIELDS } from "./model.js";
import { LIVE_FIN_KEYS, liveResults } from "../rtc/exportModel.js";

/**
 * What the Live model sheet (web/lib/liveModel.js) needs to rebuild the financial model as Excel
 * formulas: the inputs, the optimiser's energy by year and the app's results to compare with.
 */
export function liveModelRequest({ state, lp, finance, costs, fin, bess, ops, dfrTarget, sourceOf = () => "Your input" }) {
  const n = finance.rows.length;
  const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o?.[k]]));
  const sources = {};
  for (const s of SOURCES) for (const f of SOURCE_FIELDS[s.id]) sources[`${s.id}.${f.key}`] = sourceOf(`${s.id}.${f.key}`);
  for (const f of FINANCE_FIELDS) sources[`${f.section}.${f.key}`] = sourceOf(`${f.section}.${f.key}`);
  sources["market.sell"] = sourceOf("market.sell");
  return {
    tariff: finance.tariff,
    tariffLocked: finance.tariffLocked,
    dfrTarget: dfrTarget || 0,
    split: Boolean(lp.sites?.split),
    market: lp.market || null,
    on: Object.fromEntries(SOURCES.map((s) => [s.id, Boolean(state.sources[s.id])])),
    sizes: pick(lp.sizes, ["solarMw", "windMw", "bessMw", "bessMwh", "biomassMw", "hydroMw", "thermalMw"]),
    costs: {
      ...pick(costs, ["solarCrPerMw", "windCrPerMw", "bessCrPerMwh", "bessPcsCrPerMw", "biomassCrPerMw", "evacuationCr", "preopPct"]),
      plants: (costs.plants || []).map((p) => pick(p, ["id", "capexCrPerMw", "fixedLakhPerMw", "energyRsPerKwh", "recRsPerKwh", "escalation"])),
    },
    fin: pick(fin, LIVE_FIN_KEYS),
    bess: pick(bess, ["annualDegradation", "augmentation", "augmentationYear", "costDeclinePct"]),
    ops: ops.slice(0, n).map((o) => pick(o, ["demandMWh", "deliveredMWh", "excessMWh", "surplusRevenueCr", "biomassMWh", "hydroMWh", "thermalMWh", "blockShortfallMWh"])),
    sources,
    app: liveResults(finance, fin),
  };
}
