"""Amendment schedules into changes. An amendment (or corrigendum) is a table, one row per
change: S. No. | Clause/Article No. | Existing | Amended, grouped by full-width rows naming
the document amended ("Amendments in the RfS document", "... in PPA document"). A row that
wraps onto the next page continues with an empty S. No.

Each change keeps the clause, the existing and the amended text (as segments, one per page,
each located on its page of the amendment with the resolver), what kind of change it is
(modified, replaced, added, deleted), a word diff and a short mechanical effect ("100 MW ->
50 MW"). Nothing is paraphrased: the texts are the cells as printed.
"""

from __future__ import annotations

import difflib
import re
from dataclasses import dataclass, field
from typing import Any

from engine.extraction.extract import Quote, resolve_quote
from engine.extraction.resolver import PageText
from engine.extraction.tenderset.layout import Table

QUOTE_WORDS = 30  # a cell is located by its first words; a full paragraph seldom resolves whole
EFFECT_PAIRS = 3

_SNO = re.compile(r"^\s*(\d{1,3})\s*[.)]?\s*$")
_TARGET = re.compile(r"\b(?:amendments?|changes?|corrigend\w*|modifications?)\s+(?:in|to)\s+(?:the\s+)?(?:draft\s+)?([A-Za-z]+)\b", re.I)
_DELETED = re.compile(r"^\W*(not\s+used|deleted|stands?\s+deleted|omitted|withdrawn)\b", re.I)
_ADDED = re.compile(r"^\W*(addendum\s+to\s+the|new\s+clause|clause\s+added|added\b|inserted\b)", re.I)
_REPLACED = re.compile(r"\b(revised|modified|new)\s+(annexure|schedule|format|appendix)\s+(is|are)\s+enclosed", re.I)
_NEW_TEXT = re.compile(r"^\W*(?:(?:clause|article|para\w*|schedule|annexure)\s+(?:is\s+)?(?:modified|substituted|replaced|revised)\s+as\s+(?:follows|under)|addendum\s+to\s+the)", re.I)
_BROKEN_WORD = re.compile(r"\b([A-Z][a-z]{3,})\s([a-z]{1,3})\b")
_KEY_STOP = {"clause", "article", "sl", "no", "and", "of", "the", "rfs", "ppa", "psa", "sub", "para", "s"}


def clean(text: Any) -> str:
    return " ".join(str(text or "").split())


def clause_label(text: str) -> str:
    """A clause number as printed, with words a narrow column broke rejoined
    ("Annexu re-A" -> "Annexure-A", "13.1.1.( i)" -> "13.1.1.(i)")."""
    label = _BROKEN_WORD.sub(lambda m: m.group(1) + m.group(2), clean(text))
    label = re.sub(r"\(\s+", "(", label)
    label = re.sub(r"\s+\)", ")", label)
    label = label.replace("“", '"').replace("”", '"')
    label = re.sub(r'\s*"\s*([^"]*?)\s*"', r' "\1"', label)
    return label.strip(" .")


def clause_key(text: str) -> tuple[str, ...]:
    """Tokens of a clause number for matching: "Clause 8.1(c)", "8.1.c" and "8.1 c" -> 8, 1, c."""
    tokens = re.findall(r"[a-z]+|\d+", clause_label(text).lower())
    return tuple(token for token in tokens if token not in _KEY_STOP)


def same_clause(a: tuple[str, ...], b: tuple[str, ...]) -> bool:
    """One clause key is the other or a parent of it (8.1 and 8.1.c), with at least two
    tokens in common unless both are a single token."""
    if not a or not b:
        return False
    n = min(len(a), len(b))
    if n == 1 and len(a) != len(b):
        return False
    return a[:n] == b[:n]


def target_name(word: str) -> str:
    lowered = word.lower()
    return {"rfs": "RfS", "rfp": "RfS", "tender": "RfS", "bid": "RfS", "ppa": "PPA", "psa": "PSA", "bespa": "BESPA", "tsa": "TSA"}.get(
        lowered, word.upper() if len(word) <= 5 else word.title()
    )


@dataclass
class Segment:
    page: int
    text: str


@dataclass
class Change:
    doc: str
    document: str  # the document amended: RfS, PPA, PSA ...
    sno: int
    clause: str
    before: list[Segment] = field(default_factory=list)
    after: list[Segment] = field(default_factory=list)
    source: str = "table"
    merged: bool = False  # one cell across both columns: the new text, the old one not quoted

    @property
    def before_text(self) -> str:
        return clean(" ".join(segment.text for segment in self.before))

    @property
    def after_text(self) -> str:
        return clean(" ".join(segment.text for segment in self.after))

    @property
    def id(self) -> str:
        return f"{self.doc}-{self.document.lower()}-{self.sno}"


def _header_map(row: list[str]) -> dict[str, int] | None:
    lowered = [cell.lower() for cell in row]
    if not any(re.search(r"\bs\.?\s*no\b|\bsr\.?\s*no\b|\bsl\.?\s*no\b", cell) for cell in lowered):
        return None
    existing = [i for i, cell in enumerate(lowered) if re.search(r"\bexisting|\boriginal|\bas\s+per\s+rfs|\bpresent", cell)]
    amended = [i for i, cell in enumerate(lowered) if re.search(r"\bamended|\brevised|\bmodified|\bsubstituted|\bto\s+be\s+read|\bnow\s+read", cell)]
    if not existing or not amended:
        return None
    clause = [i for i, cell in enumerate(lowered) if re.search(r"clause|article|section|page|reference", cell)]
    return {"sno": 0, "clause": clause[0] if clause else 1, "before": existing[0], "after": amended[-1]}


def _width_map(width: int) -> dict[str, int] | None:
    if width < 4:
        return None
    return {"sno": 0, "clause": 1, "before": 2, "after": width - 1}


def _target_row(row: list[str]) -> str | None:
    texts = {cell for cell in row if cell}
    if len(texts) != 1:
        return None
    found = _TARGET.search(next(iter(texts)))
    return target_name(found.group(1)) if found else None


def _add(segments: list[Segment], page: int, text: str) -> None:
    text = clean(text)
    if not text:
        return
    if any(segment.text == text for segment in segments):  # a cell repeated by a span
        return
    segments.append(Segment(page, text))


def changes_from_tables(doc_id: str, tables: list[Table], default_target: str = "RfS") -> list[Change]:
    """The changes of an amendment schedule, in printed order."""
    changes: list[Change] = []
    current: Change | None = None
    target = default_target
    columns: dict[str, int] | None = None
    header_width = 0
    for table in tables:
        width = max((len(row) for row in table.rows), default=0)
        mapping = columns if columns and width == header_width else _width_map(width)
        for row in table.rows:
            if not any(row):
                continue
            header = _header_map(row)
            if header:
                columns, header_width, mapping = header, len(row), header
                continue
            named = _target_row(row)
            if named:
                target, current = named, None
                continue
            if mapping is None or len(row) <= max(mapping.values()):
                continue
            first = clean(row[mapping["sno"]])
            sno = _SNO.match(first)
            if sno:
                number = int(sno.group(1))
                clause = clause_label(row[mapping["clause"]])
                if current and current.sno == number and current.document == target:
                    pass  # the same row again (a merged cell, or a table nested in the cell)
                else:
                    current = Change(doc_id, target, number, clause)
                    changes.append(current)
                _add(current.before, table.page, row[mapping["before"]])
                _add(current.after, table.page, row[mapping["after"]])
                continue
            if first or len({cell for cell in row if cell}) == 1 and not clean(row[mapping["before"]]):
                # a title row, or a row of another table (an illustration) - not part of a change
                if first:
                    current = None
                continue
            if current is not None:
                _add(current.before, table.page, row[mapping["before"]])
                _add(current.after, table.page, row[mapping["after"]])
    for change in changes:
        _unmerge(change)
    return changes


def _unmerge(change: Change) -> None:
    """A cell spanning both columns ("Clause modified as follows: ...", "Not used.") is read
    into both, or into the first: it is the new text, and the existing text is not quoted."""
    before, after = change.before_text, change.after_text
    whole = _DELETED.match(before) or _REPLACED.search(before) or _NEW_TEXT.match(before)
    if before and (before == after or (not after and whole)):
        change.after, change.before, change.merged = change.before, [], True


def kind_of(change: Change) -> str:
    before, after = change.before_text, change.after_text
    if _DELETED.match(after) or (not after and _DELETED.match(before)):
        return "deleted"
    if _REPLACED.search(after):
        return "replaced"
    if change.merged and not _ADDED.match(after):
        return "modified"
    if not before or _ADDED.match(before) or _ADDED.match(after):
        return "added"
    return "modified"


def _tokens(text: str) -> list[str]:
    return re.findall(r"[\w.,:%/₹-]+|[^\w\s]", text)


def _alnum(text: str) -> str:
    return re.sub(r"[^0-9a-z]", "", text.lower())


def word_diff(before: str, after: str) -> list[list[str]]:
    """[op, text] runs: "=" unchanged, "-" removed, "+" added."""
    a, b = _tokens(before), _tokens(after)
    runs: list[list[str]] = []
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if op == "equal":
            runs.append(["=", " ".join(a[i1:i2])])
            continue
        if i2 > i1:
            runs.append(["-", " ".join(a[i1:i2])])
        if j2 > j1:
            runs.append(["+", " ".join(b[j1:j2])])
    return runs


def effect(change: Change, kind: str) -> str:
    """A mechanical one-line effect: what was replaced by what, or what happened to the clause."""
    if kind == "deleted":
        return f"{change.document} {change.clause} is deleted ('{(change.after_text or change.before_text)[:40]}')."
    if kind == "replaced":
        return f"{change.document} {change.clause} is replaced by the revised version enclosed with the amendment."
    before, after = change.before_text, change.after_text
    if change.merged and kind == "added":
        return f"Text added to {change.document} {change.clause}."
    if change.merged:
        return f"{change.document} {change.clause} now reads as the amendment gives it (the existing text is not quoted)."
    if kind == "added" and not before:
        return f"Text added to {change.document} {change.clause}."
    a, b = _tokens(before), _tokens(after)
    matcher = difflib.SequenceMatcher(None, a, b, autojunk=False)
    pairs: list[str] = []
    for op, i1, i2, j1, j2 in matcher.get_opcodes():
        if op != "replace" or i2 - i1 > 8 or j2 - j1 > 8:
            continue
        left, right = " ".join(a[i1:i2]), " ".join(b[j1:j2])
        if _alnum(left) == _alnum(right):  # punctuation or spacing only
            continue
        # carry the next word for units ("100" -> "50" reads better as "100 MW" -> "50 MW")
        if i2 < len(a) and j2 < len(b) and a[i2] == b[j2] and a[i2].isalpha() and len(a[i2]) <= 6:
            left, right = f"{left} {a[i2]}", f"{right} {b[j2]}"
        pairs.append(f"'{left}' -> '{right}'")
        if len(pairs) == EFFECT_PAIRS:
            break
    ratio = matcher.ratio()
    if pairs and ratio >= 0.5:
        return "; ".join(pairs) + "."
    if kind == "added":
        return f"Text added to {change.document} {change.clause}."
    if ratio >= 0.9:
        return f"{change.document} {change.clause}: a few words change (see the diff)."
    return f"{change.document} {change.clause} is rewritten ({round(ratio * 100)}% of the words kept)."


def _snippet(text: str) -> str:
    words = text.lstrip("…. ").split()
    return " ".join(words[:QUOTE_WORDS])


def locate(segments: list[Segment], doc_id: str, pages: dict[int, PageText]) -> list[dict[str, Any]]:
    """Evidence for each segment on its page of the amendment (the resolver's output, plus doc)."""
    out: list[dict[str, Any]] = []
    for segment in segments:
        snippet = _snippet(segment.text)
        if not snippet:
            continue
        evidence = resolve_quote(Quote(segment.page, snippet, segment.page in pages), [segment.page], pages)
        if not evidence["located"] and len(snippet.split()) > 12:
            evidence = resolve_quote(Quote(segment.page, " ".join(snippet.split()[:12]), segment.page in pages), [segment.page], pages)
        evidence["doc"] = doc_id
        out.append(evidence)
    return out


def change_json(change: Change, pages: dict[int, PageText]) -> dict[str, Any]:
    kind = kind_of(change)
    return {
        "id": change.id,
        "doc": change.doc,
        "document": change.document,
        "sno": change.sno,
        "clause": change.clause,
        "clause_key": list(clause_key(change.clause)),
        "kind": kind,
        "before": {"text": change.before_text, "evidence": locate(change.before, change.doc, pages)},
        "after": {"text": change.after_text, "evidence": locate(change.after, change.doc, pages)},
        "diff": word_diff(change.before_text, change.after_text),
        "effect": effect(change, kind),
        "pages": sorted({segment.page for segment in change.before + change.after}),
        "merged": change.merged,
        "source": change.source,
    }


def read_changes(doc_id: str, tables: list[Table], pages: list[PageText]) -> list[dict[str, Any]]:
    by_no = {page.page_no: page for page in pages}
    return [change_json(change, by_no) for change in changes_from_tables(doc_id, tables)]
