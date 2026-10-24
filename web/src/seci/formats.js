// The RfS's bid formats (Section 7 and the annexures signed with the bid), filled from the bid:
// which formats this bid needs, where each blank's value comes from, how much is filled and
// whether the bidder has reviewed it since the last change. Plain JavaScript, checked in Node by
// tools/check_seci.mjs.
//
// A blank's value comes from one of three places:
//   model:  the bid itself (contracted MW, the sized plant, EMD and PBG, the RfS's number and title);
//   shared: a particular asked once and used in every format (bidder, address, signatory...);
//   own:    a blank only this format has (state.forms["<format>.<key>"]).
import { PACK, moneyAtStake } from "./terms.js";
import { FORM_FIELDS } from "./forms.js";

const fmtDate = (iso) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split("-").reverse().join(".") : iso || "");
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const rs = (v) => (isNum(v) ? `INR ${Math.round(v).toLocaleString("en-IN")}` : "");
const mw = (v) => (isNum(v) ? String(Math.round(v)) : "");

/** Values the bid already holds, by the `maps` names the formats use. */
export function modelValues(state) {
  const z = state.lp?.sizes || null;
  const money = z ? moneyAtStake(z) : null;
  return {
    contractedMw: mw(state.bid?.baseMw),
    solarMw: z ? mw(z.solarMw) : "",
    windMw: z ? mw(z.windMw) : "",
    bessMw: z ? mw(z.bessMw) : "",
    bessMwh: z ? mw(z.bessMwh) : "",
    emdAmount: money ? rs(money.emdRs) : "",
    pbgAmount: money ? rs(money.pbgRs) : "",
    rfsNo: PACK.rfsNo,
    rfsDate: fmtDate(PACK.rfsDate),
    title: PACK.title,
  };
}
const MODEL = new Set(["contractedMw", "solarMw", "windMw", "bessMw", "bessMwh", "emdAmount", "pbgAmount", "rfsNo", "rfsDate", "title"]);
/** Shared particulars a format blank maps to (state.forms keys); `date` is the letters' date. */
const SHARED = { date: "letterDate", tariff: "tariff", netWorthCr: "netWorthCr", netWorthYear: "netWorthYear" };

/** Whether a blank applies to this bid: a blank marked `when: "consortium"` (a member's equity,
 * the other members) is left out of a single company's format. */
export function fieldApplies(state, field) {
  if (field.when === "consortium") return state.forms?.bidderType === "consortium";
  return true;
}

export const NOT_APPLICABLE = "Not applicable (single company)";

/** Where a blank's value comes from: { source: "model"|"shared"|"own"|"na", key, value }. */
export function blankValue(state, format, field) {
  const f = state.forms || {};
  if (!fieldApplies(state, field)) return { source: "na", key: `${format.id}.${field.key}`, value: NOT_APPLICABLE };
  if (field.maps && MODEL.has(field.maps)) return { source: "model", key: field.maps, value: modelValues(state)[field.maps] };
  if (field.maps) {
    const key = SHARED[field.maps] || field.maps;
    const v = f[key];
    const options = FORM_FIELDS.find((x) => x.key === key)?.options;
    const shown = v === undefined || v === null ? "" : options ? options.find(([k]) => k === v)?.[1] || String(v) : key === "letterDate" ? fmtDate(v) : String(v);
    return { source: "shared", key, value: shown };
  }
  const key = `${format.id}.${field.key}`;
  const v = f[key];
  return { source: "own", key, value: v === undefined || v === null ? "" : field.kind === "date" ? fmtDate(v) : String(v) };
}

/** Whether this bid needs the format: "yes", "no", "later" (after award) or "choose" (an EMD form to pick). */
export function applies(state, format) {
  const f = state.forms || {};
  const a = format.applies;
  if (a === "always") return "yes";
  if (a === "consortium") return f.bidderType === "consortium" ? "yes" : "no";
  if (a.startsWith("emd-")) return !f.emdForm ? "choose" : a === `emd-${f.emdForm}` ? "yes" : "no";
  if (a.startsWith("pbg-")) return "later";
  if (a === "common-shareholding") return f.commonShareholding === "yes" ? "yes" : "no";
  if (format.id === "Annexure-I") return f.connectivity === "other" ? "yes" : "no";
  return "yes";
}

/** A fingerprint of a format's filled values, so a review is known to be out of date after an edit. */
export function formatPrint(state, format) {
  const vals = format.fields.map((x) => blankValue(state, format, x).value);
  const att = (format.attachments || []).map((_, i) => (state.forms?.[`${format.id}.att.${i}`] ? 1 : 0));
  let h = 0;
  for (const ch of JSON.stringify([vals, att])) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return String(h);
}

/**
 * The state of one format: { applies, filled, total, missing (labels), attached, attachments,
 * reviewed: null | "current" | "changed" }. Table blanks are optional (a schedule may be attached).
 */
export function formatStatus(state, format) {
  const needed = format.fields.filter((x) => x.kind !== "table" && fieldApplies(state, x));
  const missing = needed.filter((x) => !blankValue(state, format, x).value).map((x) => x.label);
  const att = format.attachments || [];
  const review = state.formsReview?.[format.id] || null;
  return {
    applies: applies(state, format),
    filled: needed.length - missing.length,
    total: needed.length,
    missing,
    attached: att.filter((_, i) => state.forms?.[`${format.id}.att.${i}`]).length,
    attachments: att.length,
    reviewed: !review ? null : review.print === formatPrint(state, format) ? "current" : "changed",
    reviewedAt: review?.at || null,
  };
}

/** The formats in the order to work through them, grouped as they are submitted. */
export function formatGroups(state) {
  const groups = [
    { id: "envelope1", title: "Envelope I · techno-commercial", list: [] },
    { id: "envelope2", title: "Envelope II · financial", list: [] },
    { id: "later", title: "After the award", list: [] },
    { id: "na", title: "Not needed for this bid", list: [] },
  ];
  for (const f of PACK.formats) {
    const a = applies(state, f);
    const g = a === "no" ? "na" : a === "later" ? "later" : /financial/i.test(f.envelope) ? "envelope2" : "envelope1";
    groups.find((x) => x.id === g).list.push(f);
  }
  return groups.filter((g) => g.list.length);
}

/** Totals for the step header and the checks: formats needed, complete, reviewed. */
export function formatsSummary(state) {
  const needed = PACK.formats.filter((f) => ["yes", "choose"].includes(applies(state, f)));
  const st = needed.map((f) => formatStatus(state, f));
  return {
    needed: needed.length,
    complete: st.filter((s) => s.applies === "yes" && s.missing.length === 0).length,
    reviewed: st.filter((s) => s.reviewed === "current").length,
    blanksLeft: st.reduce((a, s) => a + s.missing.length, 0),
  };
}

/** The formats as the bid pack lays them out: the ones this bid needs, every blank and its value. */
export function formatsForPack(state) {
  return PACK.formats.filter((f) => applies(state, f) !== "no").map((f) => {
    const s = formatStatus(state, f);
    return {
      id: f.id, title: f.title, pages: f.pages, submittedBy: f.submittedBy, paper: f.paper, envelope: f.envelope, when: f.when,
      applies: s.applies, reviewed: s.reviewed, reviewedAt: s.reviewedAt,
      fields: f.fields.map((x) => ({ label: x.label, value: blankValue(state, f, x).value, page: x.context.page })),
      attachments: (f.attachments || []).map((a, i) => ({ label: a.label, done: Boolean(state.forms?.[`${f.id}.att.${i}`]) })),
    };
  });
}
