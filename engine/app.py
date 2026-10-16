"""The TenderOS engine: one FastAPI service behind the web app.

  /api/health                         engine and extraction status
  /api/bid/tender/*, /api/rtc/tender/*  tender reading (tender_engine extraction)
  /api/bess/parse                     BESS requirements, from the same extraction
  /api/rtc/lp                         HiGHS least-tariff sizing, streamed as NDJSON
  /api/bid/dispatch15[...]            15-minute dispatch of a sized plant for every PPA year

The web app (Next.js) is the only client: it signs users in and forwards these paths.
Run: uvicorn engine.app:app --port 8000
"""

from __future__ import annotations

import base64
import binascii
import json
import math
import queue
import re
import threading
from typing import Any

from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from engine.bess import requirements as BESS
from engine.extraction import TENDER_TYPES, catalog, jobs, llm_available, read_tender
from engine.extraction.extract import MODES, require_llm, resolve_mode
from engine.extraction.llm import model_id
from engine.extraction.pages import UnreadableDocument, check_readable
from engine.sizing import dispatch15 as D15
from engine.sizing import rtc_lp as RLP

MAX_UPLOAD_BYTES = 60 * 1024 * 1024
TENDER_PREFIXES = ("/api/bid/tender", "/api/rtc/tender")
_LP_SLOTS = threading.Semaphore(2)

app = FastAPI(title="TenderOS engine", version="1.0.0")


class UploadFile(BaseModel):
    name: str
    content_base64: str


class ReadRequest(BaseModel):
    file: UploadFile
    tender_type: str = "auto"
    mode: str = "auto"


class BessParseRequest(BaseModel):
    file: UploadFile


def _decode(content: str) -> bytes:
    text = content.strip()
    if text.startswith("data:") and "," in text:
        text = text.split(",", 1)[1]
    text = re.sub(r"\s+", "", text)
    if len(text) > MAX_UPLOAD_BYTES * 4 // 3 + 16:
        raise HTTPException(status_code=413, detail="The file is larger than 60 MB.")
    try:
        payload = base64.b64decode(text, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=400, detail="The file could not be decoded (expected base64).") from exc
    if not payload:
        raise HTTPException(status_code=400, detail="The file is empty.")
    return payload


def _status() -> dict[str, Any]:
    available = llm_available()
    return {
        "llm_available": available,
        "provider": "anthropic" if available else None,
        "model": model_id() if available else None,
        "default_mode": "llm" if available else "rules",
        "require_llm": require_llm(),
        "types": list(TENDER_TYPES),
        "extraction": "tender_engine 5c29b4e",
    }


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "tender_reading": _status()}


def tender_status() -> dict[str, Any]:
    return _status()


def tender_catalog(tender_type: str = Query("fdre")) -> dict[str, Any]:
    if tender_type not in TENDER_TYPES:
        raise HTTPException(status_code=422, detail=f"Unknown tender type {tender_type!r}; one of {list(TENDER_TYPES)}.")
    return catalog(tender_type)


def tender_read(req: ReadRequest, response: Response, sync: int = Query(0)) -> dict[str, Any]:
    payload = _decode(req.file.content_base64)
    if req.tender_type != "auto" and req.tender_type not in TENDER_TYPES:
        raise HTTPException(status_code=422, detail=f"Unknown tender type {req.tender_type!r}; one of auto, {', '.join(TENDER_TYPES)}.")
    if req.mode not in MODES:
        raise HTTPException(status_code=422, detail=f"Unknown mode {req.mode!r}; one of {', '.join(MODES)}.")
    available = llm_available()
    if req.mode == "llm" and not available:
        raise HTTPException(status_code=400, detail="mode=llm needs ANTHROPIC_API_KEY on the engine; use mode=rules or auto.")
    try:
        check_readable(req.file.name, payload)
        resolved = resolve_mode(req.file.name, payload, req.mode, available)
    except (UnreadableDocument, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if sync:
        try:
            return read_tender(req.file.name, payload, tender_type=req.tender_type, mode=req.mode)
        except (UnreadableDocument, ValueError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        except LookupError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    job_id = jobs.start(req.file.name, payload, tender_type=req.tender_type, mode=req.mode)
    response.status_code = 202
    return {"job_id": job_id, "status": "queued", "mode": resolved}


def tender_read_job(job_id: str) -> dict[str, Any]:
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Unknown job.")
    return job


for _prefix in TENDER_PREFIXES:
    app.add_api_route(f"{_prefix}/status", tender_status, methods=["GET"])
    app.add_api_route(f"{_prefix}/catalog", tender_catalog, methods=["GET"])
    app.add_api_route(f"{_prefix}/read", tender_read, methods=["POST"], status_code=200)
    app.add_api_route(f"{_prefix}/read/{{job_id}}", tender_read_job, methods=["GET"])


@app.post("/api/bess/parse")
def bess_parse(req: BessParseRequest) -> dict[str, Any]:
    payload = _decode(req.file.content_base64)
    try:
        check_readable(req.file.name, payload)
        return BESS.parse(req.file.name, payload)
    except (UnreadableDocument, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _finite(value: Any) -> Any:
    """JSON has no Infinity or NaN: send null instead."""
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, dict):
        return {k: _finite(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_finite(v) for v in value]
    return value


@app.post("/api/rtc/lp")
async def rtc_lp(request: Request) -> StreamingResponse:
    """Least-tariff sizing (HiGHS). Streams NDJSON: log lines, progress, then the result."""
    try:
        payload = await request.json()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Body must be JSON") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Body must be a JSON object")
    events: queue.Queue = queue.Queue()

    def work() -> None:
        try:
            if not _LP_SLOTS.acquire(blocking=False):
                events.put({"type": "log", "t": 0, "stage": "highs", "msg": "Another HiGHS run is in progress on this server; waiting for a free slot"})
                _LP_SLOTS.acquire()
            try:
                result = RLP.solve(payload, on_log=lambda line: events.put({"type": "log", **line}), on_progress=lambda p: events.put({"type": "progress", **p}))
            finally:
                _LP_SLOTS.release()
            result.pop("log", None)  # already streamed line by line
            events.put({"type": "result", "result": result})
        except RLP.LpInputError as exc:
            events.put({"type": "error", "error": str(exc)})
        except Exception as exc:  # noqa: BLE001 - report solver failures instead of a dropped stream
            events.put({"type": "error", "error": f"HiGHS run failed: {exc}"})
        finally:
            events.put(None)

    threading.Thread(target=work, daemon=True).start()

    def stream():
        while True:
            item = events.get()
            if item is None:
                break
            yield json.dumps(_finite(item), default=float) + "\n"

    return StreamingResponse(stream(), media_type="application/x-ndjson", headers={"cache-control": "no-cache, no-transform", "x-accel-buffering": "no"})


@app.post("/api/bid/dispatch15")
async def dispatch15_start(request: Request) -> dict[str, Any]:
    """Start the 15-minute dispatch of a sized plant for every PPA year (a job).
    Body: {payload: the sizing request, sizes: {solarMw, ...}, tariff: Rs/kWh, years?: [1..n]}."""
    try:
        body = await request.json()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Body must be JSON") from exc
    if not isinstance(body, dict) or not isinstance(body.get("payload"), dict) or not isinstance(body.get("sizes"), dict):
        raise HTTPException(status_code=400, detail="payload and sizes are required")
    years = body.get("years")
    if years is not None and not (isinstance(years, list) and all(isinstance(y, int) for y in years)):
        raise HTTPException(status_code=400, detail="years must be a list of PPA years")
    try:
        job_id = D15.start(body["payload"], body["sizes"], float(body.get("tariff")), years)
    except (TypeError, ValueError, D15.DispatchError, RLP.LpInputError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"job_id": job_id}


@app.get("/api/bid/dispatch15/{job_id}")
def dispatch15_status(job_id: str) -> dict[str, Any]:
    job = D15.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="No such 15-minute dispatch run (runs are kept for 24 hours)")
    return job


@app.get("/api/bid/dispatch15/{job_id}/zip")
def dispatch15_zip(job_id: str) -> FileResponse:
    path = D15.zip_file(job_id)
    job = D15.get(job_id)
    if path is None or job is None or job.get("status") != "done":
        raise HTTPException(status_code=404, detail="The 15-minute dispatch is not ready")
    return FileResponse(path, media_type="application/zip", filename="dispatch_15min_all_years.zip")
