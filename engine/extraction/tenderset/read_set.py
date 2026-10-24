"""Read a tender set: the RfS with its amendments, clarifications and agreements, as one result.

  1. pages      every file read (PyMuPDF text with character boxes); scanned pages filled by
                LlamaParse when LLAMA_CLOUD_API_KEY is set
  2. documents  each file classified (rfs, amendment, clarification, agreement) and the set
                put in the order it applies
  3. layout     the tables of each amendment and clarification (Docling via docling-serve
                when DOCLING_URL is set, else PyMuPDF's table finder)
  4. changes    amendment schedules into changes (clause, was, now, quotes, effect); an
                amendment written as prose, with no schedule, is read by the model
                (prompt amendment_changes/v1) when one is available
  5. clarifications  the query/response schedules, with verdicts, linked to the changes
  6. tender     the RfS read as a single document (read_tender), then the changes applied:
                each amended field re-read from the amended text, with its history
  7. formats    the bid formats (Section 7, annexures) with their blanks
  8. process    the Bid Information Sheet and the bid steps, quoted
  9. search     every page cut into passages for Haystack BM25 search

The result is JSON; docs/EXTRACTION.md describes it.
"""

from __future__ import annotations

import base64
import time
from typing import Any, Callable

from pydantic import BaseModel, Field

from engine.extraction.extract import ENGINE, Quote, read_tender, resolve_quote
from engine.extraction.pages import check_readable, is_pdf, read_pages
from engine.extraction.resolver import PageText
from engine.extraction.schema import compile_type
from engine.extraction.tenderset import search as set_search
from engine.extraction.tenderset.changes import Change, Segment, change_json, effect, read_changes
from engine.extraction.tenderset.clarifications import link, read_clarifications
from engine.extraction.tenderset.consolidate import consolidate
from engine.extraction.tenderset.documents import SetDocument, describe, order, short_ids
from engine.extraction.tenderset.formats import read_formats
from engine.extraction.tenderset.layout import read_layout, tables_from_pymupdf
from engine.extraction.tenderset.llamaparse import LlamaParseError, fill_scanned, llamaparse_available
from engine.extraction.tenderset.process import FRONT_PAGES, read_process

Progress = Callable[[int, int, str], None]
MAX_FILES = 20
AMENDMENT_PROMPT = "amendment_changes"
AMENDMENT_VERSION = "v1"


class ProseChange(BaseModel):
    document: str = Field(description="The document amended: RfS, PPA, PSA ...")
    clause: str = Field(description="The clause or article number as printed")
    kind: str = Field(description="modified, added, deleted or replaced")
    existing_quote: str = Field("", description="Verbatim existing words the amendment quotes, if any")
    amended_quote: str = Field("", description="Verbatim amended words, 5 to 60 words")
    page_no: int = Field(1, description="Position of the page in the attached PDF")


class ProseChangesOutput(BaseModel):
    changes: list[ProseChange] = Field(default_factory=list)


def _prose_changes(client: Any, doc: SetDocument, payload: bytes, pages: list[PageText], usage: dict[str, Any]) -> list[dict[str, Any]]:
    """Changes of an amendment written as prose ("Clause 16.1 shall be read as ..."), read by
    the model from the PDF; every quote is located like any other."""
    blocks = [
        {"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": base64.standard_b64encode(payload).decode("ascii")}, "title": doc.name},
        {"type": "text", "text": f"Amendment: {doc.title} ({doc.name}), {len(pages)} pages. List every change it makes."},
    ]
    usage["calls"] += 1
    parsed, used = client.call(AMENDMENT_PROMPT, AMENDMENT_VERSION, blocks, ProseChangesOutput, 8192)
    usage["input_tokens"] += int(used.get("input_tokens", 0))
    usage["output_tokens"] += int(used.get("output_tokens", 0))
    by_no = {page.page_no: page for page in pages}
    out: list[dict[str, Any]] = []
    for number, item in enumerate(parsed.changes, start=1):  # type: ignore[attr-defined]
        page_no = item.page_no if 1 <= item.page_no <= len(pages) else 1
        change = Change(doc.id, item.document or "RfS", number, item.clause, source="model")
        if item.existing_quote.strip():
            change.before.append(Segment(page_no, item.existing_quote))
        if item.amended_quote.strip():
            change.after.append(Segment(page_no, item.amended_quote))
        record = change_json(change, by_no)
        if item.kind in ("modified", "added", "deleted", "replaced"):
            record["kind"] = item.kind
            record["effect"] = effect(change, item.kind)
        out.append(record)
    return out


def _target_docs(documents: list[SetDocument]) -> dict[str, str]:
    """The id of the set's document each amendment target names (RfS -> rfs, PPA -> ppa)."""
    out: dict[str, str] = {}
    for doc in documents:
        if doc.role == "rfs":
            out.setdefault("RfS", doc.id)
        elif doc.role == "agreement":
            out.setdefault(doc.kind.upper(), doc.id)
    return out


def read_set(
    files: list[tuple[str, bytes]],
    tender_type: str = "auto",
    mode: str = "auto",
    progress: Progress | None = None,
    sdk: Any | None = None,
    docling: dict[str, dict[str, Any]] | None = None,
    on_rfs_pages: Callable[[list[PageText]], None] | None = None,
) -> dict[str, Any]:
    """Read a tender set (see the module docstring). files: (name, bytes) pairs, any order.
    docling: DoclingDocument dicts by file name, used instead of docling-serve (tests).
    on_rfs_pages: called with the RfS's pages as soon as the RfS is known (the job's preview)."""
    started = time.monotonic()
    report: Progress = progress or (lambda done, total, step: None)
    if not files:
        raise ValueError("A tender set needs at least one file.")
    if len(files) > MAX_FILES:
        raise ValueError(f"A tender set takes at most {MAX_FILES} files.")
    warnings: list[str] = []
    usage: dict[str, Any] = {"calls": 0, "input_tokens": 0, "output_tokens": 0, "seconds": 0.0}
    total = len(files) + 6
    step = 0

    # 1-2. pages and roles
    loaded: list[tuple[SetDocument, bytes, list[PageText]]] = []
    for index, (name, payload) in enumerate(files):
        report(step, total, f"Reading {name}")
        check_readable(name, payload)
        pages = read_pages(name, payload)
        scanned = [page.page_no for page in pages if not page.has_text_layer]
        if scanned and is_pdf(name, payload):
            if llamaparse_available():
                try:
                    pages, filled = fill_scanned(name, payload, pages)
                    if filled:
                        warnings.append(f"{name}: {len(filled)} scanned page(s) read by LlamaParse; their evidence cannot be highlighted.")
                except LlamaParseError as exc:
                    warnings.append(f"{name}: LlamaParse could not read the scanned pages ({exc}).")
            else:
                warnings.append(f"{name}: {len(scanned)} page(s) are scanned; set LLAMA_CLOUD_API_KEY to read them with LlamaParse.")
        loaded.append((describe(f"doc{index}", name, pages), payload, pages))
        step += 1
    documents = order([doc for doc, _, _ in loaded])
    short_ids(documents)
    by_doc = {id(doc): (payload, pages) for doc, payload, pages in loaded}
    payload_of = {doc.id: by_doc[id(doc)][0] for doc in documents}
    pages_of = {doc.id: by_doc[id(doc)][1] for doc in documents}
    rfs_docs = [doc for doc in documents if doc.role == "rfs"]
    if not rfs_docs:
        warnings.append("No file reads as the RfS itself; amendments and clarifications are listed but not applied.")
    elif len(rfs_docs) > 1:
        warnings.append(f"{len(rfs_docs)} files read as an RfS; {rfs_docs[0].name} is taken as the RfS.")
    rfs = rfs_docs[0] if rfs_docs else None
    if rfs is not None and on_rfs_pages is not None:
        on_rfs_pages(pages_of[rfs.id])

    # 3-5. amendments and clarifications
    from engine.extraction.llm import LLMClient, default_client, llm_available

    model_ok = mode != "rules" and (sdk is not None or llm_available())
    client: Any | None = None
    if model_ok:
        try:
            client = LLMClient(sdk) if sdk is not None else default_client()
        except Exception as exc:  # noqa: BLE001 - rules only
            warnings.append(f"The model could not be reached ({type(exc).__name__}); the set was read by rules.")
    report(step, total, "Reading the amendment and clarification tables")
    changes: list[dict[str, Any]] = []
    clarifications: list[dict[str, Any]] = []
    layouts: dict[str, str] = {}
    for doc in documents:
        if doc.role not in ("amendment", "clarification"):
            continue
        layout = read_layout(doc.name, payload_of[doc.id], docling=(docling or {}).get(doc.name))
        layouts[doc.id] = layout.source
        warnings.extend(layout.warnings)
        if doc.role == "amendment":
            found = read_changes(doc.id, layout.tables, pages_of[doc.id])
            if not found and client is not None and is_pdf(doc.name, payload_of[doc.id]):
                try:
                    found = _prose_changes(client, doc, payload_of[doc.id], pages_of[doc.id], usage)
                except Exception as exc:  # noqa: BLE001 - reported
                    warnings.append(f"{doc.title}: the model could not read the amendment ({type(exc).__name__}: {str(exc)[:120]}).")
            if not found:
                warnings.append(f"{doc.title}: no schedule of changes was found; read the amendment itself.")
            changes.extend(found)
        else:
            found = read_clarifications(doc.id, layout.tables, pages_of[doc.id])
            if not found:
                warnings.append(f"{doc.title}: no query/response table was found; read the clarifications themselves.")
            clarifications.extend(found)
    targets = _target_docs(documents)
    for change in changes:
        change["target_doc"] = targets.get(change["document"])
    link(clarifications, changes)
    step += 1

    # 6. the RfS, amended
    tender: dict[str, Any] | None = None
    amended: list[dict[str, Any]] = []
    formats: list[dict[str, Any]] = []
    process: dict[str, Any] = {"information": [], "steps": []}
    if rfs is not None:
        report(step, total, f"Reading {rfs.name}")
        original = read_tender(
            rfs.name,
            payload_of[rfs.id],
            tender_type=tender_type,
            mode=mode,
            progress=lambda done, all_, label: report(step, total, f"RfS: {label}"),
            sdk=sdk,
        )
        usage["calls"] += original["usage"]["calls"]
        usage["input_tokens"] += original["usage"]["input_tokens"]
        usage["output_tokens"] += original["usage"]["output_tokens"]
        warnings.extend(f"RfS: {note}" for note in original["warnings"])
        step += 1
        report(step, total, "Applying the amendments")
        schema = compile_type(original["tender_type"])
        amendment_pages = {doc.id: pages_of[doc.id] for doc in documents if doc.role == "amendment"}
        tender, amended = consolidate(
            schema,
            original,
            pages_of[rfs.id],
            changes,
            amendment_pages,
            client=client if original["mode"] == "llm" else None,
            warnings=warnings,
            usage=usage,
        )
        step += 1
        # 7-8. formats and process
        report(step, total, "Reading the bid formats and the bid process")
        rfs_pages = pages_of[rfs.id]
        formats = read_formats(rfs_pages)
        format_pages = {page for item in formats for page in range(item["pages"][0], item["pages"][1] + 1)}
        front = tables_from_pymupdf(payload_of[rfs.id], max_pages=FRONT_PAGES) if is_pdf(rfs.name, payload_of[rfs.id]) else []
        process = read_process(rfs_pages, front, format_pages, rfs.id)
        step += 1
    else:
        step += 3

    # 9. search
    report(step, total, "Indexing every page for search")
    passages = [item for doc in documents for item in set_search.passages(doc.to_dict(), pages_of[doc.id])]
    step += 1
    report(total, total, "Done")
    usage["seconds"] = round(time.monotonic() - started, 2)
    return {
        "engine": ENGINE,
        "kind": "set",
        "mode": tender["mode"] if tender else ("llm" if client else "rules"),
        "documents": [
            {**doc.to_dict(), "layout": layouts.get(doc.id), "evidence": _doc_evidence(doc, pages_of[doc.id])} for doc in documents
        ],
        "rfs": rfs.id if rfs else None,
        "tender": tender,
        "amended_fields": amended,
        "changes": changes,
        "clarifications": clarifications,
        "formats": formats,
        "process": process,
        "search": {"engine": set_search.ENGINE, "passages": passages},
        "counts": {
            "documents": len(documents),
            "pages": sum(doc.pages for doc in documents),
            "changes": len(changes),
            "changes_located": sum(
                1 for change in changes if all(e["located"] for e in change["before"]["evidence"] + change["after"]["evidence"])
            ),
            "clarifications": len(clarifications),
            "amended_fields": len({item["path"] for item in amended}),
            "formats": len(formats),
            "blanks": sum(item["blank_count"] for item in formats),
            "steps": len(process["steps"]),
            "passages": len(passages),
        },
        "usage": usage,
        "warnings": warnings,
    }


def _doc_evidence(doc: SetDocument, pages: list[PageText]) -> dict[str, Any] | None:
    if not doc.reason or not pages:
        return None
    evidence = resolve_quote(Quote(1, doc.reason, True), [page.page_no for page in pages[:2]], {page.page_no: page for page in pages[:2]})
    return {**evidence, "doc": doc.id}

