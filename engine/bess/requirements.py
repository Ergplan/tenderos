"""BESS Tender: the requirements the BESS tab needs, read by the tender_engine extraction
(tender type `bess`). Replaces FDRE's `fdre_bess_tender.py`, which had its own regex reader:
here every value comes from the same extraction as every other tab, with its page and quote.

A requirement the reading does not prove keeps the tab's default value, marked `found: false`
and confidence "low", exactly as the earlier reader did, so the bid can still be priced while
the gap is visible.
"""

from __future__ import annotations

import time
from typing import Any

from engine.extraction import read_tender

# key, label, unit, default when not read, field path(s), transform
_REQ: list[tuple[str, str, str, Any, tuple[str, ...], Any]] = [
    ("powerMw", "Contracted power", "MW", 250.0, ("sector.power.bess.capacity_mw", "sector.power.common.total_capacity_mw"), float),
    ("energyMwh", "Contracted energy", "MWh", 500.0, ("sector.power.bess.capacity_mwh", "sector.power.common.total_capacity_mwh"), float),
    ("cyclesPerDay", "Cycles per day", "cycles/day", 1.0, ("sector.power.bess.cycles_per_day",), float),
    ("minRte", "Minimum round-trip efficiency", "", 0.85, ("sector.power.bess.round_trip_efficiency_guarantee_percent",), lambda v: float(v) / 100),
    ("availability", "Minimum availability", "", 0.95, ("sector.power.bess.availability_floor_percent",), lambda v: float(v) / 100),
    ("contractYears", "Contract term", "years", 12.0, ("sector.power.common.ppa_tenure_years",), float),
    ("scodMonths", "Commissioning (SCOD)", "months", 18.0, ("sector.power.common.scod_months",), float),
    ("ceilingTariff", "Ceiling tariff", "₹/MW/month", None, ("sector.power.bess.capacity_charge_inr_lakh_per_mw_month",), lambda v: float(v) * 1e5),
    ("vgfLakhPerMwh", "VGF support", "lakh/MWh", 0.0, ("sector.power.bess.vgf_inr",), lambda v: float(v) / 1e5),
    ("minBidMw", "Minimum bid", "MW", None, ("sector.power.common.min_bid_mw",), float),
    ("maxBidMw", "Maximum bid", "MW", None, ("sector.power.common.max_bid_mw",), float),
    ("emdLakhPerMw", "Bid security (EMD)", "lakh/MW", None, ("core.guarantees.emd_per_mw_inr",), lambda v: float(v) / 1e5),
    ("pbgLakhPerMw", "Performance security (PBG)", "lakh/MW", None, ("core.guarantees.pbg_per_mw_inr",), lambda v: float(v) / 1e5),
    ("availabilityPenalty", "Availability shortfall penalty", "", "Not found; review the penalty clauses", ("sector.power.bess.availability_penalty",), str),
    ("maintainCapacity", "Capacity maintained for the full term", "", True, ("sector.power.bess.augmentation_obligation",), lambda v: True),
    ("location", "Location", "", "Not stated", ("sector.power.common.delivery_point", "sector.power.common.location_constraint"), str),
]
DATES = [
    ("core.key_dates.nit_date", "Date of issue"),
    ("core.key_dates.query_deadline", "Last date for queries"),
    ("core.key_dates.pre_bid_meeting_date", "Pre-bid meeting"),
    ("core.key_dates.bid_submission_deadline", "Bid submission deadline"),
    ("core.key_dates.technical_opening_date", "Technical bid opening"),
    ("core.key_dates.era_date", "e-Reverse auction"),
]


def _fields(result: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {f["path"]: f for section in result.get("sections", []) for f in section.get("fields", [])}


def _proved(f: dict[str, Any] | None) -> bool:
    return bool(f) and f.get("status") in ("validated", "needs_review") and f.get("value") is not None and any(e.get("located") for e in f.get("evidence") or [])


def _source(f: dict[str, Any]) -> dict[str, Any]:
    ev = next((e for e in f.get("evidence") or [] if e.get("located")), None) or (f.get("evidence") or [{}])[0]
    return {"page": ev.get("page"), "clause": None, "snippet": ev.get("quote"), "field": f["path"], "status": f.get("status")}


def _display(value: Any, unit: str) -> str:
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, float):
        return f"{value:g} {unit}".strip()
    return str(value)


def requirements_from(result: dict[str, Any]) -> list[dict[str, Any]]:
    fields = _fields(result)
    out: list[dict[str, Any]] = []
    for key, label, unit, default, paths, transform in _REQ:
        hit = next((fields[p] for p in paths if _proved(fields.get(p))), None)
        if hit is not None:
            try:
                value = transform(hit["value"])
            except (TypeError, ValueError):
                hit = None
        if hit is None:
            out.append({"key": key, "label": label, "value": default, "unit": unit, "display": "Not stated" if default is None else _display(default, unit) + " (default)",
                        "confidence": "low", "found": False, "note": "Not read from the document; the default is used until you enter the tender's value."})
            continue
        confidence = "high" if hit.get("status") == "validated" else "medium"
        out.append({"key": key, "label": label, "value": value, "unit": unit, "display": hit.get("display") or _display(value, unit),
                    "confidence": confidence, "found": True, "note": hit.get("rationale") or "", **_source(hit)})
    # derived: discharge duration, cycles per year
    by = {r["key"]: r for r in out}
    p, e = by["powerMw"], by["energyMwh"]
    dur = round(e["value"] / p["value"], 2) if p["value"] else 2.0
    out.append({"key": "durationH", "label": "Discharge duration", "value": dur, "unit": "h", "display": f"{dur:g} h",
                "confidence": "medium" if p["found"] and e["found"] else "low", "found": p["found"] and e["found"], "note": "energy ÷ power"})
    cyc = by["cyclesPerDay"]
    out.append({"key": "annualCycles", "label": "Cycles per year", "value": round(cyc["value"] * 365), "unit": "cycles/yr", "display": f"{round(cyc['value'] * 365)} cycles/yr",
                "confidence": cyc["confidence"], "found": cyc["found"], "note": "cycles per day × 365"})
    return out


def parse(name: str, payload: bytes) -> dict[str, Any]:
    started = time.monotonic()
    result = read_tender(name, payload, tender_type="bess", mode="auto")
    reqs = requirements_from(result)
    values = result.get("values") or {}
    fields = _fields(result)
    timeline = []
    for path, label in DATES:
        f = fields.get(path)
        if _proved(f):
            timeline.append({"Event": label, "Date": f.get("display") or f["value"], "Page": _source(f)["page"]})
    flags = [{"Field": f["label"], "Check": i["message"]} for f in fields.values() for i in f.get("issues") or [] if not i.get("warning")]
    found = sum(1 for r in reqs if r["found"])
    warnings = list(result.get("warnings") or [])
    if result.get("detected_type") not in (None, "bess") and result.get("tender_type") == "bess":
        warnings.append("This document does not look like a battery storage tender; check the extracted values.")
    return {
        "source_name": name,
        "title": values.get("core.identity.title") or name,
        "metadata": {"issuer": values.get("core.identity.issuing_agency"), "rfs_no": values.get("core.identity.tender_number"), "rfs_date": values.get("core.key_dates.nit_date")},
        "is_bess": True,
        "requirements": reqs,
        "found": found,
        "total": len(reqs),
        "timeline": timeline,
        "risk_flags": flags[:12],
        "amendments": [],
        "extraction": {"engine": f"tender_engine extraction ({result.get('mode')}{', ' + result['model'] if result.get('model') else ''})", "pages": (result.get("document") or {}).get("pages")},
        "reading": {"mode": result.get("mode"), "model": result.get("model"), "counts": result.get("counts")},
        "warnings": warnings,
        "seconds": round(time.monotonic() - started, 2),
    }
