"""The SECI RTC-TM-V tender pack (web/src/seci/seci-rtc-tm-v.json): every quote behind a bid
condition, an amendment or a clarification is printed on the page it cites, in the document it
names; and the sizing terms agree with the conditions they come from."""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
PACK = json.loads((ROOT / "web" / "src" / "seci" / "seci-rtc-tm-v.json").read_text())
FOLDER = ROOT / "web" / "public" / "tenders" / "seci-rtc-tm-v"


def _norm(text: str) -> str:
    for a, b in (("’", "'"), ("‘", "'"), ("“", '"'), ("”", '"'), ("‑", "-")):
        text = text.replace(a, b)
    return re.sub(r"\s+", " ", text).strip()


@pytest.fixture(scope="module")
def pages():
    pymupdf = pytest.importorskip("pymupdf")
    out = {}
    for doc in PACK["documents"]:
        if doc["file"]:
            pdf = pymupdf.open(str(FOLDER / doc["file"]))
            assert len(pdf) == doc["pages"], doc["id"]
            out[doc["id"]] = [_norm(p.get_text()) for p in pdf]
    return out


def _quotes():
    for c in PACK["changes"]:
        for side in ("before", "after"):
            if c.get(side):
                yield f"change {c['id']} ({side})", c[side]
    for c in PACK["clarifications"]:
        yield f"clarification {c['no']}", c["quote"]
    for c in PACK["conditions"]:
        for i, q in enumerate(c["sources"]):
            yield f"condition {c['id']} [{i}]", q


@pytest.mark.parametrize("name, quote", list(_quotes()), ids=[n for n, _ in _quotes()])
def test_every_quote_is_on_its_page(pages, name, quote):
    assert quote["doc"] in pages, f"{name}: no file for {quote['doc']}"
    assert _norm(quote["quote"]) in pages[quote["doc"]][quote["page"] - 1], f"{name}: not on p. {quote['page']} of {quote['doc']}"


def test_conditions_have_sources_unless_missing():
    for c in PACK["conditions"]:
        assert c["status"] in {"unchanged", "amended", "removed", "ambiguous", "missing"}, c["id"]
        assert bool(c["sources"]) == (c["status"] != "missing"), c["id"]
        if c["status"] in {"amended", "removed", "ambiguous"}:
            assert c.get("by") in {"amd1", "amd2"}, c["id"]


def test_the_sizing_terms_match_the_conditions():
    m = PACK["model"]
    text = {c["id"]: c["value"] for c in PACK["conditions"]}
    assert (m["minBidMw"], m["maxBidMw"]) == (50, 500) and "50 MW to 500 MW" in text["bidSize"]
    assert m["peakFloor"] == 0.9 and "90%" in text["dfrPeak"]
    assert m["offpeakFloor"] == 0.7 and "70%" in text["dfrOffpeak"]
    assert m["penaltyMultiple"] == 1.5 and "1.5" in text["penalty"]
    assert m["peakWindow"] == {"start": 18, "hours": 16} and m["peakHoursChosen"] == 6 and "18:00 and 10:00" in text["peakHours"]
    assert m["scsdMonths"] == 24 and "24 months" in text["scsd"]
    assert m["emdRs"] == {"solarPerMw": 968000, "windPerMw": 1368000, "storagePerMwh": 240000}
    assert m["pbgRs"] == {"solarPerMw": 2420000, "windPerMw": 3420000, "storagePerMwh": 600000}
    assert m["netWorthRs"] == {"solarPerMw": 9680000, "windPerMw": 13680000, "storagePerMwh": 2400000}


def test_documents_are_in_date_order_and_served():
    dated = [d for d in PACK["documents"] if d["date"]]
    assert [d["date"] for d in dated] == sorted(d["date"] for d in dated)
    for d in PACK["documents"]:
        assert (d["file"] is None) == (d["id"] == "rfs"), "only the main RfS is not provided"
        if d["file"]:
            assert (FOLDER / d["file"]).exists()
