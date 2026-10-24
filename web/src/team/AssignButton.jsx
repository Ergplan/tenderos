import React, { useState } from "react";
import { CheckCircle2, Clock3, Inbox, Loader2, RotateCcw, UserPlus, X } from "lucide-react";
import { useTeamContext } from "./useTeam";
import { DEFAULT_TEAM } from "./apply";

const STATUS = { open: "assigned", submitted: "answer to accept", returned: "returned", accepted: "accepted" };
const ICON = { open: Clock3, submitted: Inbox, returned: RotateCcw, accepted: CheckCircle2 };

/**
 * Assign one data point of the bid to a team or a person (target: { kind, key, label, context }),
 * or, once assigned, its status (click: the Team panel). Renders nothing outside a team-enabled tab.
 */
export default function AssignButton({ target, compact = false }) {
  const team = useTeamContext();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!team || !team.me) return null;
  const a = team.targets?.[target.key];
  const testid = `assign-${target.key}`;
  if (a && a.status !== "accepted") {
    const Icon = ICON[a.status] || Clock3;
    return (
      <button type="button" className={`team-chip ${a.status}`} onClick={() => team.openPanel(a.id)} data-testid={testid} title={a.request || a.target_label}>
        <Icon size={11} /> {a.assignee_name || team.teams?.[a.team] || a.team} · {STATUS[a.status]}
      </button>
    );
  }
  const start = () => {
    if (!team.scenarioId) { team.needSave(); return; }
    setForm({ team: DEFAULT_TEAM[target.kind] || "management", assigneeId: "", request: "", dueDate: "" });
    setError("");
    setOpen(true);
  };
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await team.assign(target, form);
      setOpen(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  const people = (team.members || []).filter((m) => m.active !== false && m.team === form?.team);
  return (
    <span className="team-assign">
      {a?.status === "accepted" && <span className="team-chip accepted" title={`Accepted from ${a.answer?.by || a.assignee_name || ""}`}><CheckCircle2 size={11} /> from {a.answer?.by || a.assignee_name || team.teams?.[a.team]}</span>}
      <button type="button" className={`team-assign-btn ${compact ? "compact" : ""}`} onClick={start} data-testid={testid} title={`Assign “${target.label}” to someone on the team`}>
        <UserPlus size={12} />{compact ? "" : " Assign"}
      </button>
      {open && form && (
        <form className="team-pop" onSubmit={submit} data-testid="assign-form" onClick={(e) => e.stopPropagation()}>
          <header><b>Assign: {target.label}</b><button type="button" className="rtc-icon-btn" onClick={() => setOpen(false)} aria-label="Close"><X size={14} /></button></header>
          <label>Team
            <select value={form.team} onChange={(e) => setForm({ ...form, team: e.target.value, assigneeId: "" })} data-testid="assign-team">
              {Object.entries(team.teams || {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label>Person
            <select value={form.assigneeId} onChange={(e) => setForm({ ...form, assigneeId: e.target.value })} data-testid="assign-person">
              <option value="">Anyone in {team.teams?.[form.team]}</option>
              {people.map((m) => <option key={m.id} value={m.id}>{m.name}{m.email ? ` (${m.email})` : ""}</option>)}
            </select>
          </label>
          <label>What do you need?
            <textarea rows={3} value={form.request} onChange={(e) => setForm({ ...form, request: e.target.value })} data-testid="assign-request"
              placeholder={target.kind === "document" ? "Print on the letterhead or stamp paper, sign and upload the signed copy" : target.kind === "condition" ? "What should we read this clause as?" : "The figure to use, with its basis"} />
          </label>
          <label>Due<input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></label>
          {error && <div className="alert">{error}</div>}
          <div className="modal-actions">
            <button type="submit" className="primary" disabled={busy} data-testid="assign-send">{busy ? <Loader2 className="spin" size={13} /> : <UserPlus size={13} />} Assign</button>
          </div>
        </form>
      )}
    </span>
  );
}
