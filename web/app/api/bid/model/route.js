import { currentUserWithAccess, handler, HttpError } from "@/lib/auth";
import { requireTenderAccess } from "@/lib/tenders";
import { logEvent } from "@/lib/activity";
import { buildModelWorkbook, workbookResponse } from "@/lib/modelWorkbook";

export const dynamic = "force-dynamic";

// Tender to Bid: the bid's financial model as an Excel workbook (web/lib/modelWorkbook.js), with
// the Live model tab rebuilding the model as Excel formulas.
export const POST = handler(async (req) => {
  const user = await currentUserWithAccess();
  requireTenderAccess(user);
  const body = await req.json();
  let out;
  try {
    out = await buildModelWorkbook(body, { preparedBy: user.name || user.email, product: "Tender to Bid" });
  } catch (err) {
    if (err.status) throw new HttpError(err.status, err.message);
    throw err;
  }
  await logEvent({ user, kind: "export", detail: { what: "bid-financial-model.xlsx", tender: String(body.tenderNumber ?? "").slice(0, 80) }, req });
  return workbookResponse(out);
});
