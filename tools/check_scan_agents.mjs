// Checks for the scan screen's agents (web/src/bid/scanAgents.js) on the built-in WBSEDCL reading:
// every finding is a field of the reading with its page, sections map to the right agents, and an
// agent the rule-based reader did not read says so. Run from the repository root:
//   node tools/check_scan_agents.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SCAN_AGENTS, agentCoverage, agentFindings, agentForSection, readingHead } from "../web/src/bid/scanAgents.js";
import { sizingScope } from "../web/src/bid/tenderMap.js";

const { result } = JSON.parse(readFileSync(new URL("../web/db/seed/tenders/wbsedcl-re-rtc-2026-01.json", import.meta.url), "utf8"));
const fields = Object.fromEntries(result.sections.flatMap((s) => s.fields).map((f) => [f.path, f]));

assert.deepEqual(SCAN_AGENTS.map((a) => a.id), ["dates", "eligibility", "constraints", "finance", "risks"]);
assert.equal(agentForSection("key_dates"), "dates");
assert.equal(agentForSection("penalties"), "risks");
assert.equal(agentForSection("summary"), null);
assert.equal(agentForSection("a_section_a_new_pack_adds"), "constraints");

const found = agentFindings(result);
for (const [agent, items] of Object.entries(found)) {
  for (const item of items) {
    if (item.kind === "rule") continue;
    const field = fields[item.path];
    assert.ok(field, `${agent}: ${item.path} is a field of the reading`);
    assert.ok((field.evidence || []).some((e) => e.page === item.page), `${agent}: ${item.path} on p. ${item.page}`);
    assert.ok(!/^core\.(identity|summary)\./.test(item.path), "identity heads the screen, no agent reports it");
  }
}
const deadline = found.dates.find((f) => f.path === "core.key_dates.bid_submission_deadline");
assert.ok(deadline && deadline.page === 16 && /27 Oct 2026/.test(deadline.text), JSON.stringify(deadline));
assert.ok(found.constraints.some((f) => f.path === "sector.power.common.total_capacity_mw" && f.text === "1500 MW"));
assert.ok(found.finance.some((f) => f.path === "core.guarantees.emd_per_mw_inr"), "EMD is a finance input");
assert.ok(found.finance.some((f) => f.path === "sector.power.common.greenshoe_same_tariff"), "tariff terms go to finance, whichever section holds them");
assert.ok(found.risks.some((f) => f.kind === "rule"), "a failed cross-check is a risk");

const coverage = agentCoverage(result);
assert.equal(coverage.eligibility, "not_read", "the rule-based reader leaves eligibility to the model");
assert.equal(coverage.dates, "read");

const head = readingHead(result);
assert.equal(head.number, "WBSEDCL/PT&P/RE-RTC/2026/01");
assert.equal(head.allLocated, true);

assert.deepEqual(sizingScope(result), { applies: true, kind: null, type: "fdre" });
assert.equal(sizingScope({ tender_type: "bess" }).kind, "bess");
assert.equal(sizingScope({ tender_type: "transmission" }).applies, false);
assert.equal(sizingScope(null).applies, true);

console.log(`Scan agent checks passed (${Object.values(found).flat().length} findings on the WBSEDCL reading)`);
