import React, { useEffect, useState } from "react";
import { CheckCircle2, Download, FileUp, Inbox, Loader2, Mail, MailX, MessageSquare, RotateCcw, Send, ShieldCheck, UserPlus, Users, X, XCircle } from "lucide-react";
import { KIND_LABEL, currentValue, restOf } from "./apply";

const STATUS = { open: "Assigned", submitted: "Answered: to accept", returned: "Returned", accepted: "Accepted", cancelled: "Cancelled" };
const when = (t) => (t ? new Date(t).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "");

/** The answer form an assignee sees, by kind: a value, a signed copy, or a clarification. */
function AnswerForm({ a, team, state, letterFor }) {
  const [value, setValue] = useState(() => {
    const v = currentValue(state, a.target_key, a.context);
    return v === null || v === undefined ? "" : String(v);
  });
  const [note, setNote] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const doc = a.target_kind === "document";
  const clarify = a.target_kind === "condition";
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await team.act(a.id, "submit", { value: doc || clarify ? null : value, note }, file);
      setNote("");
      setFile(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="team-answer" onSubmit={submit} data-testid={`team-answer-${a.id}`}>
      {doc && letterFor && (
        <div className="team-row">
          <span>The filled letter, to print, sign and stamp:</span>
          <button type="button" className="secondary" onClick={() => letterFor(restOf(a.target_key), "pdf")} data-testid="team-letter-pdf"><Download size={12} /> PDF</button>
          <button type="button" className="secondary" onClick={() => letterFor(restOf(a.target_key), "word")}><Download size={12} /> Word</button>
        </div>
      )}
      {!doc && !clarify && (
        <label>{KIND_LABEL[a.target_kind]}{a.context?.unit ? ` (${a.context.unit})` : ""}
          <input value={value} onChange={(e) => setValue(e.target.value)} data-testid="team-answer-value" />
        </label>
      )}
      <label>{clarify ? "Clarification" : "Note"}
        <textarea rows={clarify ? 4 : 2} value={note} onChange={(e) => setNote(e.target.value)} data-testid="team-answer-note"
          placeholder={clarify ? "How the clause should be read, and on what basis" : "Basis, source or caveat (optional)"} />
      </label>
      <label className="team-file">{doc ? "Signed copy (PDF or image)" : "Attachment (optional)"}
        <input type="file" accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx" onChange={(e) => setFile(e.target.files?.[0] || null)} data-testid="team-answer-file" />
      </label>
      {error && <div className="alert">{error}</div>}
      <button type="submit" className="primary" disabled={busy} data-testid="team-answer-send">{busy ? <Loader2 className="spin" size={13} /> : <Send size={13} />} Send to the tender manager</button>
    </form>
  );
}

function Card({ a, team, state, onAccept, letterFor, focus }) {
  const me = team.me;
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const mine = ["open", "returned"].includes(a.status) && (a.assignee_id ? a.assignee_id === me?.id : a.team === me?.team);
  const run = async (kind, fn) => {
    setBusy(kind);
    setError("");
    try { await fn(); setNote(""); } catch (err) { setError(err.message); } finally { setBusy(""); }
  };
  const ans = a.answer || {};
  return (
    <article className={`team-card ${a.status} ${focus ? "focus" : ""}`} data-testid={`team-card-${a.target_key}`} id={`team-card-${a.id}`}>
      <header>
        <div>
          <small>{KIND_LABEL[a.target_kind]} · {team.teams?.[a.team]}{a.assignee_name ? ` · ${a.assignee_name}` : ""}{a.due_date ? ` · due ${String(a.due_date).slice(0, 10)}` : ""}</small>
          <b>{a.target_label}</b>
        </div>
        <span className={`team-status ${a.status}`} data-testid="team-status">{STATUS[a.status]}</span>
      </header>
      {a.request && <p className="team-request">“{a.request}” <em>{a.created_by_name}</em></p>}
      {a.context?.quote && <p className="rtc-note">RfS: “{a.context.quote}”{a.context.page ? ` p. ${a.context.page}` : ""}</p>}
      {a.status !== "accepted" && a.target_kind !== "document" && a.target_kind !== "condition" && (
        <p className="rtc-note">In the bid now: <b>{String(currentValue(state, a.target_key, a.context) ?? "empty")}</b>{a.context?.unit ? ` ${a.context.unit}` : ""}</p>
      )}
      {(ans.value !== undefined && ans.value !== null) || ans.note || a.file_id ? (
        <div className="team-given" data-testid="team-given">
          {ans.value !== null && ans.value !== undefined && <div>Answer: <b>{String(ans.value)}</b>{a.context?.unit ? ` ${a.context.unit}` : ""}</div>}
          {ans.note && <div>{ans.note}</div>}
          {a.file_id && <a href={`/api/team/files/${a.file_id}`} data-testid="team-file"><Download size={12} /> {a.file_name}</a>}
          <small>{ans.by} · {when(ans.at)}</small>
        </div>
      ) : null}
      {mine && <AnswerForm a={a} team={team} state={state} letterFor={letterFor} />}
      {me?.super_admin && a.status === "submitted" && (
        <div className="team-actions">
          <button type="button" className="primary" disabled={Boolean(busy)} onClick={() => run("accept", () => onAccept(a))} data-testid="team-accept">
            {busy === "accept" ? <Loader2 className="spin" size={13} /> : <CheckCircle2 size={13} />} Accept into the bid
          </button>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What is needed (to return)" data-testid="team-return-note" />
          <button type="button" className="secondary" disabled={Boolean(busy) || !note.trim()} onClick={() => run("return", () => team.act(a.id, "return", { note }))} data-testid="team-return">
            <RotateCcw size={13} /> Return
          </button>
        </div>
      )}
      {me?.super_admin && ["open", "returned"].includes(a.status) && (
        <div className="team-actions">
          <select defaultValue="" onChange={(e) => e.target.value && run("reassign", () => team.act(a.id, "reassign", { assigneeId: e.target.value }))}>
            <option value="">Reassign to…</option>
            {(team.members || []).filter((m) => m.active !== false).map((m) => <option key={m.id} value={m.id}>{m.name} · {team.teams?.[m.team]}</option>)}
          </select>
          <button type="button" className="rtc-reset" onClick={() => run("cancel", () => team.act(a.id, "cancel", {}))}><XCircle size={12} /> Cancel</button>
        </div>
      )}
      <details className="team-events">
        <summary>History ({a.events?.length || 0})</summary>
        <ul>
          {(a.events || []).map((e, i) => <li key={i}><em>{when(e.created_at)}</em> {e.member_name ? <b>{e.member_name}</b> : null} {e.kind.replace("_", " ")}{e.note ? `: ${e.note}` : ""}</li>)}
        </ul>
        <div className="team-actions">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Comment" />
          <button type="button" className="rtc-reset" disabled={!note.trim() || Boolean(busy)} onClick={() => run("comment", () => team.act(a.id, "comment", { note }))}><MessageSquare size={12} /> Comment</button>
        </div>
      </details>
      {error && <div className="alert">{error}</div>}
    </article>
  );
}

function Members({ team }) {
  const [draft, setDraft] = useState({ name: "", email: "", team: "finance", superAdmin: false });
  const [error, setError] = useState("");
  const isSuper = team.me?.super_admin;
  const save = async (m) => {
    setError("");
    try { await team.saveMember(m); } catch (err) { setError(err.message); }
  };
  return (
    <div className="team-members" data-testid="team-members">
      {(team.members || []).map((m) => (
        <div key={m.id} className={`team-member ${m.active === false ? "inactive" : ""}`}>
          <b>{m.name}{m.super_admin ? <ShieldCheck size={12} title="Super admin" /> : null}</b>
          <span>{team.teams?.[m.team]}</span>
          {isSuper
            ? <input defaultValue={m.email} placeholder="email for notifications" onBlur={(e) => e.target.value !== m.email && save({ id: m.id, email: e.target.value })} />
            : <span>{m.email || "no email"}</span>}
          {isSuper && m.id !== team.me.id && (
            <button type="button" className="rtc-reset" onClick={() => save({ id: m.id, active: m.active === false })}>{m.active === false ? "Restore" : "Remove"}</button>
          )}
        </div>
      ))}
      {isSuper && (
        <form className="team-member add" onSubmit={(e) => { e.preventDefault(); if (draft.name.trim()) save(draft).then(() => setDraft({ ...draft, name: "", email: "" })); }}>
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Name" data-testid="team-new-name" />
          <select value={draft.team} onChange={(e) => setDraft({ ...draft, team: e.target.value })} data-testid="team-new-team">
            {Object.entries(team.teams || {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} placeholder="email (optional)" />
          <label className="team-inline"><input type="checkbox" checked={draft.superAdmin} onChange={(e) => setDraft({ ...draft, superAdmin: e.target.checked })} /> super admin</label>
          <button type="submit" className="secondary" data-testid="team-new-add"><UserPlus size={12} /> Add</button>
        </form>
      )}
      {error && <div className="alert">{error}</div>}
    </div>
  );
}

/**
 * The Team panel of a saved bid: who you are (in a demo, "View as"), what is waiting for you,
 * answers waiting for the super admin, every assignment with its history, and the team.
 */
export default function TeamPanel({ team, state, bidName, onAccept, letterFor, onClose, focusId }) {
  const [tab, setTab] = useState("todo");
  useEffect(() => {
    if (focusId) {
      setTab("all");
      setTimeout(() => document.getElementById(`team-card-${focusId}`)?.scrollIntoView({ block: "center" }), 100);
    }
  }, [focusId]);
  const me = team.me;
  const todo = [...team.toAccept, ...team.forMe.filter((a) => !team.toAccept.includes(a))];
  const list = tab === "todo" ? todo : team.assignments;
  return (
    <aside className="team-panel" data-testid="team-panel">
      <header>
        <div>
          <small><Users size={12} /> Team · {bidName || "this bid"}</small>
          {team.demo ? (
            <label className="team-viewas">View as
              <select value={me?.id || ""} onChange={(e) => team.actAs(e.target.value)} data-testid="team-view-as">
                {(team.members || []).filter((m) => m.active !== false).map((m) => <option key={m.id} value={m.id}>{m.name} · {team.teams?.[m.team]}{m.super_admin ? " (super admin)" : ""}</option>)}
              </select>
            </label>
          ) : <b>{me ? `${me.name} · ${team.teams?.[me.team]}${me.super_admin ? " (super admin)" : ""}` : "Not on the team"}</b>}
        </div>
        <button type="button" className="rtc-icon-btn" onClick={onClose} aria-label="Close the team panel"><X size={16} /></button>
      </header>
      <p className="rtc-note team-mail">{team.mail ? <><Mail size={12} /> Email is on: people with an address are told of each assignment and answer.</> : <><MailX size={12} /> Email is off on this server (no SMTP): people see their work here.</>}
        {team.demo ? " Demo: “View as” switches between the team's seats without signing in." : ""}</p>
      {team.error && <div className="alert">{team.error}</div>}
      {!team.scenarioId ? (
        <p className="rtc-note" data-testid="team-need-save">Save the bid to the library (Save, at the top of the tab) to share it with the team: assignments belong to a saved bid.</p>
      ) : (
        <>
          <div className="seg team-tabs">
            <button type="button" className={tab === "todo" ? "active" : ""} onClick={() => setTab("todo")} data-testid="team-tab-todo"><Inbox size={12} /> For you ({todo.length})</button>
            <button type="button" className={tab === "all" ? "active" : ""} onClick={() => setTab("all")} data-testid="team-tab-all">All ({team.assignments.length})</button>
            <button type="button" className={tab === "members" ? "active" : ""} onClick={() => setTab("members")} data-testid="team-tab-members"><Users size={12} /> Team</button>
          </div>
          {tab === "members" ? <Members team={team} /> : (
            <div className="team-list">
              {list.length === 0 && <p className="rtc-note">{tab === "todo" ? "Nothing waiting for you." : "Nothing assigned yet: use Assign beside any value, cost, format or condition."}</p>}
              {list.map((a) => <Card key={a.id} a={a} team={team} state={state} onAccept={onAccept} letterFor={letterFor} focus={a.id === focusId} />)}
            </div>
          )}
        </>
      )}
      <p className="rtc-note"><FileUp size={12} /> Files up to 25 MB: PDF, images, Word, Excel. They stay on this server.</p>
    </aside>
  );
}
