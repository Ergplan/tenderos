"""Browser end to end: the Tender to Bid journey.

* test_nhpc_tender_to_bid: from the start screen, uploads the NHPC FDRE-II RfS, watches the scan
  screen (every scrolled line is on its page of the PDF, the key dates lock in with their page),
  then checks the capacity the tender allows, picks solar, wind and a battery, fills the benchmark
  costs, sizes the plant with HiGHS, checks every tender condition is met, opens the financial
  model and downloads the Excel workbook.
* test_prefilled_simulation: the prefilled WBSEDCL tender opens straight in the workflow.
* test_skip_and_reduced_motion: both reach the workflow without the animation.
* test_bess_tender_goes_to_the_bess_tab: a standalone battery tender is handed to the BESS tab.

Needs the whole stack running (database, engine, web; see README) and a user who may use
the Tender to Bid tab:
    TENDEROS_URL=http://127.0.0.1:3000 TENDEROS_EMAIL=... TENDEROS_PASSWORD=... \
        .venv/bin/python -m pytest tests/e2e/test_tender_to_bid.py -m slow
Optional: PLAYWRIGHT_CHROMIUM (a Chromium binary), E2E_SHOTS (a folder for screenshots),
E2E_IGNORE_HTTPS_ERRORS=1 (a site with a self-signed certificate, such as Caddy on localhost).
Sizing takes about a minute; the test allows 30.
"""
from __future__ import annotations

import contextlib
import os
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
RFS = ROOT / "samples" / "tenders" / "nhpc-fdre-ii" / "RfS.pdf"
URL = os.environ.get("TENDEROS_URL", "").rstrip("/")
EMAIL = os.environ.get("TENDEROS_EMAIL", "")
PASSWORD = os.environ.get("TENDEROS_PASSWORD", "")
# A demo deployment (DEMO_MODE=1, no sign-in), possibly behind the app chooser of deploy/shared-vm
DEMO = os.environ.get("TENDEROS_DEMO") == "1"

pytestmark = [
    pytest.mark.slow,
    pytest.mark.skipif(not (URL and (DEMO or (EMAIL and PASSWORD))), reason="set TENDEROS_URL and TENDEROS_EMAIL, TENDEROS_PASSWORD (or TENDEROS_DEMO=1)"),
    pytest.mark.skipif(not RFS.exists(), reason="NHPC FDRE-II RfS not in samples/"),
]


def _money(text: str) -> float:
    return float(re.sub(r"[^\d.]", "", text))


def _flat(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


@contextlib.contextmanager
def _session(**context):
    """A browser page on the start screen (signed in, or through the demo and the app chooser)."""
    sync_playwright = pytest.importorskip("playwright.sync_api").sync_playwright
    errors: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=os.environ.get("PLAYWRIGHT_CHROMIUM") or None)
        ctx = browser.new_context(viewport={"width": 1500, "height": 1000}, accept_downloads=True,
                                  ignore_https_errors=os.environ.get("E2E_IGNORE_HTTPS_ERRORS") == "1", **context)
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        if DEMO:
            page.goto(URL + "/")
            if page.locator("text=Choose an app").count():
                page.click("a[href='/__switch/new']")
            page.wait_for_selector("[data-testid=bid-start]", timeout=60_000)
            assert page.locator("input[type=password]").count() == 0, "demo mode needs no sign-in"
        else:
            page.goto(URL + "/login")
            page.fill("input[type=email]", EMAIL)
            page.fill("input[type=password]", PASSWORD)
            page.click("button[type=submit]")
            page.wait_for_selector("[data-testid=bid-start]", timeout=60_000)
        yield page
        browser.close()
    assert not errors, errors


def _upload(page, path: Path) -> None:
    page.set_input_files("[data-testid=bid-file]", str(path))
    page.click("[data-testid=bid-read]")


def test_nhpc_tender_to_bid(tmp_path):
    pymupdf = pytest.importorskip("pymupdf")
    shots = Path(os.environ.get("E2E_SHOTS") or tmp_path)
    shots.mkdir(parents=True, exist_ok=True)
    pdf_pages = {i + 1: _flat(pg.get_text()) for i, pg in enumerate(pymupdf.open(str(RFS)))}
    with _session() as page:
        page.screenshot(path=str(shots / "00-start.png"))

        # 1. Upload: the scan screen reads the tender with five agents
        _upload(page, RFS)
        page.wait_for_selector("[data-testid=scan-stage]", timeout=30_000)
        for agent in ("dates", "eligibility", "constraints", "finance", "risks"):
            assert page.locator(f"[data-testid=scan-agent-{agent}]").count() == 1, agent
        page.wait_for_function("document.querySelectorAll('[data-testid=scan-line]').length >= 20", timeout=120_000)
        page.screenshot(path=str(shots / "01-scan.png"))
        # one snapshot of the scrolling lines: each one's page and text read together
        snapshot = page.evaluate("""() => [...document.querySelectorAll('[data-testid=scan-line]')]
            .map((el) => [Number(el.dataset.page), el.innerText])""")
        assert len(snapshot) >= 20
        for number, raw in snapshot:
            text = re.sub(r"^p\.\d+\s*", "", _flat(raw))
            assert text in pdf_pages[number], (number, text)
        page.wait_for_selector("[data-testid=scan-summary]", timeout=240_000)
        dates = page.locator("[data-testid=scan-agent-dates]").inner_text()
        assert "Bid submission deadline" in dates and "12 Apr 2024" in dates and "p. 22" in dates, dates
        summary = page.locator("[data-testid=scan-summary]").inner_text()
        assert "264 pages" in summary and "every value on its page" in summary, summary
        page.screenshot(path=str(shots / "02-scan-done.png"))

        # then the workflow, on the new tender
        head = page.wait_for_selector("[data-testid=bid-tender-head]", timeout=30_000)
        assert "2024_NHPC_800202_1" in head.inner_text()
        assert re.search(r"264 pages · \d+ fields read", page.locator(".bid-page").inner_text())
        page.screenshot(path=str(shots / "03-tender.png"))

        # 2. Capacity: the bid starts at the most one bidder may offer
        page.click("[data-testid=bid-step-capacity]")
        assert page.locator("input[type=number]").first.input_value() == "600"
        assert page.locator("text=50 to 600 MW").count() >= 1
        page.screenshot(path=str(shots / "04-capacity.png"))

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
        page.screenshot(path=str(shots / "05-size.png"))

        checklist = page.locator("[data-testid=bid-checklist]")
        checklist.scroll_into_view_if_needed()
        rows = checklist.inner_text()
        page.screenshot(path=str(shots / "06-checklist.png"))
        assert "NOT MET" not in rows.upper(), rows
        assert rows.upper().count("\nMET") >= 7, rows
        # 2 h in 05:00-10:00 and 2 h in 18:00-23:00 as the buying entity schedules (p. 29):
        # every hour of both windows is held to the peak floor
        assert "in each of the 10 hours the procurer may pick" in rows, rows

        # 5. Finance and the Excel model
        page.click("[data-testid=bid-step-finance]")
        page.wait_for_timeout(2000)
        finance = page.locator("[data-testid=bid-finance]").inner_text()
        page.screenshot(path=str(shots / "07-finance.png"))
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


def test_prefilled_simulation():
    with _session() as page:
        card = page.locator("[data-testid=start-prefilled]").inner_text()
        assert "WBSEDCL/PT&P/RE-RTC/2026/01" in card and "1,500 MW" in card, card
        page.click("[data-testid=start-run-prefilled]")
        head = page.wait_for_selector("[data-testid=bid-tender-head]", timeout=30_000)
        assert "WBSEDCL/PT&P/RE-RTC/2026/01" in head.inner_text()
        assert page.locator("[data-testid=scan-stage]").count() == 0, "no scan for a tender already read"
        page.click("[data-testid=bid-step-capacity]")
        assert "1,500 MW" in page.locator(".bid-page").inner_text()
        # back to the start screen, which offers to continue
        page.click("[data-testid=bid-new-tender-top]")
        page.wait_for_selector("[data-testid=start-continue]")
        assert "WBSEDCL/PT&P/RE-RTC/2026/01" in page.locator("[data-testid=start-continue]").inner_text()


@pytest.mark.parametrize("how", ["skip", "reduced-motion"])
def test_skip_and_reduced_motion(how):
    with _session(**({"reduced_motion": "reduce"} if how == "reduced-motion" else {})) as page:
        _upload(page, RFS)
        page.wait_for_selector("[data-testid=scan-stage]", timeout=30_000)
        if how == "skip":
            page.click("[data-testid=scan-skip]")
        assert page.locator("[data-testid=scan-agent-dates]").count() == 0, "no animation"
        page.wait_for_selector("[data-testid=bid-tender-head]", timeout=240_000)
        assert page.locator("[data-testid=scan-summary]").count() == 0


def test_bess_tender_goes_to_the_bess_tab(tmp_path):
    pymupdf = pytest.importorskip("pymupdf")
    sys.path.insert(0, str(ROOT))
    from tests.engine.bess_rfs_sample import PAGES

    pdf = tmp_path / "bess-rfs.pdf"
    doc = pymupdf.open()
    for text in PAGES:
        doc.new_page(width=595, height=842).insert_textbox(pymupdf.Rect(50, 50, 545, 800), text, fontsize=10, fontname="helv")
    doc.save(str(pdf))
    with _session() as page:
        _upload(page, pdf)
        page.wait_for_selector("[data-testid=bid-tender-head]", timeout=120_000)
        page.click("[data-testid=bid-step-capacity]")
        assert "standalone battery storage tender" in page.locator("[data-testid=bid-scope]").inner_text().lower()
        page.click("[data-testid=bid-open-bess]")
        page.wait_for_selector("text=Read “bess-rfs.pdf”", timeout=60_000)
