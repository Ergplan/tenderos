"""Docling for a tender set's layout: tables (amendment and clarification schedules) and
headings, read by a docling-serve container (DOCLING_URL, e.g. http://docling:5001) so the
engine image carries no ML models. Without DOCLING_URL, or when the service fails, the
reader falls back to PyMuPDF's table finder (tenderset/layout.py).

docling-serve API: POST /v1/convert/file/async (multipart `files`, `to_formats=json`) answers
with {task_id}; GET /v1/status/poll/{task_id} until task_status is "success"; GET
/v1/result/{task_id} gives {document: {json_content: <DoclingDocument>}, status}. Always the
task form: the synchronous endpoint gives up after DOCLING_SERVE_MAX_SYNC_WAIT (120 s by
default), shorter than a first conversion that loads the layout models.
"""

from __future__ import annotations

import os
import time
from typing import Any

import httpx


class DoclingError(RuntimeError):
    """docling-serve could not convert the file."""


def docling_url() -> str:
    return (os.environ.get("DOCLING_URL") or "").rstrip("/")


def docling_available() -> bool:
    return bool(docling_url())


def _timeout() -> float:
    try:
        return max(30.0, float(os.environ.get("DOCLING_TIMEOUT_SECONDS") or 900))
    except ValueError:
        return 900.0


def _options(page_range: tuple[int, int] | None) -> dict[str, Any]:
    # text-layer PDFs: no OCR (scanned pages go to LlamaParse when it is set up); accurate tables
    options: dict[str, Any] = {"to_formats": "json", "do_ocr": "false", "table_mode": "accurate", "abort_on_error": "false"}
    if page_range:
        options["page_range"] = [str(page_range[0]), str(page_range[1])]
    return options


def _document(answer: dict[str, Any]) -> dict[str, Any]:
    doc = (answer.get("document") or {}).get("json_content")
    if not doc:
        errors = answer.get("errors") or []
        raise DoclingError(f"docling-serve returned no document ({answer.get('status')}: {errors[:1]})")
    return doc


def convert(
    name: str,
    payload: bytes,
    page_range: tuple[int, int] | None = None,
    client: httpx.Client | None = None,
    poll_seconds: float = 2.0,
) -> dict[str, Any]:
    """The DoclingDocument (as a dict) for one PDF. client: an httpx client to use instead of
    a new one (tests pass one with a mock transport). Raises DoclingError."""
    base = docling_url()
    if not base:
        raise DoclingError("DOCLING_URL is not set")
    own = client is None
    http = client or httpx.Client(timeout=_timeout())
    files = {"files": (name, payload, "application/pdf")}
    data = _options(page_range)
    try:
        res = http.post(f"{base}/v1/convert/file/async", files=files, data=data)
        if res.status_code >= 400:
            raise DoclingError(f"docling-serve answered {res.status_code}: {res.text[:200]}")
        task = res.json().get("task_id")
        if not task:
            raise DoclingError("docling-serve gave no task id")
        deadline = time.monotonic() + _timeout()
        while True:
            status = http.get(f"{base}/v1/status/poll/{task}").json()
            state = str(status.get("task_status") or "").lower()
            if state in ("success", "partial_success"):
                break
            if state in ("failure", "revoked"):
                raise DoclingError(f"docling-serve task {state}")
            if time.monotonic() > deadline:
                raise DoclingError("docling-serve took too long")
            time.sleep(poll_seconds)
        return _document(http.get(f"{base}/v1/result/{task}").json())
    except httpx.HTTPError as exc:
        raise DoclingError(f"docling-serve unreachable: {exc}") from exc
    finally:
        if own:
            http.close()
