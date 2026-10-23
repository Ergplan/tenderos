import React, { useMemo, useState } from "react";
import { CheckCircle2, CircleDashed, Download, Loader2, TriangleAlert, XCircle } from "lucide-react";
import { Section, nf } from "../rtc/ui";
import { financeOf } from "./voice";
import { FORM_FIELDS, bidChecks, bidPackRequest, formIssues, visibleFields } from "./forms";
import { PACK, prov } from "./terms";
import { SourceChip } from "../bid/RequirementsStep";
import QuoteCheck from "../bid/QuoteCheck";

export { formIssues };

const ICON = { ok: CheckCircle2, bad: XCircle, warn: TriangleAlert, todo: CircleDashed };
const CLS = { ok: "ok", bad: "bad", warn: "warn", todo: "muted" };

async function downloadPack(payload) {
  const res = await fetch("/api/seci/forms", { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify(payload) });
  if (!res.ok) {
    let msg = `Download failed (${res.status})`;
    try { msg = (await res.json()).error || msg; } catch { /* not JSON */ }
    throw new Error(msg);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = `${payload.fileName}.docx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Step 7: fill the bid forms, check them against the tender, and download the bid pack. */
export default function BidForms({ state, setState, terms, goto }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const f = state.forms || {};
  const setField = (key, value) => setState((s) => ({ ...s, forms: { ...s.forms, [key]: value } }));
  const finance = useMemo(() => financeOf(state, terms), [state, terms]);
  const checks = bidChecks(state, terms);
  const issues = formIssues(state);
  const groups = [...new Set(FORM_FIELDS.map((x) => x.group))];

  return (
    <>
      <Section index="7" title="Bid forms" note="The bidder's particulars, the offer and the project, checked against the conditions in force"
        actions={(
          <button type="button" className="primary" disabled={saving} data-testid="seci-forms-download"
            onClick={async () => {
              setSaving(true); setError("");
              try { await downloadPack(bidPackRequest(state, finance, terms)); } catch (err) { setError(err.message); } finally { setSaving(false); }
            }}>
            {saving ? <Loader2 className="spin" size={14} /> : <Download size={14} />} Download bid pack (Word)
          </button>
        )}>
        {error && <div className="alert"><TriangleAlert size={14} /> {error}</div>}
        <p className="rtc-note">The RfS's own formats (Covering Letter, Format-7.1 and the rest) are in the main RfS, which was not provided; the bid pack is the filled data sheet for them, with every check and the clause it rests on.</p>
        {groups.map((g) => (
          <div key={g}>
            <div className="seci-group-title">{g}</div>
            <div className="seci-forms">
              {visibleFields(f).filter((x) => x.group === g).map((x) => (
                <label key={x.key} data-voice={`form.${x.key}`}>
                  <span>{x.label}{x.required ? " *" : ""}</span>
                  {x.type === "select" ? (
                    <select value={f[x.key] ?? ""} onChange={(e) => setField(x.key, e.target.value || null)} data-testid={`seci-form-${x.key}`}>
                      <option value="">Choose…</option>
                      {x.options.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                    </select>
                  ) : x.type === "textarea" ? (
                    <textarea rows={3} value={f[x.key] ?? ""} onChange={(e) => setField(x.key, e.target.value)} data-testid={`seci-form-${x.key}`} />
                  ) : (
                    <input type={x.type} step={x.step} value={f[x.key] ?? ""} data-testid={`seci-form-${x.key}`}
                      onChange={(e) => setField(x.key, x.type === "number" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value)} />
                  )}
                  {x.key === "tariff" && finance && (
                    <button type="button" className="rtc-reset" onClick={() => setField("tariff", Math.ceil(finance.tariff * 100) / 100)} data-testid="seci-form-use-tariff">
                      Use ₹{nf(Math.ceil(finance.tariff * 100) / 100, 2)}/kWh (target IRR, rounded up)
                    </button>
                  )}
                  {x.key === "tariff" && <QuoteCheck state={state} terms={terms} tariff={f.tariff ?? null} compact testid="seci-quote" />}
                  {x.hint && <small>{x.hint}</small>}
                </label>
              ))}
            </div>
          </div>
        ))}
      </Section>

      <Section index="7.1" title="Checks" note={issues.length ? `${issues.length} required field${issues.length > 1 ? "s" : ""} still empty` : "Every required field is filled"}>
        {!state.lp && <p className="rtc-note">Size the plant first (step 5): the storage, EMD, PBG and net worth checks need the installed capacity. <button type="button" className="rtc-reset" onClick={() => goto("size")}>Go to sizing</button></p>}
        <div className="seci-checks" data-testid="seci-checks">
          {checks.map((c) => {
            const Icon = ICON[c.status];
            return (
              <div key={c.id} data-testid={`seci-check-${c.id}`}>
                <strong>{c.label}</strong>
                <span>{c.detail} <SourceChip source={prov(c.condition)} compact /></span>
                <span className={`bid-check ${CLS[c.status]}`}><Icon size={14} /> {{ ok: "OK", bad: "Not met", warn: "Check", todo: "To do" }[c.status]}</span>
              </div>
            );
          })}
        </div>
        <p className="rtc-note">{PACK.short}: bidders within L1 + 2% of the lowest tariff win; the tariff is fixed for the term.</p>
      </Section>
    </>
  );
}
