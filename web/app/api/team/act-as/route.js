import { cookies } from "next/headers";
import { currentUserWithAccess, handler, HttpError } from "@/lib/auth";
import { DEMO_MODE } from "@/lib/demo";
import { ACT_AS_COOKIE, assertUuid, listMembers } from "@/lib/team";

export const dynamic = "force-dynamic";

/** Demo mode only: act as one of the team ("View as"), to show each role without accounts. */
export const POST = handler(async (req) => {
  const user = await currentUserWithAccess();
  if (!user) throw new HttpError(401, "Sign in required.");
  if (!DEMO_MODE) throw new HttpError(403, "Only a demo deployment switches people; sign in as yourself.");
  const { memberId } = (await req.json()) || {};
  assertUuid(memberId, "Member not found.");
  if (!(await listMembers()).some((m) => m.id === memberId)) throw new HttpError(404, "Member not found.");
  const jar = await cookies();
  jar.set(ACT_AS_COOKIE, memberId, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return Response.json({ ok: true });
});
