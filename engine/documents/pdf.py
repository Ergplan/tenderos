"""HTML parts to one A4 PDF with PyMuPDF's Story, each part from a new page.

The web app sends each SECI bid letter as the HTML it shows (web/src/seci/letters/index.js
letterHtml) and one stylesheet. Story lays the HTML out on A4 with 56pt margins, flowing onto as
many pages as a part needs. The HTML is text, tables and simple inline styles only; Story has no
scripts, no remote resources and no images here, so the input cannot reach outside the engine.
"""

from __future__ import annotations

import io
import re

import pymupdf

MAX_PARTS = 40
MAX_PART_CHARS = 400_000
MAX_CSS_CHARS = 20_000
MAX_PAGES_PER_PART = 40
MARGIN = 56

# Story's base fonts carry no rupee sign; the letters write "Rs." where it would fall
_REPLACE = {"₹": "Rs. ", "–": "-", "—": "-", "‘": "'", "’": "'", "“": '"', "”": '"'}
_BLOCKS = re.compile(r"<\s*(script|style|iframe|object)\b.*?<\s*/\s*\1\s*>", re.I | re.S)
_TAGS = re.compile(r"<\s*/?\s*(script|style|iframe|object|img|image|link|embed|svg|base|meta)\b[^>]*>", re.I)


def _clean(html: str) -> str:
    for a, b in _REPLACE.items():
        html = html.replace(a, b)
    # no images, scripts or external resources: the letters are text and tables
    return _TAGS.sub("", _BLOCKS.sub("", html))


def html_to_pdf(parts: list[str], css: str = "", title: str = "") -> bytes:
    """Lay out each HTML part from a new A4 page; return the PDF bytes."""
    if not parts:
        raise ValueError("No document parts to write.")
    if len(parts) > MAX_PARTS:
        raise ValueError(f"At most {MAX_PARTS} parts in one PDF.")
    if len(css) > MAX_CSS_CHARS:
        raise ValueError("The stylesheet is too long.")
    css = re.sub(r"@import|url\s*\(", "", _clean(css), flags=re.I)
    buf = io.BytesIO()
    writer = pymupdf.DocumentWriter(buf)
    page_rect = pymupdf.paper_rect("a4")
    where = page_rect + (MARGIN, MARGIN, -MARGIN, -MARGIN)
    for part in parts:
        if not isinstance(part, str) or len(part) > MAX_PART_CHARS:
            raise ValueError("A document part is not text or is too long.")
        story = pymupdf.Story(html=_clean(part), user_css=css)
        more, pages = True, 0
        while more:
            pages += 1
            if pages > MAX_PAGES_PER_PART:
                raise ValueError(f"A document part runs past {MAX_PAGES_PER_PART} pages.")
            device = writer.begin_page(page_rect)
            more, _ = story.place(where)
            story.draw(device)
            writer.end_page()
    writer.close()
    doc = pymupdf.open("pdf", buf.getvalue())
    if title:
        doc.set_metadata({"title": title[:200], "producer": "TenderOS"})
    return doc.tobytes(garbage=3, deflate=True)
