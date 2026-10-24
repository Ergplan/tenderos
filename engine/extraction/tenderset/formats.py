"""The bid formats of an RfS: each "Format 7.x" and "Annexure - X" heading starts a format,
which runs until the next one. A format carries its title, its pages, the heading quote,
what it is printed on (letterhead, stamp paper), when it applies ("Applicable only in case
of Consortium"), who provides it, and its blanks: runs of underscores, dots or dashes and
bracketed instructions ("(Insert name of the Bidder)"), each with the words around it, a
label, a kind (text, date, amount, number) and, where a known bid value fits, the key of
that value (bidder, address, capacity ...), so a form filler can prefill it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from engine.extraction.resolver import PageText, locate

MAX_BLANKS = 80  # per format; a long agreement format has hundreds of dotted runs

_FORMAT = re.compile(r"^\s*(?:FORMAT|Format)\s*[-–:]?\s*(\d{1,2}(?:\.\d{1,2})?)\s*([A-Z])?\s*(?:[:\-–]\s*)?(.*)$")
_ANNEXURE = re.compile(r"^\s*(?:ANNEXURE|Annexure)\s*[-–:]?\s*([A-Z]{1,2}|\d{1,2}|[IVX]{1,4})\s*(?:[:\-–]\s*)?(.*)$")
_ANNEX_TO_FORMAT = re.compile(r"^\s*Annexure\s+to\s+Format\s+([\d.A-Z/ ]+?)\s*$", re.I)
_TOC_LINE = re.compile(r"(?:\.{4,}|…{2,}|\s{3,})\s*\d{1,3}\s*$")
_BLANK = re.compile(r"_{3,}|\.{5,}|…{2,}|(?:…\s*){2,}|-{5,}")
_INSTRUCTION = re.compile(r"[\[(]\s*((?:please\s+)?(?:insert|enter|mention|specify|name\s+of|fill)\b[^\])\n]{2,140})[\])]", re.I)
_PAPER = re.compile(
    r"(letter\s*head[^)\n.]*|non[\s-]*judicial\s+stamp\s+paper[^)\n.]*|e[\s-]*stamp\s+paper[^)\n.]*|stamp\s+paper[^)\n.]*)",
    re.I,
)
_APPLIES = re.compile(r"applicable\s+only\s+(?:in\s+(?:the\s+)?case\s+of|for|if|when|where)\s+([^)\n]{3,90})", re.I)
_BY = re.compile(r"(?:to\s+be\s+(?:provided|submitted|signed|issued|executed|furnished)\s+by)\s+([^)\n]{3,120})", re.I)

KEYS = (
    ("signatory", r"authori[sz]ed\s+signatory|name\s+of\s+(?:the\s+)?signatory|designation|signature"),
    ("rfsNo", r"rfs\s*no|tender\s*no|reference\s+of\s+the\s+rfs"),
    ("bidder", r"name\s+of\s+(?:the\s+)?(?:bidding\s+company|bidder|lead\s+member|company)|bidder'?s?\s+name"),
    ("address", r"address"),
    ("date", r"\bdate\b"),
    ("place", r"\bplace\b"),
    ("capacity", r"\bMW\b|capacity"),
    ("emdAmount", r"\bemd\b|earnest\s+money"),
    ("pbgAmount", r"\bpbg\b|performance\s+(?:bank\s+)?guarantee"),
    ("bank", r"\bbank\b|branch"),
    ("tariff", r"tariff|rs\.?\s*/\s*kwh|inr\s*/\s*kwh"),
    ("netWorth", r"net\s*worth"),
    ("amount", r"\brs\.?\b|\binr\b|amount|₹"),
)


@dataclass
class Format:
    id: str
    title: str
    start: int
    heading: str
    end: int = 0
    lines: list[tuple[int, str]] = field(default_factory=list)


def _clean(text: str) -> str:
    return " ".join(text.split())


def _is_toc(page: PageText) -> bool:
    lines = [line for line in page.text.splitlines() if line.strip()]
    return sum(1 for line in lines if _TOC_LINE.search(line)) >= 6 or bool(re.search(r"table\s+of\s+contents", page.text[:600], re.I))


def _heading(lines: list[str], index: int) -> tuple[str, str] | None:
    """(id, title) when line `index` starts a format, else None."""
    line = lines[index]
    nxt = next((_clean(text) for text in lines[index + 1 : index + 4] if text.strip()), "")
    annex_format = _ANNEX_TO_FORMAT.match(line)
    if annex_format:
        return f"{annex_format.group(1).split('/')[0].strip()}-annex", f"Annexure to Format {annex_format.group(1).strip()}: {nxt}".strip(": ")
    found = _FORMAT.match(line)
    if found:
        rest = _clean(found.group(3) or "")
        if rest and not rest.isupper() and len(rest) > 3:
            return None  # a sentence that mentions a format ("Format 7.3 shall be ...")
        number = found.group(1) + (found.group(2) or "")
        return number, rest or nxt
    found = _ANNEXURE.match(line)
    if found:
        rest = _clean(found.group(2) or "")
        if rest and not rest.isupper():
            return None
        return f"Annexure-{found.group(1)}", rest or nxt
    return None


def find_formats(pages: list[PageText]) -> list[Format]:
    """The formats in page order, each with its lines (page, text)."""
    formats: list[Format] = []
    seen: set[str] = set()
    for page in pages:
        if _is_toc(page):
            continue
        lines = page.text.splitlines()
        for index, line in enumerate(lines):
            head = _heading(lines, index)
            if head and head[0] not in seen:
                fid, title = head
                seen.add(fid)
                formats.append(Format(fid, title.strip(" :-–"), page.page_no, _clean(line)))
            if formats:
                formats[-1].lines.append((page.page_no, line))
    for current, following in zip(formats, formats[1:] + [None]):
        current.end = following.start if following and following.start > current.start else (following.start if following else pages[-1].page_no)
        if following and following.start > current.start:
            current.end = following.start - 1 if _starts_page(pages, following) else following.start
    return formats


def _starts_page(pages: list[PageText], fmt: Format) -> bool:
    page = next((p for p in pages if p.page_no == fmt.start), None)
    if page is None:
        return True
    body = [line for line in page.text.splitlines() if line.strip()]
    # the running header (title, RfS no, page no) takes the first lines; a format that starts
    # within the first lines of the body starts the page
    position = next((i for i, line in enumerate(body) if fmt.heading in _clean(line)), 0)
    return position <= 8


def _label(line: str, start: int, end: int, instruction: str | None) -> str:
    if instruction:
        return _clean(re.sub(r"^(?:please\s+)?(?:insert|enter|mention|specify|fill)\s+(?:the\s+)?", "", instruction, flags=re.I))[:90]
    before = _clean(_BLANK.sub(" ", line[:start]))
    words = re.findall(r"[A-Za-z][\w.&/#-]*", before)
    if words:
        return " ".join(words[-5:]).strip(" :.-")[:90]
    after = _clean(_BLANK.sub(" ", line[end:]))
    return " ".join(re.findall(r"[A-Za-z][\w.&/#-]*", after)[:5])[:90] or "blank"


def _kind(label: str, context: str) -> str:
    text = f"{label} {context}".lower()
    if re.search(r"\bdate\b|dated", label.lower()):
        return "date"
    if re.search(r"\brs\.?\b|\binr\b|amount|₹|lakh|crore", text):
        return "amount"
    if re.search(r"\bmw\b|capacity|number\s+of|\bno\.\s+of", text):
        return "number"
    return "text"


def _key(label: str, context: str) -> str | None:
    for key, pattern in KEYS:
        if re.search(pattern, label, re.I):
            return key
    for key, pattern in KEYS[:4]:
        if re.search(pattern, context, re.I):
            return key
    return None


def blanks(fmt: Format) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen: set[tuple[int, str]] = set()
    for page_no, line in fmt.lines:
        spans: list[tuple[int, int, str | None]] = [(m.start(), m.end(), m.group(1)) for m in _INSTRUCTION.finditer(line)]
        covered = [(start, end) for start, end, _ in spans]
        for m in _BLANK.finditer(line):
            if not any(start <= m.start() < end for start, end in covered):
                spans.append((m.start(), m.end(), None))
        for start, end, instruction in sorted(spans):
            context = _clean(line)
            label = _label(line, start, end, instruction)
            if (page_no, label + context) in seen:
                continue
            seen.add((page_no, label + context))
            out.append(
                {
                    "label": label,
                    "kind": _kind(label, context),
                    "maps": _key(label, context),
                    "page": page_no,
                    "context": context[:200],
                    "instruction": _clean(instruction) if instruction else None,
                }
            )
            if len(out) >= MAX_BLANKS:
                return out
    return out


def _first(pattern: re.Pattern[str], text: str) -> str | None:
    found = pattern.search(text)
    return _clean(found.group(1)).strip(" ,;:") if found else None


def format_json(fmt: Format, pages: dict[int, PageText]) -> dict[str, Any]:
    head = " ".join(line for _, line in fmt.lines[:25])
    page = pages.get(fmt.start)
    found = locate(fmt.heading, page) if page else None
    applies = _first(_APPLIES, head)
    items = blanks(fmt)
    return {
        "id": fmt.id,
        "title": fmt.title,
        "pages": [fmt.start, max(fmt.start, fmt.end)],
        "heading": {
            "doc": "rfs",
            "page": fmt.start,
            "quote": fmt.heading,
            "located": found is not None,
            "bbox": [round(float(x), 2) for x in found.bbox] if found is not None and found.bbox else None,
        },
        "paper": _first(_PAPER, head),
        "applies": f"only {applies}" if applies else "always",
        "submitted_by": _first(_BY, head),
        "blanks": items,
        "blank_count": len(items),
        "maps": sorted({item["maps"] for item in items if item["maps"]}),
    }


def read_formats(pages: list[PageText]) -> list[dict[str, Any]]:
    by_no = {page.page_no: page for page in pages}
    return [format_json(fmt, by_no) for fmt in find_formats(pages)]
