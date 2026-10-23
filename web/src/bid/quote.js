// The tariff a bidder quotes against the tariff the financial model needs: the equity and project
// IRR the quote actually earns on the sized plant, and how far it falls from the target. Shared by
// the Tender to Bid and SECI RTC tabs (Financials, the bid forms, the voice agent); plain JavaScript,
// checked in Node by tools/check_seci.mjs.
import * as E from "../rtc/engine.js";
import { modelInputs, opsFromLp } from "./model.js";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/** Tolerance on the comparison: the quote is two decimals, the model tariff is not. */
const ROUNDING = 0.005;

/**
 * Returns null without a sized plant or a quote; otherwise
 * { tariff, targetTariff, targetEquityIrr, equityIrr, projectIrr, targetProjectIrr, gap, gapPct,
 *   status: "ok" | "below" | "loss", message }.
 * equityIrr / projectIrr are NaN when the cash flows never pay back (no IRR exists).
 */
export function quotedReturns(state, terms, tariff) {
  if (!state?.lp || !isNum(tariff) || tariff <= 0) return null;
  const { costs, fin, bess } = modelInputs(state, terms);
  const annual = terms?.rules?.find((r) => r.id === "annual")?.target ?? 0;
  const ops = opsFromLp(state.lp, fin, bess);
  const run = (locked, t) => E.runFinancialModel(null, state.lp.sizes, { costs, fin: { ...fin, tariff: t }, bess, dfrTarget: annual, tariffLocked: locked, ops, solveBy: "npv" });
  const target = run(false, fin.tariff);
  const quoted = run(true, tariff);
  const gap = tariff - target.tariff;
  const status = gap >= -ROUNDING ? "ok" : !isNum(quoted.equityIrr) || quoted.equityIrr <= 0 ? "loss" : "below";
  const pct = (v) => (isNum(v) ? `${(v * 100).toFixed(1)}%` : "no IRR (the equity is never paid back)");
  const message = status === "ok"
    ? `At ₹${tariff.toFixed(2)}/kWh the equity IRR is ${pct(quoted.equityIrr)} (target ${pct(fin.targetEquityIrr)}), project IRR ${pct(quoted.projectIrr)}.`
    : `₹${tariff.toFixed(2)}/kWh is ₹${(-gap).toFixed(3)} below the ₹${target.tariff.toFixed(3)}/kWh your ${pct(fin.targetEquityIrr)} target equity IRR needs. At this tariff the equity IRR is ${pct(quoted.equityIrr)} and the project IRR ${pct(quoted.projectIrr)}.`;
  return {
    tariff,
    targetTariff: target.tariff,
    targetEquityIrr: fin.targetEquityIrr,
    equityIrr: quoted.equityIrr,
    projectIrr: quoted.projectIrr,
    targetProjectIrr: target.projectIrr,
    minDscr: quoted.minDscr,
    gap,
    gapPct: gap / target.tariff,
    status,
    message,
  };
}
