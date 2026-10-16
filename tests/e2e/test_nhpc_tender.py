"""End to end on one real tender, without a browser: NHPC FDRE-II RfS (264 pages).

1. Read samples/tenders/nhpc-fdre-ii/RfS.pdf with the extraction engine (rules mode, no key).
2. Every field found is located on its page and passes validation.
3. The values agree with the reviewed reading (reviewed-reading.yaml, the tender_engine gold
   record) on every field where both have a value, except the free-text fields listed below.
4. The Tender to Bid terms derived from the reading (web/src/bid/tenderMap.js) are the ones
   the RfS prints, each proved by a located quote (tools/check_nhpc_terms.mjs, needs node).

The browser run of the same tender through sizing and the financial model is
tests/e2e/test_tender_to_bid.py.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from engine.extraction import read_tender  # noqa: E402

TENDER = ROOT / "samples" / "tenders" / "nhpc-fdre-ii"
RFS = TENDER / "RfS.pdf"
GOLD = TENDER / "reviewed-reading.yaml"

# Free text the reviewer rewrote in their own words (summary, title, stated type, demand
# profile prose) or structured fields the reviewer filled with more detail than the rules
# reader produces. These are compared by hand in docs/E2E-NHPC.md, not asserted equal.
WORDING = {
    "core.summary.plain_english_summary",
    "core.identity.title",
    "core.identity.tender_type_as_stated",
    "sector.power.fdre.demand_profile",
    "sector.power.fdre.peak_window_definition",
    "sector.power.fdre.demand_profile_structured",
    "core.penalties.shortfall_rules",
}

pytestmark = pytest.mark.skipif(not RFS.exists(), reason="NHPC FDRE-II RfS not in samples/")


@pytest.fixture(scope="module")
def reading() -> dict:
    return read_tender("RfS.pdf", RFS.read_bytes(), tender_type="auto", mode="rules")


def test_reading_is_fdre_and_every_finding_is_located(reading):
    assert reading["mode"] == "rules"
    assert reading["tender_type"] == "fdre"
    assert reading["document"]["text_pages"] == 264
    counts = reading["counts"]
    assert counts["found"] >= 31
    assert counts["located"] == counts["found"]
    assert counts["validated"] == counts["found"]
    assert counts["rejected"] == 0
    assert counts["needs_review"] == 0


def test_reading_agrees_with_the_reviewed_reading(reading):
    gold = {f["field_path"]: f for f in yaml.safe_load(GOLD.read_text())["fields"]}
    compared, differ = 0, []
    for path, value in reading["values"].items():
        reviewed = gold.get(path, {}).get("final_value")
        if reviewed is None or path in WORDING:
            continue
        compared += 1
        if value != reviewed:
            differ.append((path, value, reviewed))
    assert not differ, differ
    assert compared >= 17


def test_key_terms_have_the_printed_values(reading):
    v = reading["values"]
    assert v["sector.power.common.total_capacity_mw"] == 1200
    assert (v["sector.power.common.min_bid_mw"], v["sector.power.common.max_bid_mw"]) == (50, 600)
    assert v["sector.power.common.ppa_tenure_years"] == 25
    assert v["core.key_dates.bid_submission_deadline"] == "2024-04-12"
    assert v["sector.power.fdre.annual_supply_min_pct"] == 40
    assert v["sector.power.fdre.peak_supply_min_pct"] == 90
    assert v["sector.power.fdre.peak_hours_per_day"] == 4
    assert v["sector.power.fdre.storage_mandatory"] is True


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_tender_to_bid_terms(reading, tmp_path):
    path = tmp_path / "nhpc-reading.json"
    path.write_text(json.dumps(reading))
    run = subprocess.run(["node", "tools/check_nhpc_terms.mjs", str(path)], cwd=ROOT, capture_output=True, text=True)
    assert run.returncode == 0, run.stderr
    assert "all proved" in run.stdout
