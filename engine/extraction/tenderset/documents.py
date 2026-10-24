"""What each file of a tender set is: its role (rfs, amendment, clarification, agreement,
other), its kind within the role (corrigendum, ppa, psa ...), its number, reference and date,
read from the opening pages. The set is then ordered as it applies: the RfS, the
amendments and clarifications by date (then number), then the agreements.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from typing import Any

from engine.extraction.resolver import PageText

OPENING_CHARS = 1600  # the part of the first two pages read for the role

ROLES = ("rfs", "amendment", "clarification", "agreement", "other")

_AMENDMENT = re.compile(r"\b(Amendment|Corrigendum|Addendum|Erratum)[\s\-–:#]*(?:No\.?\s*)?[-–]?\s*(\d{1,3})?", re.I)
_CLARIFICATION = re.compile(
    r"\b(Clarifications?\s+(?:to|on)\s+the\s+quer|Clarifications?[\s\-–]*(?:No\.?\s*)?\d|Response\s+to\s+(?:pre[\s-]?bid\s+)?quer|"
    r"Pre[\s-]?bid\s+(?:queries|clarifications)|SECI'?s\s+response|Replies\s+to\s+(?:the\s+)?quer)",
    re.I,
)
_CLARIFICATION_NO = re.compile(r"Clarifications?[\s\-–]*(?:No\.?\s*)?(\d{1,3})", re.I)
_AGREEMENTS = (
    ("psa", re.compile(r"\bPOWER\s+SALE\s+AGREEMENT\b", re.I)),
    ("ppa", re.compile(r"\bPOWER\s+PURCHASE\s+AGREEMENT\b", re.I)),
    ("bespa", re.compile(r"\bBATTERY\s+ENERGY\s+STORAGE\s+(?:SYSTEM\s+)?PURCHASE\s+AGREEMENT\b", re.I)),
    ("tsa", re.compile(r"\bTRANSMISSION\s+SERVICE\s+AGREEMENT\b", re.I)),
)
_RFS = re.compile(
    r"\b(Request\s+for\s+(?:Selection|Proposal|Qualification)|RfS\s+Document|RFP\s+Document|Tender\s+Document|Bid\s+Document|"
    r"Notice\s+Inviting\s+Tender)\b",
    re.I,
)
_REF = re.compile(r"\bRef(?:erence)?\.?\s*No\.?\s*[:.\-]?\s*([A-Z0-9][A-Za-z0-9&/\-_.()]{5,})")
_RFS_NO = re.compile(r"\b(?:RfS|RFP|Tender|NIT)\s*No\.?\s*[:.\-]?\s*([A-Z0-9][A-Za-z0-9&/\-_.()]{5,})(?:\s+dated\s+(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}))?", re.I)
_DATE = re.compile(r"\bDate[d]?\s*[:.\-]?\s*(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b", re.I)
_ANY_DATE = re.compile(r"\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b")

TITLES = {
    "rfs": "RfS",
    "amendment": "Amendment",
    "corrigendum": "Corrigendum",
    "addendum": "Addendum",
    "erratum": "Erratum",
    "clarification": "Clarifications",
    "ppa": "Draft PPA",
    "psa": "Draft PSA",
    "bespa": "Draft BESPA",
    "tsa": "Draft TSA",
    "other": "Document",
}
# the word an amendment schedule uses for the document it amends ("Amendments in PPA document")
TARGET_NAMES = {"rfs": "RfS", "ppa": "PPA", "psa": "PSA", "bespa": "BESPA", "tsa": "TSA"}


@dataclass
class SetDocument:
    id: str
    name: str
    role: str
    kind: str
    title: str
    number: int | None = None
    ref: str | None = None
    date: str | None = None  # ISO
    rfs_no: str | None = None
    rfs_date: str | None = None
    pages: int = 0
    scanned_pages: list[int] = field(default_factory=list)
    reason: str = ""  # the words the role was read from
    evidence: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "role": self.role,
            "kind": self.kind,
            "title": self.title,
            "number": self.number,
            "ref": self.ref,
            "date": self.date,
            "rfs_no": self.rfs_no,
            "rfs_date": self.rfs_date,
            "pages": self.pages,
            "scanned_pages": self.scanned_pages,
            "reason": self.reason,
            "evidence": self.evidence,
        }


def _iso(day: str, month: str, year: str) -> str | None:
    try:
        return date(int(year), int(month), int(day)).isoformat()
    except ValueError:
        return None


def _opening(pages: list[PageText]) -> str:
    return " ".join(" ".join(page.text.split()) for page in pages[:2])[: OPENING_CHARS * 2]


def classify(name: str, pages: list[PageText]) -> tuple[str, str, int | None, str]:
    """(role, kind, number, reason) of a document from its opening pages and file name."""
    head = " ".join(" ".join(page.text.split()) for page in pages[:1])[:OPENING_CHARS]
    opening = _opening(pages)
    stem = re.sub(r"[_\-]+", " ", name.rsplit(".", 1)[0])
    # an amendment names itself near the top: "Amendment-01 to RfS ..."; the RfS mentions
    # amendments only in passing, further down
    amendment = _AMENDMENT.search(head[:600])
    if amendment and re.search(r"\bto\s+(?:the\s+)?(?:RfS|RFP|tender|bid|NIT)", head[amendment.end() : amendment.end() + 80], re.I):
        word = amendment.group(1).lower()
        number = int(amendment.group(2)) if amendment.group(2) else None
        return "amendment", word, number, amendment.group(0).strip()
    clarification = _CLARIFICATION.search(opening) or _CLARIFICATION.search(stem)
    if clarification:
        number_match = _CLARIFICATION_NO.search(opening) or _CLARIFICATION_NO.search(stem)
        number = int(number_match.group(1)) if number_match else None
        return "clarification", "clarification", number, clarification.group(0).strip()
    for kind, pattern in _AGREEMENTS:
        found = pattern.search(head[:400])
        if found:
            return "agreement", kind, None, found.group(0)
    rfs = _RFS.search(opening)
    if rfs:
        return "rfs", "rfs", None, rfs.group(0)
    if amendment:
        word = amendment.group(1).lower()
        return "amendment", word, int(amendment.group(2)) if amendment.group(2) else None, amendment.group(0).strip()
    stem_amendment = _AMENDMENT.search(stem)
    if stem_amendment:
        word = stem_amendment.group(1).lower()
        return "amendment", word, int(stem_amendment.group(2)) if stem_amendment.group(2) else None, f"file name {name}"
    for kind, pattern in _AGREEMENTS:
        if pattern.search(opening):
            return "agreement", kind, None, pattern.pattern
    return "other", "other", None, ""


def describe(doc_id: str, name: str, pages: list[PageText]) -> SetDocument:
    """A SetDocument for one file: role, number, reference, dates and the quote they came from."""
    role, kind, number, reason = classify(name, pages)
    opening = _opening(pages)
    ref_match = _REF.search(opening)
    rfs_match = _RFS_NO.search(opening)
    date_match = _DATE.search(opening)
    issued = _iso(*date_match.groups()) if date_match else None
    rfs_date = None
    if rfs_match and rfs_match.group(2):
        parts = re.split(r"[./-]", rfs_match.group(2))
        rfs_date = _iso(parts[0], parts[1], parts[2]) if len(parts) == 3 and len(parts[2]) == 4 else None
    if role == "rfs" and issued is None:
        issued = rfs_date
    if issued is None and role in ("amendment", "clarification"):
        any_date = _ANY_DATE.search(opening)
        issued = _iso(*any_date.groups()) if any_date else None
    title = TITLES.get(kind, TITLES.get(role, "Document"))
    if number is not None:
        title = f"{title}-{number:02d}"
    evidence = None
    if reason and pages:
        evidence = {"page": 1, "quote": reason}
    return SetDocument(
        id=doc_id,
        name=name,
        role=role,
        kind=kind,
        title=title,
        number=number,
        ref=ref_match.group(1).rstrip(".,") if ref_match else (rfs_match.group(1).rstrip(".,") if role == "rfs" and rfs_match else None),
        date=issued,
        rfs_no=rfs_match.group(1).rstrip(".,") if rfs_match else None,
        rfs_date=rfs_date,
        pages=len(pages),
        scanned_pages=[page.page_no for page in pages if not page.has_text_layer],
        reason=reason,
        evidence=evidence,
    )


def order(documents: list[SetDocument]) -> list[SetDocument]:
    """The set in the order it applies: RfS, then amendments and clarifications by date and
    number (a later amendment overrides an earlier one), then agreements, then the rest."""
    rank = {"rfs": 0, "amendment": 1, "clarification": 1, "agreement": 2, "other": 3}

    def key(doc: SetDocument) -> tuple[Any, ...]:
        return (rank.get(doc.role, 3), doc.date or "9999", doc.role != "amendment", doc.number or 0, doc.name)

    return sorted(documents, key=key)


def short_ids(documents: list[SetDocument]) -> None:
    """Readable ids in place: rfs, amd1, amd2, clar1, ppa, psa, doc1 ..."""
    seen: dict[str, int] = {}
    for doc in documents:
        base = {"rfs": "rfs", "amendment": "amd", "clarification": "clar"}.get(doc.role) or (
            doc.kind if doc.role == "agreement" else "doc"
        )
        seen[base] = seen.get(base, 0) + 1
        if doc.role in ("amendment", "clarification"):
            doc.id = f"{base}{doc.number or seen[base]}"
        else:
            doc.id = base if seen[base] == 1 else f"{base}{seen[base]}"
    taken: set[str] = set()
    for doc in documents:
        while doc.id in taken:
            doc.id += "x"
        taken.add(doc.id)
