import { currentUserWithAccess, handler, HttpError } from "@/lib/auth";
import { createAssignment, listAssignments, requireMember } from "@/lib/team";

export const dynamic = "force-dynamic";

/** The assignments of a saved bid (?scenario=id), or the acting member's own (?mine=1). */
export const GET = handler(async (req) => {
  const user = await currentUserWithAccess();
  if (!user) throw new HttpError(401, "Sign in required.");
  const me = await requireMember(user);
  const url = new URL(req.url);
  const scenarioId = url.searchParams.get("scenario");
  const mine = url.searchParams.get("mine") === "1";
  if (!scenarioId && !mine) throw new HttpError(400, "Which bid?");
  return Response.json({ assignments: await listAssignments({ scenarioId, memberId: mine ? me.id : null }) });
});

/** Assign a data point of a saved bid to a team or a person. */
export const POST = handler(async (req) => {
  const user = await currentUserWithAccess();
  if (!user) throw new HttpError(401, "Sign in required.");
  const me = await requireMember(user);
  return Response.json({ assignment: await createAssignment(me, (await req.json()) || {}) }, { status: 201 });
});
