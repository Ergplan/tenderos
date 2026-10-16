// The scan screen's agents and what each one reports from a tender reading. Pure functions
// (checked by tools/check_scan_agents.mjs). An agent's findings are fields of the engine's
// result with their page; nothing is made up here.

export const SCAN_AGENTS = [
  { id: "dates", title: "Key dates", color: "#ff8a5f", sections: ["key_dates"] },
  { id: "eligibility", title: "Eligibility & qualification", color: "#7ddc9a", sections: ["eligibility"] },
  {
    id: "constraints", title: "Capacity & supply constraints", color: "#4fd1c5",
    sections: ["identity_and_scope", "supply_sources", "fdre_profile", "re_rtc_profile", "bess_performance", "hybrid_mix",
      "solar_tech", "wind_tech", "gen_tech", "tbcb_elements", "epc_scope", "ipp_model_inputs"],
  },
  { id: "finance", title: "Commercial & finance inputs", color: "#f5b83d", sections: ["commercial", "guarantees"] },
  { id: "risks", title: "Tender risks", color: "#ff6b6b", sections: ["penalties", "connectivity_and_compliance"] },
];

// sections no agent reports: the summary and identity head the screen, documents are a list
const NOT_SCANNED = new Set(["summary", "documents"]);
const IDENTITY = /^core\.(identity|summary)\./;
// fields that are terms of the bid's finances, whichever section holds them
const FINANCE_PATHS = /\.(ppa_tenure_years|ppa_signing_window_days|tariff_ceiling_inr_per_kwh|tariff_structure|greenshoe_same_tariff)$/;
const NOT_READ_IN_RULES = /^Not read in rules mode/;

/** The agent a section's fields belong to (sections a new pack adds go to the constraints agent). */
export function agentForSection(name) {
  if (NOT_SCANNED.has(name)) return null;
  return SCAN_AGENTS.find((a) => a.sections.includes(name))?.id || "constraints";
}

function firstPage(field) {
  const ev = field.evidence || [];
  return (ev.find((e) => e.located) || ev[0])?.page ?? null;
}

function shortText(value, max = 64) {
  const s = String(value ?? "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

function agentForField(sectionAgent, path) {
  return FINANCE_PATHS.test(path) ? "finance" : sectionAgent;
}

/**
 * { agentId: [{ path, label, text, page, kind }] } from a reading. kind is "value" (a value
 * read with its page), "withdrawn" (a provision a later clause withdrew), "review" (a value
 * to check) or "rule" (a failed cross-check). Withdrawn values, values to check and failed
 * rules also go to the risks agent.
 */
export function agentFindings(result) {
  const out = Object.fromEntries(SCAN_AGENTS.map((a) => [a.id, []]));
  if (!result) return out;
  const labels = {};
  for (const section of result.sections || []) {
    const sectionAgent = agentForSection(section.name);
    for (const field of section.fields || []) {
      labels[field.path] = field.label;
      if (!sectionAgent || IDENTITY.test(field.path)) continue;
      const agent = agentForField(sectionAgent, field.path);
      const page = firstPage(field);
      if (field.status === "withdrawn") {
        out.risks.push({ path: field.path, label: field.label, text: "withdrawn by a later clause", page, kind: "withdrawn" });
        continue;
      }
      if (!(field.status === "validated" || field.status === "needs_review")) continue;
      if (field.value === null || field.value === undefined || field.value === "") continue;
      const item = { path: field.path, label: field.label, text: shortText(field.display ?? field.value), page, kind: field.status === "validated" ? "value" : "review" };
      out[agent].push(item);
      if (item.kind === "review" && agent !== "risks") out.risks.push({ ...item, text: `check: ${item.text}` });
    }
  }
  for (const rule of result.rules || []) {
    if (rule.passed || rule.warning) continue;
    const label = (rule.fields || []).map((p) => labels[p] || p).join(", ") || rule.rule;
    out.risks.push({ path: `rule:${rule.rule}:${(rule.fields || []).join(",")}`, label, text: shortText(rule.message, 80), page: null, kind: "rule" });
  }
  return out;
}

/**
 * { agentId: "read" | "not_read" }: "not_read" when the reader did not look for any of the
 * agent's fields (the rule-based reader leaves eligibility, for example, to the model), so the
 * screen does not claim the document is silent on it.
 */
export function agentCoverage(result) {
  const tried = Object.fromEntries(SCAN_AGENTS.map((a) => [a.id, false]));
  for (const section of result?.sections || []) {
    const sectionAgent = agentForSection(section.name);
    if (!sectionAgent) continue;
    for (const field of section.fields || []) {
      if (IDENTITY.test(field.path)) continue;
      const agent = agentForField(sectionAgent, field.path);
      if (!(field.status === "not_found" && NOT_READ_IN_RULES.test(field.rationale || ""))) tried[agent] = true;
    }
  }
  return Object.fromEntries(Object.entries(tried).map(([id, t]) => [id, t ? "read" : "not_read"]));
}

/** The head of the scan screen and the closing line, from the reading itself. */
export function readingHead(result) {
  const v = result?.values || {};
  const c = result?.counts || {};
  const found = c.found || 0;
  const located = c.located || 0;
  return {
    number: v["core.identity.tender_number"] || null,
    issuer: v["core.identity.issuing_agency"] || null,
    title: v["core.identity.title"] || null,
    type: result?.tender_type || null,
    pages: result?.document?.pages ?? null,
    found,
    located,
    allLocated: found > 0 && located === found,
    scanned: (result?.document?.scanned_pages || []).length,
  };
}
