// Accepting a team member's answer into the bid: where each kind of data point lives in the SECI
// tab's state, and how the answer is written there. Plain JavaScript, used in Node by
// tools/check_team.mjs.
//
// target_key forms (the "key" of an assignment):
//   forms.<key>          a particular or a format's blank (state.forms[key])
//   src.<source>.<field> a source's cost (state.src[source][field])
//   fin.<key>, costs.<key> a financing input or project cost (state.fin / state.costs)
//   format.<id>          a format sent for a signed copy (state.signed[id])
//   condition.<id>       a tender condition sent for a clarification (state.clarifications[id])

/** The team that usually answers each kind of data point. */
export const DEFAULT_TEAM = { field: "management", cost: "procurement", finance: "finance", document: "finance", condition: "legal" };

/** Kind-specific words for the Team panel. */
export const KIND_LABEL = { field: "Value", cost: "Cost", finance: "Financing", document: "Signed copy", condition: "Clarification" };

function coerce(value, ctx = {}) {
  if (value === null || value === undefined || value === "") return null;
  if (ctx.type === "number" || ctx.pct) {
    const n = Number(String(value).replace(/[,₹\s]/g, ""));
    if (!Number.isFinite(n)) throw new Error(`“${value}” is not a number`);
    return ctx.pct ? n / 100 : n;
  }
  return String(value);
}

/** The part of a key after its head: "format.7.1" -> "7.1" (format ids carry dots). */
export const restOf = (key) => key.slice(key.indexOf(".") + 1);

/** The bid's current value of a target, as the assignee should see it. */
export function currentValue(state, key, ctx = {}) {
  const [head, a, b] = key.split(".");
  let v = null;
  if (head === "forms") v = state.forms?.[key.slice(6)];
  else if (head === "src") v = state.src?.[a]?.[b];
  else if (head === "fin" || head === "costs") v = state[head]?.[a];
  else if (head === "format") v = state.signed?.[restOf(key)]?.name || null;
  else if (head === "condition") v = state.clarifications?.[restOf(key)]?.text || null;
  if (ctx.pct && typeof v === "number") return Math.round(v * 1e6) / 1e4;
  return v ?? null;
}

/**
 * The state with the accepted answer written in: a = { target_kind, target_key, context, answer:
 * { value, note, by, at }, file_id, file_name }. Changing a cost or a financing input clears the
 * sizing, as typing it would.
 */
export function applyAnswer(state, a) {
  const key = a.target_key;
  const ctx = a.context || {};
  const ans = a.answer || {};
  const [head, x, y] = key.split(".");
  const unmark = (filled, k) => Object.fromEntries(Object.entries(filled || {}).filter(([f]) => f !== k));
  if (head === "forms") return { ...state, forms: { ...state.forms, [key.slice(6)]: coerce(ans.value, ctx) } };
  if (head === "src") {
    return { ...state, src: { ...state.src, [x]: { ...state.src[x], [y]: coerce(ans.value, { ...ctx, type: "number" }) } }, filled: unmark(state.filled, `${x}.${y}`), lp: null };
  }
  if (head === "fin" || head === "costs") {
    return { ...state, [head]: { ...state[head], [x]: coerce(ans.value, { ...ctx, type: "number" }) }, filled: unmark(state.filled, `${head}.${x}`), lp: null };
  }
  if (head === "format") {
    if (!a.file_id) throw new Error("No signed copy uploaded");
    return { ...state, signed: { ...(state.signed || {}), [restOf(key)]: { fileId: a.file_id, name: a.file_name || "signed copy", by: ans.by || "", at: ans.at || null, note: ans.note || "" } } };
  }
  if (head === "condition") {
    return { ...state, clarifications: { ...(state.clarifications || {}), [restOf(key)]: { text: ans.note || String(ans.value ?? ""), fileId: a.file_id || null, fileName: a.file_name || null, by: ans.by || "", at: ans.at || null } } };
  }
  throw new Error(`Unknown data point ${key}`);
}

/** The latest live assignment of each data point (cancelled ones are left out). */
export function byTarget(assignments) {
  const out = {};
  for (const a of assignments || []) {
    if (a.status === "cancelled") continue;
    const prev = out[a.target_key];
    if (!prev || new Date(a.updated_at) > new Date(prev.updated_at)) out[a.target_key] = a;
  }
  return out;
}
