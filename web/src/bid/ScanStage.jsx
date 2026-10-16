import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, CalendarDays, CheckCircle2, CircleDollarSign, FileText, Loader2, RotateCcw, Scale, ShieldAlert, SkipForward, UserCheck } from "lucide-react";
import { nf } from "../rtc/ui";
import { SCAN_AGENTS, agentCoverage, agentFindings, readingHead } from "./scanAgents";

const ICONS = { dates: CalendarDays, eligibility: UserCheck, constraints: Scale, finance: CircleDollarSign, risks: ShieldAlert };
const MIN_TOTAL_MS = 5500; // the scan runs at least this long from the upload
const MIN_SCAN_MS = 4500; // and at least this long once the document's text is on screen
const REVEAL_AGENT_MS = 420;
const REVEAL_CHIP_MS = 110;
const SUMMARY_MS = 1700;
const EXIT_MS = 650;
const VISIBLE_LINES = 9;

function reducedMotion() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** A line of the tender with its matched phrases marked. */
function Marked({ text, hits }) {
  const parts = [];
  let at = 0;
  for (const [s, e] of hits || []) {
    if (s < at) continue;
    if (s > at) parts.push(text.slice(at, s));
    parts.push(<mark key={s}>{text.slice(s, e)}</mark>);
    at = e;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

function AgentScreen({ agent, lines, phase, findings, shown, coverage, speed }) {
  const [tick, setTick] = useState(0);
  const scanning = phase === "scanning" || (phase === "locking" && shown === 0);
  useEffect(() => {
    if (!scanning || !lines.length) return undefined;
    const id = setInterval(() => setTick((t) => t + 1), speed);
    return () => clearInterval(id);
  }, [scanning, lines.length, speed]);
  const Icon = ICONS[agent.id] || FileText;
  const n = lines.length;
  const visible = n ? Array.from({ length: Math.min(VISIBLE_LINES, tick + 1) }, (_, k) => {
    const i = tick - Math.min(VISIBLE_LINES, tick + 1) + 1 + k;
    return { ...lines[i % n], key: i };
  }) : [];
  const current = visible[visible.length - 1];
  const done = phase === "locking" || phase === "summary" || phase === "exit";
  const revealed = findings.slice(0, shown);
  let status;
  if (phase === "opening") status = "waiting for pages";
  else if (!done) status = current ? `scanning p. ${current.page}` : "scanning";
  else if (shown < findings.length || (shown === 0 && findings.length)) status = "locking in";
  else status = findings.length ? `done · ${findings.length} finding${findings.length > 1 ? "s" : ""}` : "done";
  const silent = done && shown >= findings.length && findings.length === 0;
  return (
    <section className={`scan-agent ${done ? "done" : ""}`} style={{ "--agent": agent.color }} data-testid={`scan-agent-${agent.id}`}>
      <header>
        <span className="scan-agent-icon"><Icon size={14} /></span>
        <strong>{agent.title}</strong>
        <em className={done && shown >= findings.length ? "ok" : ""}>
          {done && shown >= findings.length ? <CheckCircle2 size={12} /> : <span className="scan-dot" />} {status}
        </em>
      </header>
      <div className="scan-term" aria-hidden={done}>
        {phase === "opening" && <p className="scan-wait">opening the document<span className="scan-caret" /></p>}
        {phase !== "opening" && !n && <p className="scan-wait">no passage on this subject in the text</p>}
        {visible.map((line) => (
          <p key={line.key} className="scan-line" data-testid="scan-line" data-page={line.page}>
            <b>p.{line.page}</b> <Marked text={line.text} hits={line.hits} />
          </p>
        ))}
      </div>
      {done && (
        <ul className="scan-findings">
          {revealed.map((f) => (
            <li key={f.path} className={`scan-finding ${f.kind}`} data-testid="scan-finding">
              <span>{f.label}</span> <strong>{f.text}</strong>{f.page ? <small>p. {f.page}</small> : null}
            </li>
          ))}
          {silent && (
            <li className="scan-finding none" data-testid="scan-none">
              {coverage === "not_read" ? "Not read: the rule-based reader leaves this to the model reading" : "Not stated in this document"}
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

/**
 * The scan screen shown while a new tender is read: five agents scroll the tender's own text
 * (the engine's preview) and then lock in what the reading found, each with its page. Calls
 * onFinish() when it has closed; the reading itself comes from the caller (outcome).
 */
export default function ScanStage({ file, job, outcome, error, onFinish, onRetry, onCancel }) {
  const [now, setNow] = useState(() => Date.now());
  const started = useRef(Date.now());
  const scanFrom = useRef(null);
  const lockedAt = useRef(null);
  const [fast, setFast] = useState(() => reducedMotion());
  const finished = useRef(false);
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;
  const exitTimer = useRef(null);
  useEffect(() => () => clearTimeout(exitTimer.current), []);

  const preview = job?.preview || null;
  if (preview && scanFrom.current === null) scanFrom.current = Date.now();
  const result = outcome?.result || null;
  const findings = useMemo(() => agentFindings(result), [result]);
  const coverage = useMemo(() => (result ? agentCoverage(result) : {}), [result]);
  const head = useMemo(() => readingHead(result), [result]);

  useEffect(() => {
    if (error) return undefined;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [error]);

  // the reveal: agents one after another, their findings chip by chip
  const counts = SCAN_AGENTS.map((a) => findings[a.id].length);
  const revealSpan = SCAN_AGENTS.reduce((t, a, i) => Math.max(t, i * REVEAL_AGENT_MS + Math.max(1, Math.min(counts[i], 8)) * REVEAL_CHIP_MS), 0) + 400;

  let phase = "opening";
  if (preview || result) phase = "scanning";
  const scanLong = scanFrom.current === null || now - scanFrom.current >= MIN_SCAN_MS;
  if (result && now - started.current >= MIN_TOTAL_MS && scanLong) {
    if (lockedAt.current === null) lockedAt.current = now;
    const t = now - lockedAt.current;
    phase = t < revealSpan ? "locking" : t < revealSpan + SUMMARY_MS ? "summary" : "exit";
  }
  if (fast && result) phase = "exit";

  // once: the exit animation plays, then the caller opens the workflow (cleared on unmount only)
  useEffect(() => {
    if (finished.current || phase !== "exit") return;
    finished.current = true;
    exitTimer.current = setTimeout(() => onFinishRef.current(), fast ? 0 : EXIT_MS);
  }, [phase, fast]);

  const shownFor = (i) => {
    if (lockedAt.current === null) return 0;
    const t = now - lockedAt.current - i * REVEAL_AGENT_MS;
    if (phase === "summary" || phase === "exit") return counts[i];
    return t < 0 ? 0 : Math.min(counts[i], 1 + Math.floor(t / REVEAL_CHIP_MS));
  };

  // the document panel follows the pages the agents are reading
  const pageLines = useMemo(() => {
    const all = Object.values(preview?.agents || {}).flat().map((l) => l.page);
    return [...new Set(all)].sort((a, b) => a - b);
  }, [preview]);
  const pages = preview?.pages ?? result?.document?.pages ?? null;
  const settled = phase === "locking" || phase === "summary" || phase === "exit";
  const pageNow = settled ? pages : pageLines.length ? pageLines[Math.floor((now - (scanFrom.current || now)) / 140) % pageLines.length] : null;
  const step = job?.progress?.step || (job?.status === "queued" ? "Queued" : "Uploading");
  const seconds = Math.max(0, Math.floor((now - started.current) / 1000));

  if (error) {
    return (
      <div className="scan-stage scan-error" data-testid="scan-stage">
        <div className="scan-error-card">
          <AlertTriangle size={22} />
          <h2>The tender could not be read</h2>
          <p>{error}</p>
          <div className="scan-error-actions">
            <button type="button" className="primary" onClick={onRetry} data-testid="scan-retry"><RotateCcw size={14} /> Try again</button>
            <button type="button" className="secondary" onClick={onCancel} data-testid="scan-back"><ArrowLeft size={14} /> Back to the start</button>
          </div>
        </div>
      </div>
    );
  }

  if (fast) {
    return (
      <div className="scan-stage scan-fast" data-testid="scan-stage">
        <div className="scan-error-card">
          <Loader2 className="spin" size={22} />
          <h2>Reading {file?.name}</h2>
          <p>{step}{pages ? ` · ${nf(pages, 0)} pages` : ""}</p>
          <button type="button" className="secondary" onClick={onCancel} data-testid="scan-back"><ArrowLeft size={14} /> Back to the start</button>
        </div>
      </div>
    );
  }

  return (
    <div className={`scan-stage phase-${phase}`} data-testid="scan-stage" data-phase={phase}>
      <header className="scan-head">
        <div>
          <span className="scan-kicker">TenderOS · reading the tender</span>
          <strong>{file?.name}</strong>
          <small>{file ? `${nf(file.size / 1024 / 1024, 1)} MB` : ""}{pages ? ` · ${nf(pages, 0)} pages` : ""} · {step} · {seconds}s</small>
        </div>
        <div className="scan-head-tools">
          <button type="button" className="secondary" onClick={() => setFast(true)} data-testid="scan-skip"><SkipForward size={14} /> Skip animation</button>
          <button type="button" className="secondary" onClick={onCancel} data-testid="scan-cancel">Cancel</button>
        </div>
      </header>

      <div className="scan-grid">
        <section className="scan-doc" data-testid="scan-doc">
          <header><span className="scan-agent-icon"><FileText size={14} /></span><strong>Document</strong></header>
          <div className="scan-doc-page">
            <span>{settled ? "pages read" : "page"}</span>
            <b data-testid="scan-page">{pageNow ? nf(pageNow, 0) : "–"}</b>
            <span>{settled ? `${nf(preview?.text_pages ?? result?.document?.text_pages ?? 0, 0)} with a text layer` : `of ${pages ? nf(pages, 0) : "…"}`}</span>
          </div>
          <div className="scan-doc-strip" aria-hidden>
            {pages ? Array.from({ length: Math.min(pages, 60) }, (_, i) => {
              const at = pageNow && pages ? Math.floor(((pageNow - 1) / pages) * Math.min(pages, 60)) : -1;
              return <i key={i} className={i === at ? "on" : i < at ? "past" : ""} />;
            }) : null}
          </div>
          <p className="scan-doc-note">{preview ? (preview.text_pages < preview.pages ? `${nf(preview.pages - preview.text_pages, 0)} scanned pages: their text cannot be read` : "every page has a text layer") : "opening the document"}</p>
        </section>
        {SCAN_AGENTS.map((agent, i) => (
          <AgentScreen key={agent.id} agent={agent} lines={preview?.agents?.[agent.id] || []} phase={phase}
            findings={findings[agent.id]} shown={shownFor(i)} coverage={coverage[agent.id]} speed={170 + i * 23} />
        ))}
      </div>

      {(phase === "summary" || phase === "exit") && result && (
        <div className="scan-summary" data-testid="scan-summary">
          <span className="scan-kicker">Reading complete</span>
          <strong>{head.number || file?.name}</strong>
          <p>
            {head.pages ? `${nf(head.pages, 0)} pages · ` : ""}{head.found} fields read · {head.allLocated ? "every value on its page" : `${head.located} of ${head.found} values located on their page`}
          </p>
        </div>
      )}
    </div>
  );
}
