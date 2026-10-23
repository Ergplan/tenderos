import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, ChevronLeft, CircleDollarSign, ClipboardCheck, FileStack, Gavel, Layers, ListChecks, RotateCcw, Scale, Zap } from "lucide-react";
import { nf } from "../rtc/ui";
import { loadMarketPrices, mergeBidState, missingInputs } from "../bid/model";
import useSizing from "../bid/useSizing";
import SourcesStep from "../bid/SourcesStep";
import SizeStep from "../bid/SizeStep";
import FinanceStep from "../bid/FinanceStep";
import { DEFAULT_SETTINGS, PACK, seciTerms } from "./terms";
import DocumentsStep from "./DocumentsStep";
import ConditionsStep from "./ConditionsStep";
import BidStep from "./BidStep";
import BidForms from "./BidForms";
import { formIssues } from "./forms";
import VoiceGuide from "./VoiceGuide";
import LiveAgent from "./LiveAgent";
import { TENDER, defaultSeciState } from "./state";

export { defaultSeciState };

const STORAGE_KEY = "tenderos.seci.v1";
export const SECI_STEPS = [
  { id: "documents", title: "Tender & amendments", icon: FileStack, color: "#d4ff3f" },
  { id: "conditions", title: "Bid conditions", icon: ListChecks, color: "#ff8a5f" },
  { id: "bid", title: "What you bid", icon: Scale, color: "#4fd1c5" },
  { id: "sources", title: "Supply sources", icon: Layers, color: "#3fa7d6" },
  { id: "size", title: "Size", icon: Zap, color: "#f5b83d" },
  { id: "finance", title: "Financials", icon: CircleDollarSign, color: "#7ddc9a" },
  { id: "forms", title: "Bid forms", icon: ClipboardCheck, color: "#a98bff" },
];

function loadState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSeciState();
    const saved = JSON.parse(raw);
    const merged = mergeBidState(saved);
    return {
      ...merged,
      tender: TENDER,
      step: SECI_STEPS.some((s) => s.id === saved.step) ? saved.step : "documents",
      seci: { ...DEFAULT_SETTINGS, ...(saved.seci || {}) },
      forms: saved.forms || {},
    };
  } catch {
    return defaultSeciState();
  }
}

// survive switching dashboard tabs
let sessionState = null;
const sizingSession = { hourly: null, run: null };

/**
 * SECI RTC-TM-V: the tender and its amendments, the bid conditions in force, what the bidder
 * offers, the supply sources and the HiGHS sizing against the time-block floors (the Tender to Bid
 * steps), the financial model with its formula workbook, the bid forms, and a voice guide that
 * walks through it all.
 */
export default function SeciTab() {
  const [state, setState] = useState(() => sessionState || loadState());
  const [prices, setPrices] = useState(null);
  const terms = useMemo(() => seciTerms(state.seci), [state.seci]);
  const missing = useMemo(() => missingInputs(state, terms), [state, terms]);
  const sizing = useSizing({ state, setState, terms, prices, session: sizingSession, module: "seci" });

  const [agent, setAgent] = useState(null); // { available, model, backendModel } from /api/seci/live
  useEffect(() => { loadMarketPrices().then(setPrices).catch(() => setPrices(null)); }, []);
  useEffect(() => {
    fetch("/api/seci/live", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).then(setAgent).catch(() => setAgent(null));
  }, []);
  useEffect(() => {
    sessionState = state;
    const id = setTimeout(() => {
      try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* storage full or blocked */ }
    }, 400);
    return () => clearTimeout(id);
  }, [state]);

  const patch = useCallback((section, values) => setState((s) => ({ ...s, [section]: { ...s[section], ...values } })), []);
  const set = useCallback((key, value) => setState((s) => ({ ...s, [key]: value })), []);
  const isLocked = (key) => Boolean(state.locks?.[key]);
  const lockProps = (key) => ({ locked: isLocked(key), onLock: () => setState((s) => ({ ...s, locks: { ...s.locks, [key]: !s.locks?.[key] } })) });
  const goto = useCallback((step) => {
    setState((s) => ({ ...s, step }));
    window.scrollTo?.({ top: 0, behavior: "smooth" });
  }, []);

  function resetAll() {
    if (!window.confirm("Clear your bid, sources, costs, sizing and bid forms in this tab?")) return;
    sizing.clear();
    setState(defaultSeciState());
  }

  const done = {
    documents: true,
    conditions: true,
    bid: state.bid.baseMw >= PACK.model.minBidMw && state.bid.baseMw <= PACK.model.maxBidMw,
    sources: missing.length === 0,
    size: Boolean(state.lp),
    finance: Boolean(state.lp),
    forms: Boolean(state.lp) && formIssues(state).length === 0,
  };
  const summary = {
    documents: `${PACK.documents.filter((d) => d.file).length} documents, ${PACK.changes.length} changes`,
    conditions: `${PACK.conditions.length} conditions`,
    bid: state.bid.baseMw ? `${nf(state.bid.baseMw, 0)} MW` : "Not entered",
    sources: missing.length ? `${missing.length} input${missing.length > 1 ? "s" : ""} needed` : "Ready to size",
    size: state.lp ? `₹${nf(state.lp.tariff, 3)}/kWh` : "Not sized",
    finance: state.lp ? "Tariff and returns" : "After sizing",
    forms: formIssues(state).length ? `${formIssues(state).length} to fill` : "Ready",
  };
  const index = SECI_STEPS.findIndex((s) => s.id === state.step);
  const step = SECI_STEPS[Math.max(0, index)];
  const next = SECI_STEPS[index + 1];
  const prev = SECI_STEPS[index - 1];
  const props = { state, setState, patch, set, lockProps, isLocked, goto, prices, terms, missing };

  return (
    <div className="rtc story bid seci" data-testid="seci-tab">
      <section className="story-hero">
        <div>
          <div className="eyebrow"><Gavel size={13} /> {PACK.short} · RfS No. {PACK.rfsNo}</div>
          <h1>RTC tender · SECI</h1>
          <p>{PACK.title}. The tender and its amendments, the conditions in force, what you bid, your supply sources sized against every peak and off-peak block, the financial model, and the bid forms. The voice guide can walk you through it.</p>
        </div>
        <div className="story-hero-tools">
          <button type="button" className="rtc-reset" onClick={resetAll}><RotateCcw size={13} /> Reset inputs</button>
        </div>
      </section>

      <nav className="bid-steps" aria-label="Steps">
        {SECI_STEPS.map((s, i) => {
          const Icon = s.icon;
          return (
            <button key={s.id} type="button" className={`bid-step ${state.step === s.id ? "active" : ""} ${done[s.id] ? "done" : ""}`} style={{ "--chapter": s.color }}
              onClick={() => goto(s.id)} aria-current={state.step === s.id ? "step" : undefined} data-testid={`seci-step-${s.id}`}>
              <span className="story-tab-icon"><Icon size={16} /></span>
              <span className="story-tab-text">
                <small>{String(i + 1).padStart(2, "0")}</small>
                <strong>{s.title}</strong>
                <em>{summary[s.id]}</em>
              </span>
            </button>
          );
        })}
      </nav>

      <div className="bid-page" style={{ "--chapter": step.color }} key={step.id}>
        {step.id === "documents" && <DocumentsStep />}
        {step.id === "conditions" && <ConditionsStep />}
        {step.id === "bid" && <BidStep {...props} />}
        {step.id === "sources" && <SourcesStep {...props} startSizing={sizing.startSizing} />}
        {step.id === "size" && <SizeStep {...props} run={sizing.run} startSizing={sizing.startSizing} stopSizing={sizing.stopSizing} hourly={sizing.hourly} startDispatch15={sizing.startDispatch15} />}
        {step.id === "finance" && <FinanceStep {...props} quoteTariff={state.forms?.tariff ?? null} onQuoteTariff={(v) => setState((s) => ({ ...s, forms: { ...s.forms, tariff: v } }))} />}
        {step.id === "forms" && <BidForms {...props} />}
      </div>

      <footer className="story-page-foot bid-foot">
        {prev ? <button type="button" className="secondary" onClick={() => goto(prev.id)}><ChevronLeft size={14} /> {prev.title}</button> : <span />}
        {next && <button type="button" className="primary chapter-next" onClick={() => goto(next.id)} style={{ "--next": next.color }}>Next: {next.title} <ArrowRight size={14} /></button>}
      </footer>

      <LiveAgent state={state} setState={setState} terms={terms} goto={goto} sizing={sizing} info={agent} />
      <VoiceGuide state={state} setState={setState} terms={terms} goto={goto} sizing={sizing} />
    </div>
  );
}
