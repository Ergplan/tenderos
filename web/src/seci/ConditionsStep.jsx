import React from "react";
import { TriangleAlert } from "lucide-react";
import { Section } from "../rtc/ui";
import { PACK } from "./terms";
import { QuoteLink } from "./DocumentsStep";

const STATUS = {
  amended: "Amended",
  unchanged: "As issued",
  removed: "Removed",
  ambiguous: "Unclear",
  missing: "Not in the documents",
};
const docTitle = (id) => PACK.documents.find((d) => d.id === id)?.title || id;

/** Step 2: every bid condition now in force (after both amendments), with its quote and history. */
export default function ConditionsStep() {
  const groups = [...new Set(PACK.conditions.map((c) => c.group))];
  const count = (status) => PACK.conditions.filter((c) => c.status === status).length;
  return (
    <Section index="2" title="Bid conditions" note="As they stand after Amendment-01, Amendment-02 and Clarifications-01">
      <p className="rtc-note" data-testid="seci-cond-summary">
        {PACK.conditions.length} conditions: {count("amended")} amended, {count("removed")} removed, {count("ambiguous")} unclear, {count("missing")} not in the documents provided.
      </p>
      {groups.map((g) => (
        <div key={g}>
          <div className="seci-group-title">{g}</div>
          <div className="seci-conds">
            {PACK.conditions.filter((c) => c.group === g).map((c) => (
              <div key={c.id} className="seci-cond" data-testid={`seci-cond-${c.id}`}>
                <strong>{c.label}</strong>
                <div className="seci-cond-body">
                  <b>{c.value}</b>
                  {c.was && <em>Was: {c.was}</em>}
                  {c.flag && <span className="seci-flag"><TriangleAlert size={12} /> {c.flag}</span>}
                  {c.sources.map((q, i) => <QuoteLink key={i} quote={q} />)}
                </div>
                <span className={`seci-badge ${c.status}`}>{STATUS[c.status]}{c.by ? ` · ${docTitle(c.by)}` : ""}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </Section>
  );
}
