"""The bid process of an RfS: the Bid Information Sheet (fees, EMD, deadlines, opening, e-RA,
as a table of lettered items near the front) and the steps a bidder goes through, each step
with the sentences of the RfS that govern it, quoted and located.

The steps are found by their words (registration on the portal, fees, queries, submission,
opening, e-Reverse Auction, selection, LoA, PPA signing ...): for each, the best sentences
are those with the most step words, a "shall"/"must" and a sensible length, earliest first.
A step the RfS never mentions is left out, not invented.
"""

from __future__ import annotations

import re
from typing import Any

from engine.extraction.resolver import PageText, locate
from engine.extraction.tenderset.layout import Table

FRONT_PAGES = 12  # where a Bid Information Sheet sits
SOURCES_PER_STEP = 2
MIN_WORDS, MAX_WORDS = 8, 70

STEPS: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("register", "Register and download", (r"isn-?ets|e-?tender\w*\s+portal|electronic\s*tender", r"digital\s+signature|\bDSC\b|class\s+iii", r"register\w*|download\w*")),
    ("fees", "Pay the document and processing fees", (r"cost\s+of\s+(?:the\s+)?rfs|document\s+fee", r"(?:bid\s+)?processing\s+fee", r"rtgs|neft|paid|payment")),
    ("emd", "Submit the EMD", (r"earnest\s+money|\bEMD\b", r"bank\s+guarantee|payment\s+on\s+order|surety\s+bond|\bPOI\b", r"submit\w*|furnish\w*")),
    ("queries", "Queries and pre-bid meeting", (r"pre-?bid\s+meeting|quer(?:y|ies)", r"clarification", r"e-?mail|submit\w*|sought|raise")),
    ("submission", "Submit the bid online", (r"bid\s+submission|submi\w+\s+(?:the|their|its)\s+(?:response|bid)|upload\w*", r"techno-?commercial|financial\s+bid|envelope", r"deadline|online|portal")),
    ("offline", "Send the originals offline", (r"offline|original|hard\s+cop(?:y|ies)|physical\w*", r"submi\w+|deliver\w*|courier|sealed\s+envelope", r"deadline|address|office")),
    ("opening", "Techno-commercial opening and evaluation", (r"techno-?commercial\s+(?:bids?\s+)?(?:opening|evaluation)|opening\s+of\s+(?:the\s+)?techno", r"evaluat\w*|qualif\w*|shortlist\w*", r"shall|will")),
    ("financial", "Financial bid opening and ranking", (r"financial\s+bids?\s+(?:shall|will)\s+be\s+opened|opening\s+of\s+(?:the\s+)?financial\s+bids?", r"rank\w*|ascending|lowest|\bL1\b", r"tariff|quoted")),
    ("era", "e-Reverse Auction", (r"e-?reverse\s+auction|\be-?RA\b", r"tariff|bid|decrement|quote\w*", r"shall|will|minutes|start")),
    ("selection", "Selection of successful bidders", (r"successful\s+bidders?|selection\s+of", r"\bL1\b|lowest|bucket|capacity\s+(?:allocation|allotted)|ascending", r"shall|will")),
    ("loa", "Letter of Award", (r"letter\s+of\s+award|\bLoA\b", r"issu\w*|successful\s+bidders?|accept\w*", r"within|days|shall")),
    ("pbg", "Performance Bank Guarantee and success charges", (r"performance\s+bank\s+guarantee|\bPBG\b|success\s+charges?", r"submit\w*|furnish\w*|prior\s+to", r"ppa|signing|within")),
    ("ppa", "Sign the PPA (and the PSA)", (r"(?:signing|execution)\s+of\s+(?:the\s+)?(?:ppa|psa)|ppa\s+shall\s+be\s+(?:signed|executed)|power\s+(?:purchase|sale)\s+agreement", r"within|days|after|prior", r"loa|successful\s+bidders?|buying\s+entit\w*|rpd")),
)
_SENTENCE = re.compile(r"[^.;]*?(?:\.(?=\s+[A-Z(])|;|$)", re.S)
_MODAL = re.compile(r"\b(shall|must|will\s+be|required\s+to|is\s+to\s+be)\b", re.I)
_ITEM = re.compile(r"^\(?([A-Z]{1,2})\)?$")


def _clean(text: str) -> str:
    return " ".join(str(text or "").split())


_LEADING_HEADING = re.compile(r"^(?:(?:[A-Z][A-Z&/,()'-]+\s+){2,}|\(?[A-Z]\)\s+|\d{1,2}(?:\.\d{1,2})*\.?\s+)+")


def _sentences(page: PageText) -> list[str]:
    text = re.sub(r"\s+", " ", page.text)
    out = []
    for m in _SENTENCE.finditer(text):
        # a heading run in before the sentence ("STANDARD CONDITIONS OF CONTRACT 12 Obtaining ...")
        sentence = _LEADING_HEADING.sub("", _clean(m.group(0)))
        if sentence:
            out.append(sentence)
    return out


def _score(sentence: str, patterns: tuple[str, ...]) -> int:
    hits = [bool(re.search(pattern, sentence, re.I)) for pattern in patterns]
    if not hits[0]:
        return 0
    words = len(sentence.split())
    if words < MIN_WORDS or words > MAX_WORDS:
        return 0
    return 3 + sum(hits[1:]) * 2 + (1 if _MODAL.search(sentence) else 0)


def steps(pages: list[PageText], doc_id: str = "rfs", skip_pages: set[int] | None = None) -> list[dict[str, Any]]:
    """The steps the RfS describes, in bid order, each with its best quoted sentences."""
    skip = skip_pages or set()
    sentences = [(page, sentence) for page in pages if page.page_no not in skip for sentence in _sentences(page)]
    out: list[dict[str, Any]] = []
    for key, title, patterns in STEPS:
        scored = [(_score(sentence, patterns), page.page_no, sentence, page) for page, sentence in sentences]
        best = sorted((item for item in scored if item[0] >= 5), key=lambda item: (-item[0], item[1]))
        chosen: list[dict[str, Any]] = []
        used_pages: set[int] = set()
        for _, page_no, sentence, page in best:
            if page_no in used_pages:
                continue
            found = locate(sentence, page)
            chosen.append(
                {
                    "doc": doc_id,
                    "page": page_no,
                    "quote": sentence,
                    "located": found is not None,
                    "bbox": [round(float(x), 2) for x in found.bbox] if found is not None and found.bbox else None,
                }
            )
            used_pages.add(page_no)
            if len(chosen) == SOURCES_PER_STEP:
                break
        if chosen:
            out.append({"key": key, "step": title, "detail": chosen[0]["quote"], "sources": chosen})
    return out


def bid_information(tables: list[Table], pages: list[PageText], doc_id: str = "rfs") -> list[dict[str, Any]]:
    """The lettered rows of the Bid Information Sheet: (A) name of work ... (K) submission
    deadline, (M) e-Reverse Auction ..., each value quoted and located."""
    by_no = {page.page_no: page for page in pages}
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    for table in tables:
        if table.page > FRONT_PAGES:
            continue
        for row in table.rows:
            cells = [_clean(cell) for cell in row]
            if len(cells) < 3 or not _ITEM.match(cells[0]) or not cells[1]:
                continue
            item = cells[0].strip("()")
            if item in seen:
                continue
            seen.add(item)
            value = " ".join(cell for cell in cells[2:] if cell)
            page = by_no.get(table.page)
            snippet = " ".join(value.split()[:20])
            found = locate(snippet, page) if page and snippet else None
            rows.append(
                {
                    "item": item,
                    "label": cells[1].title() if cells[1].isupper() else cells[1],
                    "value": value,
                    "evidence": {
                        "doc": doc_id,
                        "page": table.page,
                        "quote": snippet,
                        "located": found is not None,
                        "bbox": [round(float(x), 2) for x in found.bbox] if found is not None and found.bbox else None,
                    },
                }
            )
    return rows


def read_process(pages: list[PageText], tables: list[Table], format_pages: set[int] | None = None, doc_id: str = "rfs") -> dict[str, Any]:
    """The Bid Information Sheet and the steps; the sheet's pages (a table, read as such) and
    the formats' pages (blanks, not rules) are left out of the step sentences."""
    information = bid_information(tables, pages, doc_id)
    skip = set(format_pages or set()) | {row["evidence"]["page"] for row in information}
    return {"information": information, "steps": steps(pages, doc_id, skip)}
