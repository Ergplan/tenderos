import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, FilePlus2, FolderOpen, Loader2, Sparkles } from "lucide-react";
import { Section, nf } from "../rtc/ui";
import { AllFields, PROVIDER_LABEL, ReadingBanner, TenderRequirements } from "./RequirementsStep";
import PreBidQueries from "./PreBidQueries";
import TenderSet from "./TenderSet";
import { getJson, readTenderFile } from "./readTender";

/** Step 1: the tender, every requirement on one page, and opening another tender. */
export default function TenderStep({ state, setState, onRead, onModelRead, goto, onNewTender }) {
  const [status, setStatus] = useState(null);
  const [job, setJob] = useState(null); // { status, progress, error }
  const [error, setError] = useState("");
  const cancelled = useRef(false);
  const modelRef = useRef(null);
  const [recent, setRecent] = useState(null);
  const [opening, setOpening] = useState("");

  async function loadRecent() {
    try {
      setRecent((await getJson("/api/tenders")).tenders || []);
    } catch {
      setRecent([]);
    }
  }
  useEffect(() => { loadRecent(); }, []);

  async function openSaved(item) {
    setOpening(item.id);
    setError("");
    try {
      const { tender } = await getJson(`/api/tenders/${item.id}`);
      onRead({ name: tender.file_name, readAt: tender.created_at, result: tender.result, savedId: tender.id, seedKey: tender.seed_key || null });
    } catch (err) {
      setError(err.message);
    } finally {
      setOpening("");
    }
  }

  useEffect(() => {
    cancelled.current = false;
    getJson("/api/bid/tender/status").then(setStatus).catch(() => setStatus({ llm_available: false, default_mode: "rules", unavailable: true }));
    return () => { cancelled.current = true; };
  }, []);

  /** Read a file with the tender engine (background job), save the reading, return it. */
  function runRead(f, readMode, type) {
    return readTenderFile(f, { mode: readMode, type, onUpdate: setJob, isCancelled: () => cancelled.current, pollMs: 1200 });
  }

  /** The model reading of the open tender's PDF fills every field the rule-based reading has not. */
  async function fillWithModel(f) {
    setError("");
    setJob({ status: "uploading", progress: { done: 0, total: 1, step: "Uploading" } });
    try {
      const base = state.tender?.baseResult || state.tender?.result;
      const out = await runRead(f, "llm", base?.tender_type || "auto");
      if (!out) return;
      const number = (r) => r?.values?.["core.identity.tender_number"];
      const sameDoc = out.result.document?.sha256 === base?.document?.sha256 || (number(out.result) && number(out.result) === number(base));
      if (!sameDoc) throw new Error(`This PDF is a different tender (${number(out.result) || out.result.document?.name}); choose the ${number(base) || "open tender's"} RFP.`);
      onModelRead(out.result, out.savedId);
      setJob(null);
      loadRecent();
    } catch (err) {
      setJob(null);
      setError(err.message);
    }
  }

  const busy = Boolean(job);
  const p = job?.progress;
  const share = p?.total ? Math.min(1, (p.done || 0) / p.total) : 0;
  const last = state.tender?.result;
  const values = last?.values || {};
  const summaryField = last?.sections?.flatMap((s) => s.fields).find((f) => f.path === "core.summary.plain_english_summary");
  const summary = summaryField && (summaryField.status === "validated" || summaryField.status === "needs_review") && summaryField.value ? summaryField : null;
  const summaryPages = summary ? [...new Set((summary.evidence || []).map((e) => e.page))].sort((a, b) => a - b) : [];

  return (
    <>
      <Section index="1" title="Tender" note={last ? `${nf(last.document?.pages)} pages · ${nf(last.counts?.found)} fields read` : ""}
        actions={last ? (
          <>
            {last.mode === "rules" && status?.llm_available && (
              <button type="button" className="secondary" onClick={() => modelRef.current?.click()} disabled={busy} data-testid="bid-fill-model"
                title="Choose the tender's PDF: the tender engine's model reads every section; fields the rule-based reading found are kept">
                {busy ? <Loader2 className="spin" size={14} /> : <Sparkles size={14} />} Fill every section with the model{status?.provider ? ` (${PROVIDER_LABEL[status.provider] || status.provider})` : ""}
              </button>
            )}
            <button type="button" className="primary" onClick={() => goto("dates")} data-testid="bid-to-dates">Key dates <ArrowRight size={14} /></button>
          </>
        ) : null}>
        <input ref={modelRef} type="file" accept=".pdf" hidden data-testid="bid-model-file"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) fillWithModel(f); e.target.value = ""; }} />
        {!last && <p className="rtc-note">No tender is loaded. Open one from the list below or start with a new one.</p>}
        {last && (
          <div className="bid-read-summary" data-testid="bid-tender-head">
            <div className="bid-read-title">
              <strong>{values["core.identity.issuing_agency"] || state.tender.name}</strong>
              {values["core.identity.tender_number"] && <span className="bid-chip">{values["core.identity.tender_number"]}</span>}
            </div>
            {values["core.identity.title"] && <p>{values["core.identity.title"]}</p>}
            <ReadingBanner result={last} />
            {summary && (
              <div className="bid-summary" data-testid="bid-summary">
                {summary.value.split(/\n\s*\n/).map((para, i) => <p key={i}>{para}</p>)}
                <p className="rtc-note">From the tender, pages {summaryPages.join(", ")}: every figure is quoted on its page (Everything read from the tender → Summary).</p>
              </div>
            )}
            {last.mode === "rules" && (
              <p className="rtc-note">The rule-based reader reads the figures the sizing needs; summary, eligibility, penalties and other clauses are read by the model.
                {status?.llm_available ? " Click “Fill every section with the model” and choose the RFP PDF (a few minutes)." : " Set a model key on the engine to read them."}</p>
            )}
            {busy && (
              <div className="bid-progress" role="status">
                <div className="bid-progress-bar"><i style={{ width: `${Math.round(share * 100)}%` }} /></div>
                <span><Loader2 className="spin" size={13} /> {p?.step || job.status} {p?.total > 1 ? `· ${p.done} of ${p.total}` : ""}</span>
              </div>
            )}
            {error && <div className="alert"><AlertTriangle size={14} /> {error}</div>}
          </div>
        )}
      </Section>

      {last?.tender_set && <TenderSet result={last} />}

      {last && (
        <Section index="1.1" title="What the tender requires" note="Every requirement the sizing applies, with the page and quote it comes from">
          <TenderRequirements result={last} accepted={state.accepted || {}} setAccepted={(accepted) => setState((s) => ({ ...s, accepted, lp: null }))} />
        </Section>
      )}

      {last && <PreBidQueries result={last} prebid={state.prebid} setPrebid={(fn) => setState((s) => ({ ...s, prebid: fn(s.prebid || {}) }))} />}

      {last && <AllFields result={last} />}

      <Section index="1.4" title="Another tender" note="Open a tender read before, or upload a new one"
        actions={<button type="button" className="secondary" onClick={onNewTender} data-testid="bid-new-tender"><FilePlus2 size={14} /> New tender</button>}>
        {recent === null && <p className="rtc-note"><Loader2 className="spin" size={13} /> Loading</p>}
        {recent?.length > 0 && (
          <div className="bid-recent" role="table" data-testid="bid-recent">
            <div className="bid-recent-row head" role="row"><span>Tender</span><span>Issuer</span><span>Capacity</span><span>Reading</span><span>Read</span><span /></div>
            {recent.map((t) => (
              <div key={t.id} className={`bid-recent-row ${state.tender?.savedId === t.id ? "current" : ""}`} role="row" data-testid={`recent-${t.seed_key || t.id}`}>
                <span><strong>{t.tender_number || t.file_name}</strong><small>{t.title || t.file_name}</small></span>
                <span>{t.issuer || "–"}</span>
                <span>{t.capacity_mw ? `${nf(t.capacity_mw, 0)} MW` : "–"}</span>
                <span><span className={`bid-chip ${t.mode === "llm" ? "" : "warn"}`}>{t.mode === "llm" ? "Model reading" : "Rule-based"}</span><small>{t.found ?? "–"} of {t.fields ?? "–"} fields</small></span>
                <span><small>{t.seed_key ? "Built in" : (t.created_by_name || t.created_by_email || "")}</small><small>{new Date(t.created_at).toLocaleDateString()}</small></span>
                <span><button type="button" className="secondary" onClick={() => openSaved(t)} disabled={Boolean(opening) || busy || state.tender?.savedId === t.id}>{opening === t.id ? <Loader2 className="spin" size={13} /> : <FolderOpen size={13} />} {state.tender?.savedId === t.id ? "Open now" : "Open"}</button></span>
              </div>
            ))}
          </div>
        )}
        {busy && (
          <div className="bid-progress" role="status">
            <div className="bid-progress-bar"><i style={{ width: `${Math.round(share * 100)}%` }} /></div>
            <span><Loader2 className="spin" size={13} /> {p?.step || job.status} {p?.total > 1 ? `· ${p.done} of ${p.total}` : ""}</span>
          </div>
        )}
        {error && <div className="alert"><AlertTriangle size={14} /> {error}</div>}
      </Section>
    </>
  );
}
