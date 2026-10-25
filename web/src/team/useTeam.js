// The tender team in the browser: who is acting, the members, and the assignments of the saved bid
// that is open (scenarioId), with the calls that change them. Refreshes every 20 seconds while open.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { byTarget } from "./apply";

export const TeamContext = createContext(null);
export const useTeamContext = () => useContext(TeamContext);

async function call(path, { method = "GET", body, form } = {}) {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: form ? undefined : body ? { "content-type": "application/json" } : undefined,
    body: form || (body ? JSON.stringify(body) : undefined),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export default function useTeam(scenarioId) {
  const [team, setTeam] = useState(null); // { me, members, teams, demo, mail }
  const [assignments, setAssignments] = useState([]);
  const [outbox, setOutbox] = useState([]); // the emails composed for this bid (sent, or the demo outbox)
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const t = await call("/api/team");
      setTeam(t);
      if (t.me && scenarioId) {
        const [a, o] = await Promise.all([call(`/api/team/assignments?scenario=${scenarioId}`), call(`/api/team/outbox?scenario=${scenarioId}`)]);
        setAssignments(a.assignments);
        setOutbox(o.outbox);
      } else {
        setAssignments([]);
        setOutbox([]);
      }
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }, [scenarioId]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 20_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const actAs = useCallback(async (memberId) => { await call("/api/team/act-as", { method: "POST", body: { memberId } }); await refresh(); }, [refresh]);
  const assign = useCallback(async (target, { team: t, assigneeId, request, dueDate }) => {
    await call("/api/team/assignments", {
      method: "POST",
      body: { scenarioId, targetKind: target.kind, targetKey: target.key, targetLabel: target.label, context: target.context || {}, request, team: t, assigneeId: assigneeId || null, dueDate: dueDate || null },
    });
    await refresh();
  }, [scenarioId, refresh]);
  const act = useCallback(async (id, action, payload = {}, file = null) => {
    let out;
    if (file) {
      const form = new FormData();
      form.set("action", action);
      if (payload.note) form.set("note", payload.note);
      if (payload.value !== undefined && payload.value !== null) form.set("value", String(payload.value));
      form.set("file", file);
      out = await call(`/api/team/assignments/${id}`, { method: "POST", form });
    } else {
      out = await call(`/api/team/assignments/${id}`, { method: "POST", body: { action, ...payload } });
    }
    await refresh();
    return out.assignment;
  }, [refresh]);
  const saveMember = useCallback(async (member) => {
    if (member.id) await call(`/api/team/members/${member.id}`, { method: "PATCH", body: member });
    else await call("/api/team/members", { method: "POST", body: member });
    await refresh();
  }, [refresh]);

  const targets = useMemo(() => byTarget(assignments), [assignments]);
  const me = team?.me || null;
  const forMe = assignments.filter((a) => ["open", "returned"].includes(a.status) && (a.assignee_id ? a.assignee_id === me?.id : a.team === me?.team));
  const toAccept = me?.super_admin ? assignments.filter((a) => a.status === "submitted") : [];
  return { ...(team || {}), me, assignments, outbox, targets, forMe, toAccept, error, refresh, actAs, assign, act, saveMember, scenarioId };
}
