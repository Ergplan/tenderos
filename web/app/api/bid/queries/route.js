import { currentUserWithAccess, handler, HttpError } from "@/lib/auth";
import { requireTenderAccess } from "@/lib/tenders";
import { logEvent } from "@/lib/activity";
import { docxBuffer, docxResponse, table as docxTable, para, str } from "@/lib/docx";

export const dynamic = "force-dynamic";

// Tender to Bid: the pre-bid queries as a Word file (.docx), the format the RFP asks for
// (RFP clause 1.1.10: "attaching the queries in Microsoft word file"). The browser sends the
// queries as the bidder edited them; this route only lays them out: the prescribed title, the
// tender, the bidder, and one table row per query (S. No., clause and page, RFP provision,
// clarification sought, rationale), A4 landscape.

const COLS = [
  ["S. No.", 700],
  ["Clause / page", 1500],
  ["RFP provision", 4300],
  ["Clarification sought", 5338],
  ["Rationale", 3000],
];

const table = (rows) => docxTable(COLS, rows.map((r) => [String(r.no), r.clause, r.provision, `${r.topic}\n${r.query}`, r.rationale]), { colOpts: [{}, {}, {}, { boldFirst: true }, {}] });

function bodyXml({ title, tenderNumber, bidder, date, rows }) {
  return [
    para(title, { bold: true, size: 26, center: true, after: 120 }),
    para(`Tender: ${tenderNumber}`, { center: true, after: 40 }),
    para(`Bidder: ${bidder || "______________________________"}`, { center: true, after: 40 }),
    para(`Date: ${date}`, { center: true, after: 200 }),
    para("RFQ = Section A and RFP = Section B of the Bidding Document; page numbers are those printed on the Bidding Document.", { italic: true, size: 18, color: "555555", after: 120 }),
    table(rows),
    para("", { after: 0 }),
  ].join("");
}

export const POST = handler(async (req) => {
  const user = await currentUserWithAccess();
  requireTenderAccess(user);
  const body = await req.json();
  const rows = (Array.isArray(body?.rows) ? body.rows.slice(0, 50) : []).map((r, i) => ({
    no: i + 1, topic: str(r.topic, 300), clause: str(r.clause, 200), provision: str(r.provision), query: str(r.query), rationale: str(r.rationale, 2000),
  }));
  if (!rows.length) throw new HttpError(400, "There are no queries in the letter.");
  const title = str(body.title, 300) || "Queries/Request for Additional Information";
  const date = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }).replace(/\//g, ".");

  const buffer = await docxBuffer({
    title, author: str(body.bidder, 200) || user.name || user.email, landscape: true,
    body: bodyXml({ title, tenderNumber: str(body.tenderNumber, 120), bidder: str(body.bidder, 200), date, rows }),
  });

  await logEvent({ user, kind: "export", detail: { what: "pre-bid-queries.docx", tender: str(body.tenderNumber, 80), queries: rows.length }, req });
  return docxResponse(buffer, "pre-bid_queries.docx");
});
