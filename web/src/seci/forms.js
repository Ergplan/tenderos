// SECI RTC-TM-V bid forms: what the bidder fills in, the checks against the tender's conditions,
// and the request for the bid pack (POST /api/seci/forms, a Word file). Plain JavaScript, checked
// in Node by tools/check_seci.mjs.
import { PACK, condition, keyDates, moneyAtStake, seciTerms } from "./terms.js";
import { quotedReturns } from "../bid/quote.js";

/** The fields of the bid forms, in the order they are filled (the voice guide follows it too). */
export const FORM_FIELDS = [
  { key: "bidder", group: "Bidder", label: "Bidder's name", type: "text", required: true },
  { key: "bidderType", group: "Bidder", label: "Bidding as", type: "select", options: [["company", "Single company"], ["consortium", "Consortium"]], required: true },
  { key: "leadMember", group: "Bidder", label: "Lead member (consortium)", type: "text", when: (f) => f.bidderType === "consortium", required: true },
  { key: "address", group: "Bidder", label: "Registered office", type: "textarea", required: true },
  { key: "contact", group: "Bidder", label: "Authorised signatory", type: "text", required: true },
  { key: "email", group: "Bidder", label: "Email", type: "email", required: true },
  { key: "phone", group: "Bidder", label: "Phone", type: "text" },
  { key: "tariff", group: "Offer", label: "Tariff quoted (₹/kWh)", type: "number", step: 0.01, required: true, hint: "Two decimals; from the Financials step" },
  { key: "substation", group: "Project", label: "Delivery Point (ISTS substation)", type: "text", required: true, hint: "One of the four choices of cl. 7.5" },
  { key: "substationScd", group: "Project", label: "Substation's scheduled commissioning date", type: "date", required: true, hint: "On or before 30.06.2028; proof in Format-7.1" },
  { key: "connectivity", group: "Project", label: "Connectivity", type: "select", options: [["applied", "Applied"], ["inPrinciple", "In-principle grant"], ["final", "Final grant"], ["other", "Another entity's connectivity"]], required: true },
  { key: "solarSite", group: "Project", label: "Solar site (district, state)", type: "text" },
  { key: "windSite", group: "Project", label: "Wind site (district, state)", type: "text" },
  { key: "bessWith", group: "Project", label: "Battery co-located with", type: "select", options: [["solar", "Solar"], ["wind", "Wind"], ["both", "Both sites"]], required: true },
  { key: "netWorthCr", group: "Eligibility", label: "Net worth, last audited year (₹ cr)", type: "number", step: 0.01, required: true },
  { key: "netWorthYear", group: "Eligibility", label: "Financial year of that net worth", type: "text", hint: "e.g. 2025-26" },
  { key: "experience", group: "Eligibility", label: "Commissioned projects (MW, one per line: name, MW, date)", type: "textarea", hint: "Owner or EPC, last seven years; needed only if cl. 34.3 still applies" },
];

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const fmtDate = (iso) => (iso ? iso.split("-").reverse().join(".") : "–");

/** The fields shown for these answers (a consortium adds the lead member). */
export function visibleFields(forms = {}) {
  return FORM_FIELDS.filter((f) => !f.when || f.when(forms));
}

/** Required fields still empty. */
export function formIssues(state) {
  const f = state.forms || {};
  return visibleFields(f).filter((x) => x.required && (f[x.key] === undefined || f[x.key] === null || f[x.key] === "")).map((x) => x.label);
}

/** Projects from the experience box: "name, MW, date" per line (date optional). */
export function parseExperience(text) {
  return String(text || "").split(/\n+/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const parts = line.split(",").map((p) => p.trim());
    const mw = parts.map((p) => Number(p.replace(/[^\d.]/g, ""))).find((v, i) => i > 0 && v > 0) || null;
    const date = parts.find((p) => /^\d{4}-\d{2}-\d{2}$|^\d{2}\.\d{2}\.\d{4}$/.test(p)) || null;
    return { name: parts[0], mw, date };
  });
}

/** Amendment-01 cl. 34.3: one plant >= 4X/5, two >= X/2 each, or three >= 2X/5 each (X = bid MW). */
export function experienceTest(projects, bidMw) {
  const x = bidMw || 0;
  const n = (min) => projects.filter((p) => (p.mw || 0) >= min - 1e-9).length;
  const ways = [
    { need: 1, min: (4 * x) / 5, label: `one plant of at least ${Math.round((4 * x) / 5)} MW` },
    { need: 2, min: x / 2, label: `two plants of at least ${Math.round(x / 2)} MW each` },
    { need: 3, min: (2 * x) / 5, label: `three plants of at least ${Math.round((2 * x) / 5)} MW each` },
  ];
  const met = ways.find((w) => n(w.min) >= w.need) || null;
  return { met: Boolean(met), how: met?.label || null, ways };
}

/**
 * Each check of the bid against the tender: { id, label, status: ok | bad | warn | todo, detail,
 * condition (pack condition id) }.
 */
export function bidChecks(state, terms = seciTerms(state.seci || {})) {
  const f = state.forms || {};
  const m = PACK.model;
  const mw = state.bid.baseMw;
  const sizes = state.lp?.sizes || null;
  const money = sizes ? moneyAtStake(sizes) : null;
  const out = [];
  const add = (row) => out.push(row);
  add({ id: "capacity", label: "Contracted capacity", condition: "bidSize",
    status: mw >= m.minBidMw && mw <= m.maxBidMw ? "ok" : "bad", detail: `${mw ?? "–"} MW (50 to 500 MW)` });
  const quote = isNum(f.tariff) && f.tariff > 0 ? quotedReturns(state, terms, f.tariff) : null;
  add({ id: "tariff", label: "Tariff quoted", condition: "tariff",
    status: !(isNum(f.tariff) && f.tariff > 0) ? "todo" : quote && quote.status !== "ok" ? "warn" : "ok",
    detail: !isNum(f.tariff) ? "Enter the tariff (Financials gives the tariff for your target IRR)" : quote ? quote.message : `₹${f.tariff.toFixed(2)}/kWh, fixed for the term` });
  add({ id: "storage", label: "Storage in the project", condition: "ess",
    status: !sizes ? "todo" : (sizes.bessMw || 0) > 0.5 ? "ok" : "bad", detail: sizes ? `${Math.round(sizes.bessMw || 0)} MW / ${Math.round(sizes.bessMwh || 0)} MWh` : "Size the plant" });
  add({ id: "colocation", label: "Battery co-located with RE", condition: "colocation",
    status: f.bessWith ? "ok" : "todo", detail: f.bessWith ? `With the ${f.bessWith === "both" ? "solar and wind sites" : `${f.bessWith} site`}` : "Say where the battery is" });
  const scdOk = f.substationScd ? f.substationScd <= "2028-06-30" : null;
  add({ id: "substation", label: "Delivery Point substation", condition: "substation",
    status: !f.substation || scdOk === null ? "todo" : scdOk ? "ok" : "bad",
    detail: f.substation ? `${f.substation}${f.substationScd ? `, SCD ${fmtDate(f.substationScd)}${scdOk ? "" : " (after 30.06.2028)"}` : ""}` : "Name the substation and its SCD" });
  if (f.connectivity === "other") {
    add({ id: "undertaking", label: "Undertaking from the connectivity holder", condition: "substation", status: "warn", detail: "Annexure-I undertaking with the copy of their application or grant (Format-7.1)" });
  }
  const need = money?.netWorthRs ?? null;
  add({ id: "networth", label: "Net worth", condition: "networth",
    status: need === null || !isNum(f.netWorthCr) ? "todo" : f.netWorthCr * 1e7 >= need ? "ok" : "bad",
    detail: need === null ? "Size the plant: the requirement follows the installed capacity" : `Need ₹${(need / 1e7).toFixed(2)} cr${isNum(f.netWorthCr) ? `; you have ₹${f.netWorthCr.toFixed(2)} cr` : ""}` });
  const projects = parseExperience(f.experience);
  const test = experienceTest(projects, mw);
  add({ id: "experience", label: "Technical experience (cl. 34.3)", condition: "technical",
    status: projects.length ? (test.met ? "ok" : "warn") : "warn",
    detail: `${projects.length ? (test.met ? `Met by ${test.how}` : `Not met: needs ${test.ways.map((w) => w.label).join(", or ")}`) : "No projects entered"}. Amendment-02 marks 34.3 'Not used': confirm whether it still applies.` });
  if (money) {
    add({ id: "emd", label: "EMD to furnish", condition: "emd", status: "ok", detail: `₹${(money.emdRs / 1e7).toFixed(2)} crore` });
    add({ id: "pbg", label: "PBG at PPA signing", condition: "pbg", status: "ok", detail: `₹${(money.pbgRs / 1e7).toFixed(2)} crore` });
  }
  const dates = keyDates(state.seci?.ppaDate);
  add({ id: "dates", label: "Supply start", condition: "scsd", status: dates ? "ok" : "todo",
    detail: dates ? `SCSD ${fmtDate(dates.scsd)}; Financial Closure ${fmtDate(dates.financialClosure)}` : "Enter the expected PPA date (What you bid)" });
  return out;
}

/** The bid pack request: the answers, the plant, the checks and the conditions they rest on. */
export function bidPackRequest(state, finance = null, terms = seciTerms(state.seci || {})) {
  const f = state.forms || {};
  const sizes = state.lp?.sizes || {};
  const money = state.lp ? moneyAtStake(sizes) : null;
  const dates = keyDates(state.seci?.ppaDate);
  const checks = bidChecks(state, terms).map((c) => {
    const cond = condition(c.condition);
    const q = cond?.sources?.[0];
    const doc = q ? PACK.documents.find((d) => d.id === q.doc) : null;
    return { ...c, source: q ? `${doc?.title || q.doc}, p. ${q.page}` : "" };
  });
  return {
    tender: { short: PACK.short, title: PACK.title, rfsNo: PACK.rfsNo, issuer: PACK.issuer },
    fields: visibleFields(f).map((x) => {
      const v = f[x.key];
      const shown = x.options ? (x.options.find(([k]) => k === v)?.[1] || "") : v;
      return { group: x.group, label: x.label, value: shown === undefined || shown === null ? "" : String(shown) };
    }),
    bid: {
      contractedMw: state.bid.baseMw,
      tariff: f.tariff ?? null,
      modelTariff: finance?.tariff ?? state.lp?.tariff ?? null,
      solarMw: sizes.solarMw ?? null, windMw: sizes.windMw ?? null, bessMw: sizes.bessMw ?? null, bessMwh: sizes.bessMwh ?? null,
      emdCr: money ? money.emdRs / 1e7 : null, pbgCr: money ? money.pbgRs / 1e7 : null, netWorthCr: money ? money.netWorthRs / 1e7 : null,
      peakPlan: state.seci?.peakPlan, shortfall: state.seci?.shortfall,
    },
    dates,
    checks,
    documents: PACK.documents.map((d) => ({ title: d.title, ref: d.ref, date: d.date, provided: Boolean(d.file) })),
    fileName: `${PACK.short.replace(/\W+/g, "_")}_bid_${state.bid.baseMw || 0}MW`,
  };
}
