"""The tables of a document, as rows of cell texts on a page, from Docling (docling-serve, when
DOCLING_URL is set) or PyMuPDF's table finder (always available). Amendment and clarification
schedules are such tables; changes.py and clarifications.py read them. Docling's grids are the better read (merged
header cells, rows that wrap), PyMuPDF's the fallback.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from engine.extraction.pages import PDF_LOCK
from engine.extraction.tenderset.docling import DoclingError, convert, docling_available


@dataclass
class Table:
    page: int  # 1-based page of the document
    rows: list[list[str]]  # cell texts, one list per row, spans repeated (Docling) or blank (PyMuPDF)
    source: str = "pymupdf"


@dataclass
class Layout:
    tables: list[Table] = field(default_factory=list)
    source: str = "pymupdf"  # "docling" or "pymupdf"
    warnings: list[str] = field(default_factory=list)


def _clean(text: Any) -> str:
    return " ".join(str(text or "").split())


def tables_from_docling(doc: dict[str, Any]) -> list[Table]:
    """The tables of a DoclingDocument dict, in page order."""
    out: list[Table] = []
    for table in doc.get("tables") or []:
        prov = table.get("prov") or [{}]
        grid = (table.get("data") or {}).get("grid") or []
        rows = [[_clean(cell.get("text")) for cell in row] for row in grid]
        if rows:
            out.append(Table(page=int(prov[0].get("page_no") or 1), rows=rows, source="docling"))
    out.sort(key=lambda t: t.page)
    return out


def tables_from_pymupdf(payload: bytes, max_pages: int | None = None) -> list[Table]:
    """The tables PyMuPDF finds on each page of a PDF (the first max_pages pages, if given)."""
    import pymupdf

    out: list[Table] = []
    with PDF_LOCK, pymupdf.open(stream=payload, filetype="pdf") as pdf:
        for index, page in enumerate(pdf):
            if max_pages is not None and index >= max_pages:
                break
            try:
                found = page.find_tables()
            except Exception:  # noqa: BLE001 - a page whose table finder fails has no tables
                continue
            for table in found.tables:
                rows = [[_clean(cell) for cell in row] for row in table.extract()]
                if rows:
                    out.append(Table(page=index + 1, rows=rows, source="pymupdf"))
    return out


def read_layout(name: str, payload: bytes, use_docling: bool | None = None, docling: Any = None) -> Layout:
    """The tables of a PDF: Docling when available (or `docling`, a DoclingDocument dict to use,
    e.g. in tests), otherwise PyMuPDF. use_docling=False forces PyMuPDF."""
    if docling is not None:
        return Layout(tables_from_docling(docling), "docling")
    want = docling_available() if use_docling is None else use_docling
    warnings: list[str] = []
    if want and name.lower().endswith(".pdf"):
        try:
            return Layout(tables_from_docling(convert(name, payload)), "docling")
        except DoclingError as exc:
            warnings.append(f"{name}: Docling could not read the tables ({exc}); PyMuPDF's table finder was used.")
    if not name.lower().endswith(".pdf"):
        return Layout([], "none", warnings)
    return Layout(tables_from_pymupdf(payload), "pymupdf", warnings)
