// Checks the Tender to Bid terms (web/src/bid/tenderMap.js) derived from a reading of the NHPC
// FDRE-II RfS (samples/tenders/nhpc-fdre-ii/RfS.pdf). Every term must be proved by a located quote.
// Run from the repository root:   node tools/check_nhpc_terms.mjs <reading.json>
// tests/e2e/test_nhpc_tender.py writes a fresh rules-mode reading and runs this script on it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildProposals, tenderTerms } from "../web/src/bid/tenderMap.js";
import { capacityPages, defaultBidMw } from "../web/src/bid/model.js";

const file = process.argv[2];
if (!file) throw new Error("usage: node tools/check_nhpc_terms.mjs <reading.json>");
const result = JSON.parse(readFileSync(file, "utf8"));
const terms = tenderTerms(result);

assert.equal(terms.baseMw, 1200);
assert.equal(terms.minBidMw, 50);
assert.equal(terms.maxBidMw, 600);
assert.equal(defaultBidMw(terms), 600, "the bid starts at the most one bidder may offer");
assert.deepEqual(capacityPages(terms), [1, 8]);
assert.deepEqual(terms.rules.map((r) => [r.id, r.target, r.basis, r.hours]), [["annual", 0.4, "annual", "all"], ["peak", 0.9, "monthly", "any"]]);
assert.equal(terms.peak.hours, 4);
assert.equal(terms.peak.setBy, "tender");
assert.deepEqual(terms.peak.windows.map((w) => [w.start, w.end, w.hours]), [["05:00", "10:00", 2], ["18:00", "23:00", 2]]);
assert.equal(terms.peakAny, true);
assert.deepEqual(terms.permitted, { solar: true, wind: true, hydro: true, biomass: true, thermal: null, bess: true });
assert.deepEqual(terms.mandatory, { solar: false, bess: true });
assert.equal(terms.years, 25);
assert.equal(terms.ceiling, null, "the RfS states no ceiling tariff");

const stated = buildProposals(result).filter((p) => p.stated);
const pages = Object.fromEntries(stated.map((p) => [p.id, p.source?.page]));
assert.deepEqual(pages, {
  capacity: 1, maxBid: 8, minBid: 8, "rule.annual": 29, "rule.peak": 29, "peak.hours": 29, "peak.setBy": 29, sources: 17,
  storage: 56, "market.sale": 35, ppaFirst: 65, site: 1, years: 8, deadline: 22,
});
for (const p of stated) assert.ok(p.source?.proved, `${p.id} is proved by a located quote`);

console.log(`NHPC FDRE-II terms: ${stated.length} stated, all proved`);
