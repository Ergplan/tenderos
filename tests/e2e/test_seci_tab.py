"""Browser end to end: the SECI RTC tender tab.

* test_documents_and_conditions: the four documents (and the missing RfS), the amendment trail,
  SECI's clarifications and the 31 bid conditions with their quotes; a PDF link opens the page.
* test_voice_guided_bid: the voice guide (muted, answers typed: a test browser has no microphone)
  explains the conditions, takes the bid, the planning choices and the sources' inputs, sizes the
  plant with HiGHS against every peak and off-peak block, and explains the result and the
  financial model; then the bid forms are filled and checked, the bid pack (Word) and the
  financial model (Excel, its Live model recalculated by LibreOffice when installed) download.

Needs the whole stack running; see tests/e2e/test_tender_to_bid.py for the environment.
"""
from __future__ import annotations

import json
import re
import zipfile
from pathlib import Path

import pytest

from tests.e2e.test_tender_to_bid import DEMO, EMAIL, PASSWORD, URL, _check_live_model, _session

ROOT = Path(__file__).resolve().parents[2]
PACK = json.loads((ROOT / "web" / "src" / "seci" / "seci-rtc-tm-v.json").read_text())

pytestmark = [
    pytest.mark.slow,
    pytest.mark.skipif(not (URL and (DEMO or (EMAIL and PASSWORD))), reason="set TENDEROS_URL and TENDEROS_EMAIL, TENDEROS_PASSWORD (or TENDEROS_DEMO=1)"),
]


def _open_tab(page):
    page.click("aside.sidebar button:has-text('SECI RTC tender')")
    page.wait_for_selector("[data-testid=seci-tab]", timeout=30_000)


def test_documents_and_conditions():
    with _session() as page:
        _open_tab(page)
        docs = page.locator("[data-testid=seci-docs] article")
        assert docs.count() == len(PACK["documents"]) == 5
        assert "not provided" in page.locator("[data-testid=seci-doc-rfs]").inner_text().lower()
        assert page.locator("[data-testid=seci-changes] .seci-change").count() == len(PACK["changes"])
        page.click("button:has-text('Amendment-02')")
        assert page.locator("[data-testid=seci-changes] .seci-change").count() == sum(1 for c in PACK["changes"] if c["doc"] == "amd2")
        dfr = page.locator("[data-testid=seci-change-a1-8\\.1a]")
        assert dfr.count() == 0, "filtered to Amendment-02"
        page.click("button:has-text('All')")
        text = page.locator("[data-testid=seci-change-a1-8\\.1a]").inner_text()
        assert "80%" in text and "70% in each time-block" in text, text
        assert page.locator("[data-testid=seci-clarifications] .seci-change").count() == len(PACK["clarifications"])
        # a quote's link opens its PDF at the page
        href = page.locator("[data-testid=seci-change-a2-16\\.1] a.seci-link").first.get_attribute("href")
        assert href.endswith("Amendment-02.pdf#page=3"), href
        r = page.request.get(URL + href.split("#")[0])  # the session's cookie: the tender PDFs are behind the login
        assert r.status == 200 and r.body()[:5] == b"%PDF-", r.status
        page.click("[data-testid=seci-step-conditions]")
        assert page.locator(".seci-cond").count() == len(PACK["conditions"]) == 31
        summary = page.locator("[data-testid=seci-cond-summary]").inner_text()
        assert "31 conditions" in summary and "removed" in summary, summary
        assert "70%" in page.locator("[data-testid=seci-cond-dfrOffpeak]").inner_text()
        assert "Unclear" in page.locator("[data-testid=seci-cond-technical]").inner_text()


def _caption(page) -> str:
    return re.sub(r"\s+", " ", page.locator("[data-testid=voice-caption]").inner_text())


def _wait_caption(page, needle: str, timeout=60_000):
    page.wait_for_function("(n) => (document.querySelector('[data-testid=voice-caption]')?.innerText || '').includes(n)", arg=needle, timeout=timeout)


def _answer(page, text: str):
    page.fill("[data-testid=voice-input]", text)
    page.click("[data-testid=voice-send]")


def test_voice_guided_bid(tmp_path):
    with _session() as page:
        _open_tab(page)
        page.click("[data-testid=voice-start]")
        page.click("[data-testid=voice-mute]")
        # the guide explains the key conditions, then asks
        _wait_caption(page, "How many megawatts will you bid")
        log = page.locator("[data-testid=voice-log]").inner_text()
        assert "70 percent" in log and "6 in the evening and 10 the next morning" in log and "one and a half times the tariff" in log, log
        assert page.locator("[data-testid=seci-step-bid]").get_attribute("aria-current") == "step", "the guide shows the step it asks about"
        _answer(page, "two hundred")
        _wait_caption(page, "any six of the sixteen")
        assert page.locator("[data-testid=seci-bid-mw]").input_value() == "200"
        _answer(page, "any")
        _wait_caption(page, "pay the penalty when that is cheaper")
        _answer(page, "penalty")
        _wait_caption(page, "When do you expect the PPA")
        _answer(page, "7 June 2026")
        _wait_caption(page, "industry benchmarks first")
        _answer(page, "yes")
        _wait_caption(page, "sell its surplus")
        _answer(page, "no")
        # each source and financing input: keep the benchmark
        for _ in range(40):
            caption = _caption(page)
            if "Shall I size the plant now" in caption:
                break
            assert "The benchmark is" in caption or "Now " in caption, caption
            before = page.locator("[data-testid=voice-caption]").inner_text()
            _answer(page, "next")
            page.wait_for_function("(c) => (document.querySelector('[data-testid=voice-caption]')?.innerText || '') !== c", arg=before, timeout=30_000)
        assert "Shall I size the plant now" in _caption(page)
        _answer(page, "yes")
        _wait_caption(page, "megawatts of solar", timeout=1_800_000)
        result = _caption(page)
        assert "For 200 megawatts" in result and "peak floor in" in result and "EMD is" in result and "7 June 2028" in result, result
        sizes = page.locator("[data-testid=bid-sizes]").inner_text().upper()
        solar = re.search(r"(\d[\d,]*) megawatts of solar", result).group(1).replace(",", "")
        assert solar in sizes.replace(",", ""), (solar, sizes)
        table = page.locator("[data-testid=bid-compliance]").inner_text()
        assert "of hours" in table and "Peak Hours floor" in table, table
        _wait_caption(page, "rupees per unit", timeout=120_000)
        quoted = re.search(r"round it up: ([\d.]+) rupees", _caption(page)).group(1)
        _wait_caption(page, "the bid forms", timeout=60_000)
        page.click("[data-testid=voice-mute]")  # unmute: nothing should break
        page.click("[aria-label='Close the guide']")

        # bid forms: fill, check, download the bid pack
        page.click("[data-testid=seci-step-forms]")
        for key, value in {"bidder": "Acme Renewables Ltd", "address": "New Delhi", "contact": "A. Kumar", "email": "bids@acme.example",
                           "substation": "Bhadla-III", "substationScd": "2027-12-31", "netWorthCr": "50000",
                           "experience": "Plant A, 180 MW, 2022-05-01"}.items():
            page.fill(f"[data-testid=seci-form-{key}]", value)
        for key, value in {"bidderType": "company", "connectivity": "final", "bessWith": "solar"}.items():
            page.select_option(f"[data-testid=seci-form-{key}]", value)
        page.click("[data-testid=seci-form-use-tariff]")
        assert page.locator("[data-testid=seci-form-tariff]").input_value() == quoted
        checks = page.locator("[data-testid=seci-checks]").inner_text()
        for row in ("capacity", "storage", "substation", "networth", "experience", "emd", "pbg", "dates"):
            assert page.locator(f"[data-testid=seci-check-{row}]").count() == 1, row
        assert "Not met" not in checks, checks
        with page.expect_download(timeout=60_000) as dl:
            page.click("[data-testid=seci-forms-download]")
        pack = Path(tmp_path) / dl.value.suggested_filename
        dl.value.save_as(str(pack))
        assert pack.name.endswith(".docx")
        with zipfile.ZipFile(pack) as z:
            xml = z.read("word/document.xml").decode()
        for needle in ("Acme Renewables Ltd", "Bhadla-III", "EMD", "Performance Bank Guarantee", "Amendment-02, p. 3", f"{quoted}"):
            assert needle in xml, needle

        # the financial model: the Live model workbook matches the app
        page.click("[data-testid=seci-step-finance]")
        page.wait_for_timeout(1500)
        finance = page.locator("[data-testid=bid-finance]").inner_text()
        tariff = re.search(r"BID TARIFF\s*₹([\d.]+)/kWh", finance)
        irr = re.search(r"EQUITY IRR\s*([\d.]+)%", finance)
        assert tariff and irr, finance
        with page.expect_download(timeout=120_000) as dl:
            page.click("[data-testid=bid-download]")
        book = Path(tmp_path) / dl.value.suggested_filename
        dl.value.save_as(str(book))
        _check_live_model(book, tariff=float(tariff.group(1)), irr=float(irr.group(1)) / 100, tmp=tmp_path)
