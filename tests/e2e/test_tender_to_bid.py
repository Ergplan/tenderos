"""Browser end to end on one real tender: NHPC FDRE-II RfS through the Tender to Bid workflow.

Signs in, uploads RfS.pdf, checks the capacity the tender allows, picks solar, wind and a
battery, fills the benchmark costs, sizes the plant with HiGHS, checks every tender condition
is met, opens the financial model and downloads the Excel workbook.

Needs the whole stack running (database, engine, web; see README) and a user who may use
the Tender to Bid tab:
    TENDEROS_URL=http://127.0.0.1:3000 TENDEROS_EMAIL=... TENDEROS_PASSWORD=... \
        .venv/bin/python -m pytest tests/e2e/test_tender_to_bid.py -m slow
Optional: PLAYWRIGHT_CHROMIUM (a Chromium binary), E2E_SHOTS (a folder for screenshots),
E2E_IGNORE_HTTPS_ERRORS=1 (a site with a self-signed certificate, such as Caddy on localhost).
Sizing takes about a minute; the test allows 30.
"""
from __future__ import annotations

import os
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
RFS = ROOT / "samples" / "tenders" / "nhpc-fdre-ii" / "RfS.pdf"
URL = os.environ.get("TENDEROS_URL", "").rstrip("/")
EMAIL = os.environ.get("TENDEROS_EMAIL", "")
PASSWORD = os.environ.get("TENDEROS_PASSWORD", "")

pytestmark = [
    pytest.mark.slow,
    pytest.mark.skipif(not (URL and EMAIL and PASSWORD), reason="set TENDEROS_URL, TENDEROS_EMAIL, TENDEROS_PASSWORD"),
    pytest.mark.skipif(not RFS.exists(), reason="NHPC FDRE-II RfS not in samples/"),
]


def _money(text: str) -> float:
    return float(re.sub(r"[^\d.]", "", text))


def test_nhpc_tender_to_bid(tmp_path):
    sync_playwright = pytest.importorskip("playwright.sync_api").sync_playwright
    shots = Path(os.environ.get("E2E_SHOTS") or tmp_path)
    shots.mkdir(parents=True, exist_ok=True)
    errors: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=os.environ.get("PLAYWRIGHT_CHROMIUM") or None)
        ctx = browser.new_context(viewport={"width": 1500, "height": 1000}, accept_downloads=True,
                                  ignore_https_errors=os.environ.get("E2E_IGNORE_HTTPS_ERRORS") == "1")
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))

        page.goto(URL + "/login")
        page.fill("input[type=email]", EMAIL)
        page.fill("input[type=password]", PASSWORD)
        page.click("button[type=submit]")
        page.wait_for_url(URL + "/", timeout=30_000)

        # 1. Tender: upload and read
        page.click("summary:has-text('Read a new tender')")
        page.set_input_files("[data-testid=bid-file]", str(RFS))
        page.click("[data-testid=bid-read]")
        head = page.wait_for_selector("text=264 pages", timeout=240_000).inner_text()
        assert re.search(r"264 pages · \d+ fields read", head), head
        page.screenshot(path=str(shots / "01-tender.png"))

        # 2. Capacity: the bid starts at the most one bidder may offer
        page.click("[data-testid=bid-step-capacity]")
        assert page.locator("input[type=number]").first.input_value() == "600"
        assert page.locator("text=50 to 600 MW").count() >= 1
        page.screenshot(path=str(shots / "02-capacity.png"))

        # 3. Sources: solar, wind and a battery (storage is mandatory); benchmark costs
        page.click("[data-testid=bid-step-sources]")
        for sid, want in [("wind", True), ("biomass", False)]:
            have = "I HAVE IT" in page.locator(f"[data-testid=have-{sid}]").inner_text().upper()
            if have != want:
                page.click(f"[data-testid=have-{sid}]")
        for sid, want in [("solar", True), ("wind", True), ("biomass", False), ("bess", True)]:
            assert ("I HAVE IT" in page.locator(f"[data-testid=have-{sid}]").inner_text().upper()) == want, sid
        page.click("[data-testid=bid-fill]")
        assert page.locator("[data-testid=bid-missing]").count() == 0

        # 4. Size with HiGHS
        page.click("[data-testid=bid-step-size]")
        page.locator("[data-testid=bid-size-again], [data-testid=bid-size]").first.click()
        sizes = page.wait_for_selector("[data-testid=bid-sizes]", timeout=1_800_000)
        page.wait_for_timeout(1500)
        size_text = sizes.inner_text().upper()
        for label in ("SOLAR", "WIND", "BATTERY", "TARIFF"):
            assert label in size_text, size_text
        page.screenshot(path=str(shots / "03-size.png"))

        checklist = page.locator("[data-testid=bid-checklist]")
        checklist.scroll_into_view_if_needed()
        rows = checklist.inner_text()
        page.screenshot(path=str(shots / "04-checklist.png"))
        assert "NOT MET" not in rows.upper(), rows
        assert rows.upper().count("\nMET") >= 7, rows
        # 2 h in 05:00-10:00 and 2 h in 18:00-23:00 as the buying entity schedules (p. 29):
        # every hour of both windows is held to the peak floor
        assert "in each of the 10 hours the procurer may pick" in rows, rows

        # 5. Finance and the Excel model
        page.click("[data-testid=bid-step-finance]")
        page.wait_for_timeout(2000)
        finance = page.locator("[data-testid=bid-finance]").inner_text()
        page.screenshot(path=str(shots / "05-finance.png"))
        tariff = re.search(r"BID TARIFF\s*₹([\d.]+)/kWh", finance)
        irr = re.search(r"EQUITY IRR\s*([\d.]+)%", finance)
        dscr = re.search(r"MINIMUM DSCR\s*([\d.]+)", finance)
        assert tariff and irr and dscr, finance
        assert 2.0 < _money(tariff.group(1)) < 10.0
        assert abs(float(irr.group(1)) - 14.0) < 0.05, "the tariff is solved for the target equity IRR"
        assert float(dscr.group(1)) >= 1.0
        with page.expect_download(timeout=120_000) as dl:
            page.click("[data-testid=bid-download]")
        assert dl.value.suggested_filename.endswith("_financial_model.xlsx")
        out = shots / dl.value.suggested_filename
        dl.value.save_as(str(out))
        assert out.stat().st_size > 10_000
        browser.close()
    assert not errors, errors
