// Checks for the SECI RTC tender tab (web/src/seci): the tender's terms and the HiGHS request they
// make, the dates and money at stake, the bid-form checks, and the bid agent's script and its
// understanding of spoken or typed answers. Run from the repository root:
//   node tools/check_seci.mjs
import assert from "node:assert/strict";
import * as E from "../web/src/rtc/engine.js";
import { BENCHMARKS, SOURCE_FIELDS, fillBenchmarks, lpPayload, missingInputs, modelInputs, resourceProfiles } from "../web/src/bid/model.js";
import { DEFAULT_SETTINGS, PACK, keyDates, moneyAtStake, prov, seciTerms } from "../web/src/seci/terms.js";
import { bidChecks, bidPackRequest, experienceTest, formIssues, parseExperience } from "../web/src/seci/forms.js";
import { buildScript, explainFinance, explainResults, financeOf, parseDate, parseNumber } from "../web/src/seci/voice.js";
import { defaultBidState } from "../web/src/bid/model.js";
import { quotedReturns } from "../web/src/bid/quote.js";
import { applies, blankValue, formatGroups, formatStatus, formatsForPack, formatsSummary } from "../web/src/seci/formats.js";

// ---- the terms: two time-block floors with the 1.5x penalty, peak hours as planned
const terms = seciTerms(DEFAULT_SETTINGS);
assert.deepEqual(terms.rules.map((r) => [r.id, r.basis, r.hours, r.target, r.penaltyMultiple]), [["peak", "block", "peak", 0.9, 1.5], ["offpeak", "block", "offpeak", 0.7, 1.5]]);
assert.deepEqual([terms.minBidMw, terms.maxBidMw, terms.baseMw, terms.partAllowed], [50, 500, 1000, true]);
assert.equal(terms.mandatory.bess, true, "storage is mandatory (Clarifications-01, query 13)");
assert.equal(terms.permitted.thermal, false, "RE only");
assert.equal(terms.sale, "allowed", "power above the contracted capacity may be sold (PSA 2.11.5)");
assert.equal(seciTerms({ ...DEFAULT_SETTINGS, shortfall: "hard" }).rules[0].penaltyMultiple, null, "meet every block: no penalty, a hard floor");
for (const [key, p] of Object.entries(terms.provenance)) if (p) assert.ok(p.located && (p.page || key === "years"), key);

// the request to HiGHS: block rules, the penalty, and the peak hours as planned
const state0 = { ...defaultBidState(), bid: { baseMw: 300, greenshoe: false }, sources: { solar: true, wind: true, hydro: false, biomass: false, thermal: false, bess: true } };
const filled = { ...fillBenchmarks(state0, terms), seci: { ...DEFAULT_SETTINGS }, forms: {} };
assert.deepEqual(missingInputs(filled, terms), [], "benchmarks complete the inputs");
const payload = lpPayload(filled, terms, resourceProfiles(filled));
assert.deepEqual(payload.compliance.map((c) => [c.id, c.basis, c.hours, c.target, c.penaltyMultiple]), [["peak", "block", "peak", 0.9, 1.5], ["offpeak", "block", "offpeak", 0.7, 1.5]]);
const peakHoursOf = (mask) => [...new Set(Array.from(mask).map((v, t) => (v ? E.HOUR_OF_DAY[t] : null)).filter((h) => h !== null))].sort((a, b) => a - b);
assert.deepEqual(peakHoursOf(payload.peakMask), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 18, 19, 20, 21, 22, 23], "any 6 of 18:00-10:00: all 16 hours held to 90%");
const evening = lpPayload(filled, seciTerms({ ...DEFAULT_SETTINGS, peakPlan: "evening" }), resourceProfiles(filled));
assert.deepEqual(peakHoursOf(evening.peakMask), [18, 19, 20, 21, 22, 23], "evening plan: 18:00-24:00");
assert.equal(payload.ctx.demand[0], 300, "round the clock at the contracted capacity");
assert.equal(modelInputs(filled, terms).fin.blockPenaltyMultiple, 1.5, "the financial model charges 1.5x tariff on the shortfall");
assert.equal(modelInputs(filled, seciTerms({ ...DEFAULT_SETTINGS, shortfall: "hard" })).fin.blockPenaltyMultiple, 0);

// ---- dates and money at stake (Amendment-02's own example: PPA 07.06.2026 -> SCSD 07.06.2028)
assert.deepEqual(keyDates("2026-06-07"), { ppa: "2026-06-07", financialClosure: "2027-12-07", scsd: "2028-06-07", latestStart: "2028-12-07" });
assert.equal(keyDates(null), null);
const money = moneyAtStake({ solarMw: 600, windMw: 400, bessMw: 400, bessMwh: 1600 });
assert.equal(money.emdRs, 968000 * 600 + 1368000 * 400 + 240000 * 1600);
assert.equal(money.pbgRs, 2420000 * 600 + 3420000 * 400 + 600000 * 1600);
assert.equal(money.netWorthRs, 9680000 * 600 + 13680000 * 400 + 2400000 * 1600);
assert.equal(prov("emd").quote, "EMD amount = Rs. [9,68,000 * S + 13,68,000 * W + 2,40,000 * E]");

// ---- bid forms: required fields, the checks, and the 34.3 experience test
const lp = {
  sizes: { solarMw: 600, windMw: 400, bessMw: 400, bessMwh: 1600 }, tariff: 5.1, lowerBound: 5.0,
  perYear: [{ year: 1, rules: [{ id: "peak", basis: "block", hoursMet: 0.97, shortfallMu: 3, met: false }, { id: "offpeak", basis: "block", hoursMet: 1, shortfallMu: 0, met: true }], blockShortfallMu: 3 }],
  lifetime: Array.from({ length: 25 }, (_, i) => ({ year: i + 1, demandMwh: 300 * 8760, deliveredMwh: 0.86 * 300 * 8760, exportMwh: 2e5, blockShortfallMwh: 3000 })),
};
const sized = { ...filled, lp, seci: { ...DEFAULT_SETTINGS, ppaDate: "2026-06-07" }, forms: {} };
assert.ok(formIssues(sized).includes("Bidder's name"));
assert.ok(formIssues({ ...sized, forms: { bidderType: "consortium" } }).includes("Lead member (consortium)"), "a consortium names its lead member");
const forms = { bidder: "Acme Renewables Ltd", bidderType: "company", address: "New Delhi", contact: "A. Kumar", email: "bids@acme.example", tariff: 5.12,
  substation: "Bhadla-III", substationScd: "2027-12-31", connectivity: "other", bessWith: "solar", netWorthCr: 2000, experience: "Plant A, 250 MW, 2023-04-01\nPlant B, 120 MW",
  signatory: "A. Kumar, Director", letterDate: "2026-05-20", place: "New Delhi", commonShareholding: "no", emdForm: "bg" };
const checks = Object.fromEntries(bidChecks({ ...sized, forms }).map((c) => [c.id, c]));
assert.equal(formIssues({ ...sized, forms }).length, 0);
assert.equal(checks.capacity.status, "ok");
assert.equal(checks.substation.status, "ok");
assert.equal(checks.undertaking.status, "warn", "another entity's connectivity needs the Annexure-I undertaking");
assert.equal(checks.networth.status, "ok", "Rs 2,000 cr covers the Rs 1,512 cr needed");
assert.equal(bidChecks({ ...sized, forms: { ...forms, netWorthCr: 1000 } }).find((c) => c.id === "networth").status, "bad");
assert.equal(bidChecks({ ...sized, forms: { ...forms, substationScd: "2028-07-01" } }).find((c) => c.id === "substation").status, "bad", "SCD after 30.06.2028");
assert.ok(checks.experience.status === "ok" && /one plant of at least 240 MW/.test(checks.experience.detail) && /Not used/.test(checks.experience.detail));
assert.deepEqual(parseExperience("Plant A, 250 MW, 2023-04-01\nPlant B, 120 MW").map((p) => [p.name, p.mw, p.date]), [["Plant A", 250, "2023-04-01"], ["Plant B", 120, null]]);
assert.equal(experienceTest([{ mw: 150 }, { mw: 150 }], 300).how, "two plants of at least 150 MW each");
assert.equal(experienceTest([{ mw: 130 }, { mw: 125 }, { mw: 120 }], 300).how, "three plants of at least 120 MW each");
assert.equal(experienceTest([{ mw: 100 }], 300).met, false);
const pack = bidPackRequest({ ...sized, forms });
assert.equal(pack.bid.contractedMw, 300);
assert.ok(Math.abs(pack.bid.emdCr - money.emdRs / 1e7) < 1e-9);
assert.ok(pack.checks.every((c) => c.source && /p\. \d+/.test(c.source)), "every check names its page");
assert.equal(pack.fields.find((f) => f.label === "Connectivity").value, "Another entity's connectivity");

// ---- the agent's script: numbers and dates as spoken, and every question reads and sets its input
const cases = [["three hundred", 300], ["300 MW", 300], ["four point two five", 4.25], ["1.2 crore", 1.2e7], ["fifty", 50], ["two thousand five hundred", 2500],
  ["seventy five percent", 75], ["one lakh", 1e5], ["₹4.10", 4.1], ["twenty one", 21], ["a hundred and fifty", 150], ["no idea", null]];
for (const [text, want] of cases) assert.equal(parseNumber(text), want, text);
for (const [text, want] of [["7 June 2026", "2026-06-07"], ["June 7th, 2026", "2026-06-07"], ["07.06.2026", "2026-06-07"], ["2026-06-07", "2026-06-07"], ["sometime soon", null]]) assert.equal(parseDate(text), want, text);
{
  // the script's "fill" fills every empty input with benchmarks (market sale answered too)
  const blankState = { ...state0, seci: { ...DEFAULT_SETTINGS }, forms: {} };
  const fillItem = buildScript(blankState).find((i) => i.id === "fill");
  assert.deepEqual(missingInputs(fillItem.onYes(blankState, terms), terms), []);
  const sell = buildScript(blankState).find((i) => i.id === "market");
  assert.deepEqual([sell.onYes(blankState).market.sell, sell.onYes(blankState).market.source, sell.onNo(blankState).market.sell], [true, "GDAM", false]);
}
const script = buildScript(filled);
const ids = script.map((i) => i.id);
for (const id of ["intro", "c.dfr", "c.peak", "c.penalty", "bidMw", "peakPlan", "shortfall", "ppaDate", "fill", "market", "solar.cuf", "wind.capex", "bess.duration", "bess.capex", "fin.targetEquityIrr", "costs.preopPct", "size", "results", "finance", "forms"]) {
  assert.ok(ids.includes(id), id);
}
assert.ok(script.find((i) => i.id === "c.dfr").say.includes("90 percent") && script.find((i) => i.id === "c.dfr").say.includes("70 percent"));
let s = filled;
const answers = { bidMw: "four hundred", peakPlan: "evening only", shortfall: "meet every block", ppaDate: "7 June 2026", "solar.cuf": "26 percent", "solar.capex": "three point eight", "wind.cuf": "0.35",
  "bess.duration": "two hours", "bess.rte": "88", "fin.targetEquityIrr": "fifteen percent", "fin.tenorYears": "eighteen", "costs.evacuationCr": "120" };
for (const item of script) {
  if (!item.read) continue;
  assert.ok(item.ask.length > 10, item.id);
  if (!(item.id in answers)) continue;
  const v = item.read(answers[item.id]);
  assert.notEqual(v, null, `${item.id}: ${answers[item.id]}`);
  s = item.set(s, v);
}
assert.equal(s.bid.baseMw, 400);
assert.deepEqual([s.seci.peakPlan, s.seci.shortfall, s.seci.ppaDate], ["evening", "hard", "2026-06-07"]);
assert.deepEqual([s.src.solar.cuf, s.src.solar.capex, s.src.wind.cuf, s.src.bess.duration, s.src.bess.rte], [0.26, 3.8, 0.35, "2", 0.88]);
assert.deepEqual([s.fin.targetEquityIrr, s.fin.tenorYears, s.costs.evacuationCr], [0.15, 18, 120]);
assert.equal(s.filled["solar.cuf"], false, "a spoken value is the bidder's, not a benchmark");
assert.equal(script.find((i) => i.id === "bidMw").read("40"), null, "below 50 MW is refused");
assert.equal(script.find((i) => i.id === "solar.cuf").read("250"), null, "a CUF above 100% is refused");
const bench = script.find((i) => i.id === "wind.capex");
assert.equal(bench.set(s, bench.benchmark, true).filled["wind.capex"], true, "a benchmark stays marked");
assert.equal(bench.benchmark, BENCHMARKS.wind.capex);
assert.ok(SOURCE_FIELDS.bess.some((f) => f.key === "duration"));

// results and finance, in words
const res = explainResults({ ...sized, bid: { baseMw: 300 } });
assert.ok(/600 megawatts of solar/.test(res) && /400 megawatts of wind/.test(res) && /97 percent of the hours/.test(res) && /3 million units short/.test(res) && /EMD is 151 crore/.test(res) && /7 June 2028/.test(res), res);
const fin = financeOf(sized, terms);
assert.ok(fin && fin.rows[0].blockPenalty > 0, "the financial model charges the block shortfall");
assert.ok(Math.abs(fin.equityIrr - filled.fin.targetEquityIrr) < 1e-6);
// a quoted tariff against the target: the equity and project IRR the quote really earns
const atTarget = quotedReturns(sized, terms, Math.ceil(fin.tariff * 100) / 100);
assert.equal(atTarget.status, "ok", atTarget.message);
assert.ok(atTarget.equityIrr >= filled.fin.targetEquityIrr - 1e-6, "rounding the target tariff up keeps the target IRR");
assert.ok(Math.abs(atTarget.targetTariff - fin.tariff) < 1e-9);
const low = quotedReturns(sized, terms, Number((fin.tariff * 0.85).toFixed(2)));
assert.equal(low.status, "below", low.message);
assert.ok(low.equityIrr < filled.fin.targetEquityIrr && low.projectIrr < atTarget.projectIrr, "a lower tariff earns less on equity and on the project");
assert.ok(low.equityIrr > 0 && Number.isFinite(low.projectIrr));
assert.ok(/below the/.test(low.message) && /equity IRR is \d/.test(low.message) && /project IRR \d/.test(low.message), low.message);
const loss = quotedReturns(sized, terms, 1);
assert.equal(loss.status, "loss", loss.message);
assert.equal(quotedReturns({ ...sized, lp: null }, terms, 5), null, "no quote check before sizing");
assert.equal(quotedReturns(sized, terms, null), null);
const lowChecks = Object.fromEntries(bidChecks({ ...sized, forms: { ...forms, tariff: low.tariff } }, terms).map((c) => [c.id, c]));
assert.equal(lowChecks.tariff.status, "warn", "a quote below the target IRR tariff is flagged on the bid forms");
assert.ok(/project IRR/.test(lowChecks.tariff.detail), lowChecks.tariff.detail);
// ---- the RfS formats: which this bid needs, where each blank comes from, the bid pack
const fmt = (id) => PACK.formats.find((f) => f.id === id);
const company = { ...sized, forms: { ...forms, bidderType: "company", emdForm: "bg", commonShareholding: "no", connectivity: "final" } };
assert.equal(applies(company, fmt("7.1")), "yes");
assert.equal(applies(company, fmt("7.2")), "no", "Power of Attorney only for a consortium");
assert.equal(applies({ ...company, forms: { ...company.forms, bidderType: "consortium" } }, fmt("7.2")), "yes");
assert.deepEqual(["7.3A", "7.3B", "7.3C"].map((id) => applies(company, fmt(id))), ["yes", "no", "no"], "the EMD format follows the instrument chosen");
assert.equal(applies({ ...company, forms: { ...company.forms, emdForm: null } }, fmt("7.3B")), "choose");
assert.equal(applies(company, fmt("7.3D")), "later", "the PBG comes after the award");
assert.deepEqual([applies(company, fmt("7.8")), applies(company, fmt("7.8A"))], ["yes", "no"]);
assert.equal(applies({ ...company, forms: { ...company.forms, commonShareholding: "yes" } }, fmt("7.8A")), "yes");
assert.equal(applies(company, fmt("Annexure-I")), "no");
assert.equal(applies({ ...company, forms: { ...company.forms, connectivity: "other" } }, fmt("Annexure-I")), "yes", "another entity's connectivity needs its undertaking");
const capBlank = fmt("7.1").fields.find((x) => x.maps === "contractedMw");
assert.deepEqual(blankValue(company, fmt("7.1"), capBlank), { source: "model", key: "contractedMw", value: String(company.bid.baseMw) });
const bidderBlank = fmt("7.10").fields.find((x) => x.maps === "bidder");
assert.equal(blankValue(company, fmt("7.10"), bidderBlank).value, "Acme Renewables Ltd");
assert.equal(blankValue(company, fmt("7.1"), { maps: "connectivity", key: "c" }).value, "Final grant", "choices read as their labels");
assert.equal(blankValue(company, fmt("7.1"), { maps: "date", key: "d" }).value, "20.05.2026", "the letters' date");
const st71 = formatStatus(company, fmt("7.1"));
assert.ok(st71.total > 20 && st71.missing.length > 0 && st71.reviewed === null);
const sum = formatsSummary(company);
assert.ok(sum.needed >= 10 && sum.reviewed === 0 && sum.blanksLeft > 0, JSON.stringify(sum));
assert.deepEqual(formatGroups(company).map((g) => g.id), ["envelope1", "envelope2", "later", "na"]);
assert.ok(formatGroups(company).find((g) => g.id === "envelope2").list.some((f) => f.id === "7.10"), "the financial bid goes in Envelope II");
const packFormats = formatsForPack(company);
assert.ok(packFormats.some((f) => f.id === "7.1") && !packFormats.some((f) => f.id === "7.2"));
assert.ok(packFormats.find((f) => f.id === "7.10").fields.some((x) => x.value === "Acme Renewables Ltd"));
const words = explainFinance(sized, fin);
assert.ok(/rupees per unit/.test(words) && /Penalties come to/.test(words), words);

console.log(`SECI RTC tender checks passed (${PACK.conditions.length} conditions, ${script.length} script steps; year-1 block penalty ₹${fin.rows[0].blockPenalty.toFixed(2)} cr)`);
