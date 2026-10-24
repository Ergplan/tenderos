"""Clarification schedules (the issuer's replies to bidders' queries) into clarifications.

A schedule is a table: S. No. | Document | Clause | Existing clause | Proposed modification
| Rationale | Response, in some order and wording; the columns are found by their headers.
Each clarification keeps the bidder's request and the issuer's response as printed, each
located on its page, and a verdict read from the response:

  amended    the response points to an amendment ("suitably modified, refer Amendment-01")
  unchanged  the request is refused ("Tender conditions remain unchanged")
  refer      the response points to another clause or document ("Kindly refer Clause 4.4.9")
  answered   anything else: an explanation the bidder must read

A clarification is linked to the changes of the set on the same document and clause.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from engine.extraction.resolver import PageText
from engine.extraction.tenderset.changes import Segment, clause_key, clause_label, clean, locate, same_clause, target_name
from engine.extraction.tenderset.layout import Table

_SNO = re.compile(r"^\s*(\d{1,3})\b")
_COLUMNS = (
    ("sno", r"\bs\.?\s*no\b|\bsr\.?\s*no\b|\bsl\.?\s*no\b|^no\.?$"),
    ("response", r"response|reply|clarification|comments?\s+of|seci'?s|decision"),
    ("rationale", r"rationale|remarks?|justification|reason"),
    ("request", r"proposed|modification|query|queries|request|suggest|bidder'?s"),
    ("existing", r"existing|clause\s+text|as\s+per\s+rfs|original"),
    ("clause", r"clause|article|section|para"),
    ("document", r"documents?|volume|rfs/ppa"),
)
_VERDICTS = (
    ("amended", re.compile(r"suitably\s+(?:modified|amended)|refer\s+(?:to\s+)?(?:the\s+)?amendment|amendment[\s-]*\d+|has\s+been\s+(?:modified|amended|revised)|stands?\s+(?:modified|amended)", re.I)),
    ("unchanged", re.compile(r"remains?\s+unchanged|no\s+change|not\s+(?:acceptable|accepted|agreed|considered)|shall\s+prevail|as\s+per\s+(?:the\s+)?rfs|denied|regret", re.I)),
    ("refer", re.compile(r"\b(?:kindly\s+|please\s+)?refer\b", re.I)),
)


def header_map(row: list[str]) -> dict[str, int] | None:
    lowered = [clean(cell).lower() for cell in row]
    if not any(re.search(_COLUMNS[0][1], cell) for cell in lowered):
        return None
    taken: dict[str, int] = {}
    used: set[int] = set()
    for name, pattern in _COLUMNS:
        for index, cell in enumerate(lowered):
            if index in used or not cell:
                continue
            if re.search(pattern, cell):
                taken[name] = index
                used.add(index)
                break
    if "response" not in taken or ("request" not in taken and "existing" not in taken):
        return None
    return taken


def verdict(response: str) -> str:
    for name, pattern in _VERDICTS:
        if pattern.search(response):
            return name
    return "answered"


@dataclass
class Clarification:
    doc: str
    no: int
    document: str
    clause: str
    cells: dict[str, list[Segment]] = field(default_factory=dict)

    def text(self, column: str) -> str:
        return clean(" ".join(segment.text for segment in self.cells.get(column, [])))

    @property
    def id(self) -> str:
        return f"{self.doc}-{self.no}"


def _add(item: Clarification, column: str, page: int, text: str) -> None:
    text = clean(text)
    if not text:
        return
    segments = item.cells.setdefault(column, [])
    if any(segment.text == text for segment in segments):
        return
    segments.append(Segment(page, text))


def clarifications_from_tables(doc_id: str, tables: list[Table]) -> list[Clarification]:
    out: list[Clarification] = []
    current: Clarification | None = None
    columns: dict[str, int] | None = None
    width = 0
    for table in tables:
        table_width = max((len(row) for row in table.rows), default=0)
        mapping = columns if columns and table_width == width else None
        for row in table.rows:
            if not any(row):
                continue
            header = header_map(row)
            if header:
                columns, width, mapping = header, len(row), header
                continue
            if mapping is None or len(row) <= max(mapping.values()):
                continue
            first = clean(row[mapping["sno"]])
            number = _SNO.match(first)
            if number:
                no = int(number.group(1))
                if not (current and current.no == no):
                    document = clean(row[mapping["document"]]) if "document" in mapping else ""
                    clause = clause_label(row[mapping["clause"]]) if "clause" in mapping else ""
                    current = Clarification(doc_id, no, target_name(document.split()[0]) if document else "RfS", clause)
                    out.append(current)
            elif first:
                current = None
                continue
            if current is None:
                continue
            for column in ("existing", "request", "rationale", "response"):
                if column in mapping:
                    _add(current, column, table.page, row[mapping[column]])
    return out


def clarification_json(item: Clarification, pages: dict[int, PageText]) -> dict[str, Any]:
    response = item.text("response")
    request = item.text("request") or item.text("existing")
    return {
        "id": item.id,
        "doc": item.doc,
        "no": item.no,
        "document": item.document,
        "clause": item.clause,
        "clause_key": list(clause_key(item.clause)),
        "existing": item.text("existing"),
        "request": item.text("request"),
        "rationale": item.text("rationale"),
        "response": response,
        "verdict": verdict(response),
        "evidence": {
            "request": locate(item.cells.get("request") or item.cells.get("existing") or [], item.doc, pages)[:1],
            "response": locate(item.cells.get("response", []), item.doc, pages)[:1],
        },
        "pages": sorted({segment.page for segments in item.cells.values() for segment in segments}),
        "changes": [],
        "summary": request[:160],
    }


def read_clarifications(doc_id: str, tables: list[Table], pages: list[PageText]) -> list[dict[str, Any]]:
    by_no = {page.page_no: page for page in pages}
    return [clarification_json(item, by_no) for item in clarifications_from_tables(doc_id, tables)]


def link(clarifications: list[dict[str, Any]], changes: list[dict[str, Any]]) -> None:
    """Point each clarification at the changes on its document and clause (in place)."""
    for item in clarifications:
        key = tuple(item["clause_key"])
        item["changes"] = [
            change["id"]
            for change in changes
            if change["document"] == item["document"] and same_clause(key, tuple(change["clause_key"]))
        ]
