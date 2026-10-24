import { currentUserWithAccess, handler, HttpError } from "@/lib/auth";
import { addMember, requireMember } from "@/lib/team";

export const dynamic = "force-dynamic";

/** Add someone to the tender team (super admin). */
export const POST = handler(async (req) => {
  const user = await currentUserWithAccess();
  if (!user) throw new HttpError(401, "Sign in required.");
  const me = await requireMember(user);
  const body = await req.json();
  return Response.json({ member: await addMember(me, body || {}) }, { status: 201 });
});
