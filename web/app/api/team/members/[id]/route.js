import { currentUserWithAccess, handler, HttpError } from "@/lib/auth";
import { requireMember, updateMember } from "@/lib/team";

export const dynamic = "force-dynamic";

/** Change a member: name, email, team, super admin, or active (super admin). */
export const PATCH = handler(async (req, { params }) => {
  const user = await currentUserWithAccess();
  if (!user) throw new HttpError(401, "Sign in required.");
  const me = await requireMember(user);
  const { id } = await params;
  return Response.json({ member: await updateMember(me, id, (await req.json()) || {}) });
});
