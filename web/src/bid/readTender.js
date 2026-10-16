// Reading a tender with the engine (a background job) and keeping the reading for the team.
// Used by the start screen and the Tender step.

export async function getJson(path, opts) {
  const res = await fetch(path, { credentials: "same-origin", ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = typeof data.detail === "string" ? data.detail : Array.isArray(data.detail) ? data.detail.map((d) => d.msg || d).join("; ") : null;
    throw new Error(data.error || detail || `Request failed (${res.status})`);
  }
  return data;
}

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("The file could not be read."));
    reader.readAsDataURL(file);
  });
}

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

export const MAX_UPLOAD_BYTES = 60 * 1024 * 1024;

/**
 * Read a file with the tender engine. onUpdate(job) gets every poll of the job (status,
 * progress, preview, result). Returns { result, savedId }, or null when isCancelled() turned true.
 */
export async function readTenderFile(file, { mode = "auto", type = "auto", onUpdate = () => {}, isCancelled = () => false, pollMs = 600 } = {}) {
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("The file is larger than 60 MB.");
  const content = await toBase64(file);
  const started = await getJson("/api/bid/tender/read", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file: { name: file.name, content_base64: content }, tender_type: type, mode }),
  });
  let current = { status: started.status || "queued", progress: { done: 0, total: 1, step: "Queued" }, mode: started.mode };
  onUpdate(current);
  const t0 = Date.now();
  while (!isCancelled() && current.status !== "done" && current.status !== "failed") {
    await sleep(pollMs);
    current = await getJson(`/api/bid/tender/read/${started.job_id}`);
    onUpdate(current);
    if (Date.now() - t0 > 30 * 60 * 1000) throw new Error("Reading the tender took longer than 30 minutes.");
  }
  if (isCancelled()) return null;
  if (current.status === "failed") throw new Error(current.error || "The tender could not be read.");
  // keep the reading for the team (recent tenders); the journey works without it
  let savedId = null;
  try {
    const saved = await getJson("/api/tenders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fileName: file.name, result: current.result }) });
    savedId = saved.tender?.id || null;
  } catch { /* saving is best effort */ }
  return { result: current.result, savedId };
}

/** A saved reading by id, as the workflow opens it. */
export async function openSavedTender(id) {
  const { tender } = await getJson(`/api/tenders/${id}`);
  return { name: tender.file_name, readAt: tender.created_at, result: tender.result, savedId: tender.id, seedKey: tender.seed_key || null };
}
