import { currentUserWithAccess, handler, HttpError } from "@/lib/auth";
import { saveUpload } from "@/lib/files";
import { actOnAssignment, requireMember } from "@/lib/team";

export const dynamic = "force-dynamic";

/**
 * Act on an assignment: { action: submit | accept | return | cancel | comment | reassign, value,
 * note, version, assigneeId }. A submit with a file is multipart: the fields, plus "file".
 */
export const POST = handler(async (req, { params }) => {
  const user = await currentUserWithAccess();
  if (!user) throw new HttpError(401, "Sign in required.");
  const me = await requireMember(user);
  const { id } = await params;
  let body;
  let fileId = null;
  if ((req.headers.get("content-type") || "").startsWith("multipart/form-data")) {
    const form = await req.formData();
    body = { action: form.get("action"), note: form.get("note") || "", value: form.get("value") ?? null };
    const file = form.get("file");
    if (file && typeof file === "object" && file.size > 0) fileId = (await saveUpload(file, me.id)).id;
  } else {
    body = (await req.json()) || {};
  }
  const value = body.value === "" ? null : body.value ?? null;
  const assignment = await actOnAssignment(me, id, String(body.action || ""), {
    value, note: body.note || "", fileId, version: body.version ?? null, assigneeId: body.assigneeId ?? null,
  });
  return Response.json({ assignment });
});
