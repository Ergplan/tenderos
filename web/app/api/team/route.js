import { currentUserWithAccess, handler, HttpError } from "@/lib/auth";
import { teamState } from "@/lib/team";

export const dynamic = "force-dynamic";

/** Who is acting, the team, and whether email is on. */
export const GET = handler(async () => {
  const user = await currentUserWithAccess();
  if (!user) throw new HttpError(401, "Sign in required.");
  return Response.json(await teamState(user));
});
