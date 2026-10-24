import { currentUserWithAccess, handler, HttpError } from "@/lib/auth";
import { readStored } from "@/lib/files";
import { fileRow, requireMember } from "@/lib/team";

export const dynamic = "force-dynamic";

/** A file uploaded on an assignment (a signed copy), for anyone on the team. */
export const GET = handler(async (_req, { params }) => {
  const user = await currentUserWithAccess();
  if (!user) throw new HttpError(401, "Sign in required.");
  await requireMember(user);
  const { id } = await params;
  const row = await fileRow(id);
  const buf = await readStored(row);
  return new Response(buf, {
    headers: {
      "content-type": row.content_type,
      "content-length": String(buf.length),
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.name)}`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
});
