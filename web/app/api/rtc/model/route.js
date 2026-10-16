import { currentUserWithAccess, handler, HttpError } from "@/lib/auth";
import { logEvent } from "@/lib/activity";
import { buildModelWorkbook, workbookResponse } from "@/lib/modelWorkbook";

export const dynamic = "force-dynamic";

// Round the clock: the plant's financial model as an Excel workbook (web/lib/modelWorkbook.js),
// with the Live model tab rebuilding the model as Excel formulas.
export const POST = handler(async (req) => {
  const user = await currentUserWithAccess();
  if (!user) throw new HttpError(401, "Sign in required.");
  if (user.role !== "admin" && !user.allowedTabs?.includes("rtc")) throw new HttpError(403, "No access to the Round the Clock tab.");
  const body = await req.json();
  let out;
  try {
    out = await buildModelWorkbook(body, { preparedBy: user.name || user.email, product: "Round the clock" });
  } catch (err) {
    if (err.status) throw new HttpError(err.status, err.message);
    throw err;
  }
  await logEvent({ user, kind: "export", detail: { what: "rtc-financial-model.xlsx" }, req });
  return workbookResponse(out);
});
