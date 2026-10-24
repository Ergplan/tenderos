"""Draft the SECI RTC-TM-V letter templates from the RfS: each bid format's text, as printed,
with its blanks turned into {{key}} placeholders for the pack's fields.

    .venv/bin/python tools/build_seci_letters.py [--write]

For every format of web/src/seci/seci-rtc-tm-v.json, the RfS pages of the format are read
(the running header and footer dropped), lines are joined into paragraphs (address and
signature lines kept as lines), and each blank run (underscores, dots, dashes, an
"[Insert ...]" instruction) near a field's context quote becomes {{field}}. The draft is
printed (or written to web/src/seci/letters/<id>.js with --write) for a person to check: the
committed templates are the reviewed ones, and tools/check_seci_letters.mjs checks that every
field of every format has its place.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pymupdf
from rapidfuzz import fuzz

ROOT = Path(__file__).resolve().parents[1]
PACK = json.loads((ROOT / "web/src/seci/seci-rtc-tm-v.json").read_text())
RFS = ROOT / "web/public/tenders/seci-rtc-tm-v/RfS.pdf"
OUT = ROOT / "web/src/seci/letters"

HEADER = re.compile(r"^(RfS for 1000 MW RTC Thermal Mimic Power Supply|\(SECI-RTC-TM-V\)|RfS No\. SECI/C&P/IPP/13/0020/25-26|Page \d+ of \d+)\s*$")
BLANK = re.compile(r"(?:_{3,}|(?:…|\.\.)[….\s]*(?:…|\.\.)|…+|-{5,})(?:\s*[\[(](?:insert|enter|name|mention|specify|fill|please)[^\])]{0,160}[\])])?|[\[(](?:insert|enter|mention|specify|please insert|name of)[^\])]{2,160}[\])]", re.I)
SHORT_LINE = 48  # a line this short that does not end a sentence is an address or signature line


def page_lines(pdf, number: int) -> list[str]:
    lines = [line.rstrip() for line in pdf[number - 1].get_text().splitlines()]
    while lines and (not lines[0].strip() or HEADER.match(lines[0].strip())):
        lines.pop(0)
    return lines


def paragraphs(lines: list[str]) -> list[str]:
    """Wrapped lines joined; blank lines and short lines end a paragraph."""
    out: list[str] = []
    current: list[str] = []
    for raw in lines:
        line = raw.strip()
        if not line:
            if current:
                out.append(" ".join(current))
                current = []
            continue
        current.append(line)
        if len(raw) < SHORT_LINE and not re.search(r"[,;:(]$|\b(?:and|or|of|the|to|for|in|by|with)$", line):
            out.append(" ".join(current))
            current = []
    if current:
        out.append(" ".join(current))
    return [re.sub(r"\s+", " ", p).strip() for p in out if p.strip()]


def norm(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')).strip().lower()


def place(text: str, fields: list[dict]) -> tuple[str, list[str]]:
    """Put {{key}} at the blank nearest each field's quote; returns the text and the fields not placed."""
    blanks = [[m.start(), m.end(), []] for m in BLANK.finditer(text)]
    lowered = norm(text)
    missing = []
    for field in fields:
        quote = norm(field["context"]["quote"])
        at = lowered.find(quote[:60]) if quote else -1
        if at < 0 and quote:
            # fuzzy: slide over the text
            best, best_at = 0.0, -1
            for i in range(0, max(1, len(lowered) - len(quote)), 20):
                score = fuzz.ratio(quote[:80], lowered[i : i + min(80, len(quote))])
                if score > best:
                    best, best_at = score, i
            at = best_at if best >= 70 else -1
        if at < 0:
            missing.append(field["key"])
            continue
        end = at + len(quote)
        # the first blank inside the quote or right after it that has no field yet, else the nearest
        candidates = sorted(blanks, key=lambda b: (0 if at - 5 <= b[0] <= end + 120 and not b[2] else 1, abs(b[0] - end)))
        if not candidates:
            missing.append(field["key"])
            continue
        candidates[0][2].append(field["key"])
    out = text
    for start, finish, keys in sorted(blanks, key=lambda b: -b[0]):
        if keys:
            out = out[:start] + ", ".join(f"{{{{{k}}}}}" for k in keys) + out[finish:]
    return out, missing


def draft(fmt: dict, pdf) -> tuple[str, list[str]]:
    first, last = fmt["pages"]
    lines: list[str] = []
    for number in range(first, last + 1):
        page = page_lines(pdf, number)
        if number == first:
            # the format starts at its heading
            head = fmt["heading"]["quote"].split()[:2]
            for i, line in enumerate(page):
                if line.strip().lower().startswith(" ".join(head).lower()):
                    page = page[i:]
                    break
        lines += page + [""]
    paras = paragraphs(lines)
    text = "\n\n".join(paras)
    return place(text, fmt["fields"])


def as_module(fmt: dict, text: str) -> str:
    body = text.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")
    return (
        f"// Format {fmt['id']}: {fmt['title']} (RfS pp. {fmt['pages'][0]}-{fmt['pages'][1]}), the RfS wording with the blanks as\n"
        f"// {{{{key}}}} placeholders. Drafted by tools/build_seci_letters.py, then checked against the RfS by hand.\n"
        f"export default `{body}`;\n"
    )


def main() -> int:
    write = "--write" in sys.argv
    only = [a for a in sys.argv[1:] if not a.startswith("--")]
    pdf = pymupdf.open(str(RFS))
    for fmt in PACK["formats"]:
        if only and fmt["id"] not in only:
            continue
        text, missing = draft(fmt, pdf)
        print(f"==== {fmt['id']} {fmt['title']} pp.{fmt['pages']} missing={missing}")
        if write:
            OUT.mkdir(parents=True, exist_ok=True)
            (OUT / f"{fmt['id']}.js").write_text(as_module(fmt, text))
        else:
            print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
