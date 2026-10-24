// The SECI RTC-TM-V letter templates (web/src/seci/letters): one per bid format, every blank of
// the format placed in its letter, no placeholder that is not a blank of that format, every
// alternative on a choice blank and one of its options; and a filled bid renders every letter
// this bid needs with no blank left and no alternative left to choose.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PACK } from "../web/src/seci/terms.js";
import { applies, NOT_APPLICABLE } from "../web/src/seci/formats.js";
import { EMPTY, TEMPLATES, inlineOf, letterOf, lettersForBid, parseTemplate, tokensOf, letterHtml } from "../web/src/seci/letters/index.js";

// node tools/check_seci_letters.mjs [format id ...]: only those templates, without the demo bid
const only = process.argv.slice(2);
const problems = [];
for (const format of PACK.formats.filter((f) => !only.length || only.includes(f.id))) {
  const t = TEMPLATES[format.id];
  if (!t) { problems.push(`${format.id}: no template`); continue; }
  const keys = new Set(format.fields.map((x) => x.key));
  const blocks = parseTemplate(t.text);
  const used = new Set();
  for (const b of blocks) {
    const texts = b.type === "table" ? b.rows.flat() : [b.text];
    for (const text of texts) for (const k of tokensOf(text)) {
      used.add(k);
      if (!keys.has(k)) problems.push(`${format.id}: {{${k}}} is not a blank of this format`);
    }
    const alternatives = [...(b.cond ? [{ key: b.cond.key, option: b.cond.value }] : []), ...texts.flatMap((text) => inlineOf(text))];
    for (const alt of alternatives) {
      used.add(alt.key);
      const field = format.fields.find((x) => x.key === alt.key);
      if (!field) problems.push(`${format.id}: alternative on ${alt.key} names no blank`);
      else if (field.kind !== "choice" || !(field.options || []).includes(alt.option)) problems.push(`${format.id}: alternative ${alt.key}=${alt.option} is not one of its options ${JSON.stringify(field.options)}`);
    }
  }
  const omit = new Set(t.omit || []);
  for (const k of keys) if (!used.has(k) && !omit.has(k)) problems.push(`${format.id}: blank ${k} has no place in the letter`);
  for (const k of omit) if (!keys.has(k)) problems.push(`${format.id}: omit lists ${k}, not a blank`);
  if (!blocks.some((b) => b.type === "heading")) problems.push(`${format.id}: no heading`);
}
assert.deepEqual(problems, [], problems.join("\n"));
if (only.length) {
  console.log(`SECI letter templates checked: ${only.join(", ")}`);
  process.exit(0);
}

// the demo bidder's bid (demo/company.json and the bid of the demo run): every letter it needs
// renders with every blank filled
const company = JSON.parse(readFileSync(new URL("../demo/company.json", import.meta.url)));
const run = JSON.parse(readFileSync(new URL("../demo/arkaja-seci-rtc-tm-v/run.json", import.meta.url)));
const bid = run.scenarios.find((s) => s.bid);
const sz = bid.lp.sizes;
const costBreakup = company.costBreakup.replace("{solar}", Math.round(sz.solarMw)).replace("{wind}", Math.round(sz.windMw))
  .replace("{bessMw}", Math.round(sz.bessMw)).replace("{bessMwh}", Math.round(sz.bessMwh));
// the particulars and the typed blanks as the demo run enters them; the tariff from the run
const forms = { ...company.particulars, ...company.blanks, tariff: run.forms.tariff, "7.11.costBreakup": costBreakup };
const state = { forms, bid: { baseMw: bid.mw }, lp: bid.lp, seci: { ppaDate: company.ppaDate }, formsReview: {} };
const letters = lettersForBid(state, applies);
assert.deepEqual(letters.map((l) => l.id), ["7.1", "7.3A", "7.4", "7.6", "7.7", "7.8", "7.8-annex", "7.9", "7.10", "7.11", "Annexure-B"]);
for (const l of letters) {
  assert.deepEqual(l.missing, [], `${l.id}: blanks left: ${l.missing.join(", ")}`);
  assert.ok(!l.blocks.some((b) => b.choose), `${l.id}: an alternative is left to choose`);
  const printed = l.blocks.filter((b) => !b.struck && !b.omitted);
  const segs = printed.flatMap((b) => (b.type === "table" ? b.rows.flat(2) : b.segments));
  assert.ok(!segs.some((x) => x.missing), `${l.id}: a blank left in the letter`);
  assert.ok(!letterHtml(l).includes(NOT_APPLICABLE), `${l.id}: a consortium-only blank printed`);
}
const l71 = letters[0];
assert.ok(l71.letterhead && l71.bidder === "Arkaja Renewables Private Limited");
const struck = l71.blocks.filter((b) => b.struck).map((b) => b.cond.value);
assert.deepEqual(struck, ["Common shareholder >10% <26% in other bidders (Format 7.8A)", "Applicable"], "the alternatives not chosen are struck out");
assert.ok(letterHtml(l71).includes("Fatehgarh-IV PS (ISTS)"));
// an edit of a paragraph's wording is kept, with its placeholders live
const edited = letterOf({ ...state, letters: { "7.1": { 9: "We, {{bidder}}, submit our response." } } }, PACK.formats.find((f) => f.id === "7.1"));
const b9 = edited.blocks.find((b) => b.index === 9);
assert.ok(b9.edited && b9.segments.map((s) => s.text).join("") === "We, Arkaja Renewables Private Limited, submit our response.");
assert.equal(edited.edited, 1);
console.log(`SECI letter checks passed (${PACK.formats.length} templates; the demo bid's ${letters.length} letters filled)`);
