// Checks for team sharing (web/src/team/apply.js): where each kind of data point lives in the bid,
// and how an accepted answer is written into it. Run from the repository root:
//   node tools/check_team.mjs
import assert from "node:assert/strict";
import { applyAnswer, byTarget, currentValue, DEFAULT_TEAM } from "../web/src/team/apply.js";
import { defaultSeciState } from "../web/src/seci/state.js";

const s0 = { ...defaultSeciState(), lp: { sizes: { solarMw: 500 } }, filled: { "solar.capex": true, "fin.targetEquityIrr": true } };
s0.src.solar.capex = 4;
s0.fin.targetEquityIrr = 0.14;
s0.forms = { bidder: "Arkaja", "7.1.refNo": "ARK/1" };

// a particular and a format's blank
let s = applyAnswer(s0, { target_key: "forms.bidder", context: { type: "text" }, answer: { value: "Arkaja Renewables Private Limited" } });
assert.equal(s.forms.bidder, "Arkaja Renewables Private Limited");
assert.equal(s.lp, s0.lp, "a particular keeps the sizing");
s = applyAnswer(s0, { target_key: "forms.7.1.refNo", context: {}, answer: { value: "ARK/2" } });
assert.equal(s.forms["7.1.refNo"], "ARK/2", "a format's blank keys keep their dots");
// a cost: a number, the benchmark mark dropped, the sizing cleared
s = applyAnswer(s0, { target_key: "src.solar.capex", context: { type: "number", unit: "₹ cr/MWac" }, answer: { value: "3.62" } });
assert.equal(s.src.solar.capex, 3.62);
assert.equal(s.filled["solar.capex"], undefined);
assert.equal(s.lp, null, "a new cost needs a new sizing");
assert.throws(() => applyAnswer(s0, { target_key: "src.solar.capex", context: {}, answer: { value: "about four" } }), /not a number/);
// a financing input entered in %
s = applyAnswer(s0, { target_key: "fin.targetEquityIrr", context: { pct: true }, answer: { value: "15.5" } });
assert.ok(Math.abs(s.fin.targetEquityIrr - 0.155) < 1e-12);
assert.equal(currentValue(s0, "fin.targetEquityIrr", { pct: true }), 14, "shown to the assignee in %");
assert.equal(currentValue(s0, "src.solar.capex", {}), 4);
// a signed copy and a clarification
s = applyAnswer(s0, { target_key: "format.7.1", context: {}, file_id: "f1", file_name: "7.1 signed.pdf", answer: { by: "Finance desk", at: "2026-10-24T10:00:00Z" } });
assert.deepEqual(s.signed["7.1"], { fileId: "f1", name: "7.1 signed.pdf", by: "Finance desk", at: "2026-10-24T10:00:00Z", note: "" });
assert.throws(() => applyAnswer(s0, { target_key: "format.7.1", context: {}, answer: {} }), /No signed copy/);
s = applyAnswer(s0, { target_key: "condition.peakHours", context: {}, answer: { note: "Any 6 hours of 18:00-10:00, chosen by SECI a day ahead", by: "Legal desk" } });
assert.equal(s.clarifications.peakHours.text, "Any 6 hours of 18:00-10:00, chosen by SECI a day ahead");
assert.equal(currentValue(s, "condition.peakHours"), "Any 6 hours of 18:00-10:00, chosen by SECI a day ahead");
// the latest live assignment per data point; cancelled ones do not count
const t = byTarget([
  { target_key: "src.solar.capex", status: "cancelled", updated_at: "2026-10-24T12:00:00Z" },
  { target_key: "src.solar.capex", status: "submitted", updated_at: "2026-10-24T11:00:00Z" },
  { target_key: "src.solar.capex", status: "accepted", updated_at: "2026-10-23T11:00:00Z" },
]);
assert.equal(t["src.solar.capex"].status, "submitted");
assert.deepEqual(DEFAULT_TEAM, { field: "management", cost: "procurement", finance: "finance", document: "finance", condition: "legal" });
assert.throws(() => applyAnswer(s0, { target_key: "nowhere.x", answer: {} }), /Unknown data point/);
console.log("Team checks passed (5 kinds of data point)");
