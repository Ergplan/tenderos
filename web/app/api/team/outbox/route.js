import { currentUserWithAccess, handler, HttpError } from "@/lib/auth";
import { listOutbox, requireMember } from "@/lib/team";

export const dynamic = "force-dynamic";

/** The emails team sharing composed for a saved bid (?scenario=id): sent, failed, or the demo outbox. */
export const GET = handler(async (req) => {
  const user = await currentUserWithAccess();
  if (!user) throw new HttpError(401, "Sign in required.");
  await requireMember(user);
  const scenarioId = new URL(req.url).searchParams.get("scenario");
  return Response.json({ outbox: await listOutbox(scenarioId) });
});
