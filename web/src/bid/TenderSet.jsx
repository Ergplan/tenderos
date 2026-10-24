import React, { useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { Section, nf } from "../rtc/ui";
import { searchTenderSet } from "./readTender";

const ROLE_LABEL = { rfs: "RfS", amendment: "Amendment", clarification: "Clarifications", agreement: "Agreement", other: "Other" };
const KIND_LABEL = { modified: "Modified", added: "Added", deleted: "Deleted", replaced: "Replaced" };
const VERDICT_LABEL = { amended: "Amended", unchanged: "Unchanged", refer: "Refers to a clause", answered: "Answered" };
const TABS = [
  ["documents", "Documents"],
  ["amended", "Amended terms"],
  ["changes", "Changes"],
  ["clarifications", "Clarifications"],
  ["formats", "Bid formats"],
  ["process", "Bid process"],
  ["search", "Search"],
];

/** "p. 3 of Amendment-01" for an evidence item. */
function Where({ evidence, titles }) {
  if (!evidence) return null;
  return (
    <small className={`set-where ${evidence.located === false ? "unlocated" : ""}`} title={evidence.located === false ? "This quote was not found on the page" : "Quoted from the page"}>
      p. {evidence.page} · {titles[evidence.doc] || evidence.doc}
    </small>
  );
}

function Quote({ evidence, titles }) {
  if (!evidence?.quote) return null;
  return (
    <blockquote className="set-quote">
      “{evidence.quote}” <Where evidence={evidence} titles={titles} />
    </blockquote>
  );
}

function Diff({ runs }) {
  return (
    <p className="set-diff">
      {runs.map(([op, text], i) => (
        op === "=" ? <span key={i}>{text} </span> : op === "-" ? <del key={i}>{text}</del> : <ins key={i}>{text}</ins>
      ))}
    </p>
  );
}

function Documents({ set }) {
  return (
    <div className="set-table" role="table">
      <div className="set-row head docs" role="row"><span>Document</span><span>Role</span><span>Reference</span><span>Date</span><span>Pages</span><span>Tables read by</span></div>
      {set.documents.map((d) => (
        <div key={d.id} className="set-row docs" role="row" data-testid="set-doc-row">
          <span><strong>{d.title}</strong><small>{d.name}</small></span>
          <span><span className="bid-chip">{ROLE_LABEL[d.role] || d.role}{d.role === "agreement" ? ` · ${d.kind.toUpperCase()}` : ""}</span></span>
          <span><small>{d.ref || d.rfs_no || "–"}</small></span>
          <span>{d.date || "–"}</span>
          <span>{nf(d.pages, 0)}{d.scanned_pages?.length ? <small>{d.scanned_pages.length} scanned</small> : null}</span>
          <span><small>{d.layout === "docling" ? "Docling" : d.layout === "pymupdf" ? "PyMuPDF tables" : "–"}</small></span>
        </div>
      ))}
    </div>
  );
}

function Amended({ result, titles }) {
  const fields = (result.sections || []).flatMap((s) => s.fields).filter((f) => f.history?.length);
  if (!fields.length) return <p className="rtc-note">No field the reading found is touched by the amendments.</p>;
  return (
    <div className="set-list">
      {fields.map((f) => {
        const first = f.history[0];
        const last = f.history[f.history.length - 1];
        const changed = f.history.some((h) => h.now && !h.same_value) || f.status === "withdrawn";
        return (
          <article key={f.path} className={`set-card ${changed ? "changed" : ""}`} data-testid="set-amended-row">
            <header>
              <strong>{f.label}</strong>
              <span className={`bid-chip ${f.status === "validated" ? "" : "warn"}`}>{f.status === "withdrawn" ? "Withdrawn" : f.status === "validated" ? "Applied" : "Check"}</span>
            </header>
            <p className="set-was-now">
              <span><small>RfS</small>{first.was?.display || String(first.was?.value ?? "–")}</span>
              <span aria-hidden="true">→</span>
              <span><small>Now</small>{f.status === "withdrawn" ? "withdrawn" : f.display || String(f.value ?? "–")}</span>
            </p>
            <p className="rtc-note">
              {f.history.map((h) => `${titles[h.doc] || h.doc} ${h.clause}${h.now ? (h.same_value ? " (same value)" : "") : " (not re-read)"}`).join(" · ")}
            </p>
            {last.now?.evidence?.[0] && <Quote evidence={last.now.evidence[0]} titles={titles} />}
            {(f.issues || []).filter((i) => i.rule === "amended").map((i) => <p key={i.message} className="set-issue">{i.message}</p>)}
          </article>
        );
      })}
    </div>
  );
}

function Changes({ set, titles }) {
  const [target, setTarget] = useState("");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(null);
  const targets = [...new Set(set.changes.map((c) => c.document))];
  const q = query.trim().toLowerCase();
  const shown = set.changes.filter((c) => (!target || c.document === target)
    && (!q || `${c.clause} ${c.effect} ${c.before.text} ${c.after.text}`.toLowerCase().includes(q)));
  return (
    <>
      <div className="set-filters">
        <select value={target} onChange={(e) => setTarget(e.target.value)} data-testid="set-change-target">
          <option value="">Every document ({set.changes.length})</option>
          {targets.map((t) => <option key={t} value={t}>{t} ({set.changes.filter((c) => c.document === t).length})</option>)}
        </select>
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by clause or words" />
      </div>
      <div className="set-table" role="table">
        <div className="set-row head changes" role="row"><span>Amendment</span><span>Clause</span><span>Kind</span><span>Effect</span></div>
        {shown.map((c) => (
          <React.Fragment key={c.id}>
            <button type="button" className={`set-row changes ${open === c.id ? "open" : ""}`} onClick={() => setOpen(open === c.id ? null : c.id)} data-testid="set-change-row">
              <span><strong>{titles[c.doc] || c.doc}</strong><small>S. No. {c.sno}</small></span>
              <span>{c.document} {c.clause}</span>
              <span><span className={`bid-chip ${c.kind === "deleted" ? "warn" : ""}`}>{KIND_LABEL[c.kind] || c.kind}</span></span>
              <span>{c.effect}</span>
            </button>
            {open === c.id && (
              <div className="set-detail" data-testid="set-change-detail">
                {c.before.text && c.after.text && !c.merged && <Diff runs={c.diff} />}
                <div className="set-columns">
                  <div><h4>Was</h4>{c.before.text ? <p>{c.before.text}</p> : <p className="rtc-note">Not quoted in the amendment: read the clause in the {c.document}.</p>}
                    {c.before.evidence.map((e, i) => <Where key={i} evidence={e} titles={titles} />)}</div>
                  <div><h4>Now</h4><p>{c.after.text || "–"}</p>{c.after.evidence.map((e, i) => <Where key={i} evidence={e} titles={titles} />)}</div>
                </div>
              </div>
            )}
          </React.Fragment>
        ))}
      </div>
    </>
  );
}

function Clarifications({ set, titles }) {
  if (!set.clarifications.length) return <p className="rtc-note">No clarifications in this set.</p>;
  return (
    <div className="set-list">
      {set.clarifications.map((c) => (
        <article key={c.id} className="set-card" data-testid="set-clar-row">
          <header>
            <strong>{titles[c.doc] || c.doc} · {c.no}. {c.document} {c.clause}</strong>
            <span className={`bid-chip ${c.verdict === "unchanged" ? "warn" : ""}`}>{VERDICT_LABEL[c.verdict] || c.verdict}</span>
          </header>
          <p><small className="set-label">Asked</small>{c.request || c.existing || "–"}</p>
          <p><small className="set-label">Response</small>{c.response || "–"}</p>
          <Where evidence={c.evidence.response?.[0]} titles={titles} />
          {c.changes.length > 0 && <p className="rtc-note">Same clause amended: {c.changes.map((id) => set.changes.find((x) => x.id === id)).filter(Boolean).map((x) => `${titles[x.doc] || x.doc} (${x.document} ${x.clause})`).join(", ")}</p>}
        </article>
      ))}
    </div>
  );
}

function Formats({ set, titles }) {
  const [open, setOpen] = useState(null);
  return (
    <div className="set-table" role="table">
      <div className="set-row head formats" role="row"><span>Format</span><span>Pages</span><span>Printed on</span><span>Applies</span><span>Blanks</span></div>
      {set.formats.map((f) => (
        <React.Fragment key={f.id}>
          <button type="button" className={`set-row formats ${open === f.id ? "open" : ""}`} onClick={() => setOpen(open === f.id ? null : f.id)} data-testid="set-format-row">
            <span><strong>{f.id}</strong><small>{f.title}</small></span>
            <span>{f.pages[0] === f.pages[1] ? f.pages[0] : `${f.pages[0]}–${f.pages[1]}`}</span>
            <span><small>{f.paper || "–"}</small></span>
            <span><small>{f.applies}</small></span>
            <span>{f.blank_count}</span>
          </button>
          {open === f.id && (
            <div className="set-detail" data-testid="set-format-detail">
              <Quote evidence={f.heading} titles={titles} />
              {f.submitted_by && <p className="rtc-note">Provided by: {f.submitted_by}</p>}
              {f.blanks.length === 0 ? <p className="rtc-note">No blanks to fill.</p> : (
                <ol className="set-blanks">
                  {f.blanks.map((b, i) => (
                    <li key={i}><strong>{b.label}</strong> <span className="bid-chip">{b.kind}</span>{b.maps && <span className="bid-chip">fills from {b.maps}</span>} <small>p. {b.page}</small><small className="set-context">{b.context}</small></li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

function Process({ set, titles }) {
  const { information = [], steps = [] } = set.process || {};
  return (
    <>
      {information.length > 0 && (
        <div className="set-table" role="table" data-testid="set-bis">
          <div className="set-row head info" role="row"><span>Bid Information Sheet</span><span>As printed</span></div>
          {information.map((r) => (
            <div key={r.item} className="set-row info" role="row"><span><strong>({r.item})</strong> {r.label}</span><span>{r.value} <Where evidence={r.evidence} titles={titles} /></span></div>
          ))}
        </div>
      )}
      <ol className="set-steps">
        {steps.map((s) => (
          <li key={s.key} data-testid="set-step">
            <strong>{s.step}</strong>
            {s.sources.map((src, i) => <Quote key={i} evidence={src} titles={titles} />)}
          </li>
        ))}
      </ol>
    </>
  );
}

function highlight(text, query) {
  const words = [...new Set(query.toLowerCase().split(/\W+/).filter((w) => w.length > 2))];
  if (!words.length) return text;
  const pattern = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return text.split(pattern).map((part, i) => (words.includes(part.toLowerCase()) ? <mark key={i}>{part}</mark> : part));
}

function SetSearch({ set, titles }) {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("");
  const [hits, setHits] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(e) {
    e.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    setError("");
    try {
      setHits((await searchTenderSet(set.jobId, query, { role, k: 12 })).hits);
    } catch (err) {
      setHits(null);
      setError(/Unknown job|not a finished/.test(err.message) ? "Search runs on the engine's reading, kept for 24 hours; read the set again to search it." : err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <form className="set-filters" onSubmit={run}>
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search every page: EMD, e-reverse auction, peak hours …" data-testid="set-search-input" />
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">All documents</option>
          {[...new Set(set.documents.map((d) => d.role))].map((r) => <option key={r} value={r}>{ROLE_LABEL[r] || r}</option>)}
        </select>
        <button type="submit" className="secondary" disabled={busy || !query.trim()} data-testid="set-search-go">{busy ? <Loader2 className="spin" size={14} /> : <Search size={14} />} Search</button>
      </form>
      {error && <div className="alert">{error}</div>}
      {hits && hits.length === 0 && <p className="rtc-note">Nothing found.</p>}
      {hits && hits.length > 0 && (
        <ol className="set-hits">
          {hits.map((h, i) => (
            <li key={i} data-testid="set-search-hit">
              <small className="set-where">p. {h.page} · {titles[h.doc] || h.doc}</small>
              <p>{highlight(h.text, query)}</p>
            </li>
          ))}
        </ol>
      )}
      <p className="rtc-note">{nf(set.search?.passages || 0, 0)} passages of every page, ranked by BM25 (Haystack).</p>
    </>
  );
}

/** The tender set behind the open tender: documents, the amendments applied to the RfS, every
 * change and clarification, the bid formats and process, and search over every page. */
export default function TenderSet({ result }) {
  const set = result?.tender_set;
  const [tab, setTab] = useState("amended");
  const titles = useMemo(() => Object.fromEntries((set?.documents || []).map((d) => [d.id, d.title])), [set]);
  if (!set) return null;
  const c = set.counts || {};
  const note = `${c.documents} documents · ${c.changes} changes · ${c.clarifications} clarifications · ${c.amended_fields} terms amended · ${c.formats} formats`;
  const counts = { documents: c.documents, amended: c.amended_fields, changes: c.changes, clarifications: c.clarifications, formats: c.formats, process: c.steps };
  return (
    <Section index="1.0" title="Tender set" note={note} className="tender-set">
      <div data-testid="tender-set">
        <div className="set-tabs" role="tablist">
          {TABS.map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? "active" : ""} onClick={() => setTab(key)} data-testid={`set-tab-${key}`}>
              {label}{counts[key] !== undefined ? <small>{counts[key]}</small> : null}
            </button>
          ))}
        </div>
        {set.warnings?.length > 0 && <ul className="bid-warnings">{set.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
        {tab === "documents" && <Documents set={set} />}
        {tab === "amended" && <Amended result={result} titles={titles} />}
        {tab === "changes" && <Changes set={set} titles={titles} />}
        {tab === "clarifications" && <Clarifications set={set} titles={titles} />}
        {tab === "formats" && <Formats set={set} titles={titles} />}
        {tab === "process" && <Process set={set} titles={titles} />}
        {tab === "search" && <SetSearch set={set} titles={titles} />}
      </div>
    </Section>
  );
}
