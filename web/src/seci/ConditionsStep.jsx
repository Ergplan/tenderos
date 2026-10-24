import React from "react";
import { MessageSquareQuote, TriangleAlert } from "lucide-react";
import AssignButton from "../team/AssignButton";
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
const ORDER = ["The tender", "What you bid", "Bid process", "Supply", "Plant", "Dates", "Money at stake", "Eligibility"];

/** Step 2: every bid condition now in force (after both amendments), with its quote and history. */
export default function ConditionsStep({ state = null }) {
  const groups = [...new Set(PACK.conditions.map((c) => c.group))].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  const count = (status) => PACK.conditions.filter((c) => c.status === status).length;
  return (
    <Section index="2" title="Bid conditions" note="The RfS as it stands after Amendment-01, Amendment-02 and Clarifications-01">
      <p className="rtc-note" data-testid="seci-cond-summary">
        {PACK.conditions.length} conditions: {count("amended")} amended, {count("removed")} removed, {count("ambiguous")} unclear{count("missing") ? `, ${count("missing")} not in the documents` : ""}. Under each amended rule, “RfS as issued” shows the original wording.
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
                  {state?.clarifications?.[c.id] && (
                    <div className="team-clarified" data-testid={`seci-cond-clarified-${c.id}`}>
                      <MessageSquareQuote size={12} /> <b>Our reading{state.clarifications[c.id].by ? ` (${state.clarifications[c.id].by})` : ""}:</b> {state.clarifications[c.id].text}
                      {state.clarifications[c.id].fileId && <a href={`/api/team/files/${state.clarifications[c.id].fileId}`}> {state.clarifications[c.id].fileName}</a>}
                    </div>
                  )}
                  <AssignButton target={{ kind: "condition", key: `condition.${c.id}`, label: c.label, context: { quote: c.sources[0]?.quote || null, page: c.sources[0]?.page || null, value: c.value } }} />
                  {c.rfs && (c.status !== "unchanged" || !c.sources.some((q) => q.doc === "rfs")) && (
                    <details className="seci-rfs-orig">
                      <summary>RfS as issued</summary>
                      <p>{c.rfs.note}</p>
                      {c.rfs.quotes.map((q, i) => <QuoteLink key={i} quote={q} />)}
                    </details>
                  )}
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
