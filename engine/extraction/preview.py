"""Early preview of a tender for the scan screen: for each agent, lines of the document's own
text that bear on its subject, with their page and the matched phrases.

Built from the pages alone (no model, no extraction), so a read job can show it about a
second after the upload while the reading runs. Every line is a verbatim run of a page's text
with its whitespace collapsed; nothing is paraphrased or invented. Agents with no matching
line get an empty list.
"""
from __future__ import annotations

import re
from collections.abc import Iterable
from typing import Any

from engine.extraction.resolver import PageText

MAX_LINES = 40  # per agent
MAX_PER_PAGE = 2  # per agent and page, so the lines come from across the document
LINE_CHARS = 160
MIN_CHARS = 30

_DATE = r"\b\d{1,2}[./-]\d{1,2}[./-](?:\d{4}|\d{2})\b|\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[,.]?\s+\d{4}\b"

# Agent id -> patterns (case-insensitive). The ids match the scan screen's agents.
AGENTS: dict[str, list[str]] = {
    "dates": [
        _DATE,
        r"\blast date\b", r"\bdue date\b", r"\bbid submission\b", r"\bpre[- ]?bid\b", r"\bdeadline\b",
        r"\bopening of\b", r"\be-?reverse auction\b", r"\bletter of award\b", r"\bscheduled commencement\b",
        r"\bscod\b", r"\bfinancial closure\b", r"\bwithin \d+ (?:days|months)\b",
    ],
    "eligibility": [
        r"\beligib\w*", r"\bqualif\w*", r"\bnet[- ]?worth\b", r"\bturnover\b", r"\bliquidity\b",
        r"\bconsortium\b", r"\baffiliate\w*", r"\bparent compan\w*", r"\bexperience\b", r"\btechnical criteria\b",
        r"\bfinancial criteria\b", r"\bbidding company\b",
    ],
    "constraints": [
        r"\b\d[\d,.]*\s*(?:MW|MWh|GW)\b", r"\bcapacity\b", r"\bCUF\b", r"\bcapacity utili[sz]ation\b", r"\bavailability\b",
        r"\bpeak hours?\b", r"\benergy storage\b", r"\bBESS\b", r"\bESS\b", r"\bfirm and dispatchable\b", r"\bround[- ]the[- ]clock\b",
        r"\bgreenshoe\b", r"\bminimum bid\b", r"\bmaximum bid\b", r"\bdemand\b", r"\bISTS\b", r"\bsolar\b", r"\bwind\b", r"\bhybrid\b",
    ],
    "finance": [
        r"\btariff\b", r"(?:₹|\bRs\.?|\bINR)\s?[\d,.]+", r"\blakh\b", r"\bcrore\b", r"\bearnest money\b", r"\bEMD\b",
        r"\bperformance (?:bank )?guarantee\b", r"\bPBG\b", r"\bpayment security\b", r"\bletter of credit\b",
        r"\bpower purchase agreement\b", r"\bPPA\b", r"\bper kWh\b", r"\b/kWh\b", r"\bsuccess charges?\b",
    ],
    "risks": [
        r"\bpenalt\w*", r"\bliquidated damages\b", r"\bcompensation\b", r"\bshortfall\b", r"\bterminat\w*",
        r"\bforce majeure\b", r"\bchange in law\b", r"\bencash\w*", r"\bforfeit\w*", r"\bdeleted\b", r"\bwithdrawn\b",
        r"\bevent of default\b", r"\bdefault\b", r"\bblacklist\w*", r"\bdebar\w*",
    ],
}

_COMPILED = {agent: re.compile("|".join(f"(?:{p})" for p in patterns), re.IGNORECASE) for agent, patterns in AGENTS.items()}
_LEADER = re.compile(r"\.{4,}|…{2,}|_{4,}")  # table-of-contents leaders and blanks to fill in
_SPACE = re.compile(r"\s+")


def _lines(text: str) -> Iterable[str]:
    for raw in text.splitlines():
        line = _SPACE.sub(" ", raw).strip()
        if len(line) >= MIN_CHARS and not _LEADER.search(line):
            yield line


def _heading(line: str) -> bool:
    """A heading or contents entry: mostly capital letters."""
    letters = [c for c in line if c.isalpha()]
    return bool(letters) and sum(c.isupper() for c in letters) / len(letters) > 0.7


def _window(line: str, first: int) -> str:
    """At most LINE_CHARS of the line around the first match, cut at word boundaries."""
    if len(line) <= LINE_CHARS:
        return line
    start = max(0, min(first - LINE_CHARS // 3, len(line) - LINE_CHARS))
    end = start + LINE_CHARS
    if start > 0:
        space = line.find(" ", start)
        start = space + 1 if 0 <= space < first else start
    if end < len(line):
        space = line.rfind(" ", start, end)
        end = space if space > start + MIN_CHARS else end
    return line[start:end]


def build_preview(pages: list[PageText], max_lines: int = MAX_LINES) -> dict[str, Any]:
    """{"pages": n, "text_pages": n, "agents": {agent: [{"page", "text", "hits": [[start, end], ...]}]}}."""
    candidates: dict[str, list[tuple[int, int, str, list[list[int]]]]] = {agent: [] for agent in AGENTS}
    for page in pages:
        if not page.text:
            continue
        per_page: dict[str, list[tuple[int, int, str, list[list[int]]]]] = {agent: [] for agent in AGENTS}
        for line in _lines(page.text):
            for agent, pattern in _COMPILED.items():
                first = pattern.search(line)
                if not first:
                    continue
                snippet = _window(line, first.start())
                hits = [[m.start(), m.end()] for m in pattern.finditer(snippet) if m.end() > m.start()]
                if hits:
                    # body text before headings and contents entries
                    score = len(hits) - (2 if _heading(snippet) else 0)
                    per_page[agent].append((-score, page.page_no, snippet, hits))
        for agent, found in per_page.items():
            candidates[agent].extend(sorted(found)[:MAX_PER_PAGE])
    agents = {}
    for agent, found in candidates.items():
        best = sorted(found)[:max_lines]  # most matches first
        best.sort(key=lambda c: c[1])  # then in document order
        agents[agent] = [{"page": page_no, "text": text, "hits": hits} for _, page_no, text, hits in best]
    return {
        "pages": len(pages),
        "text_pages": sum(1 for p in pages if p.has_text_layer),
        "agents": agents,
    }
