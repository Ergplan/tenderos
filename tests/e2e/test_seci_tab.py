"""Browser end to end: the SECI RTC tender tab.

* test_documents_and_conditions: the five documents (the RfS among them), how the bid goes, the
  amendment trail, SECI's clarifications, the points to raise with SECI and the bid conditions with
  their quotes and the RfS's original wording; a PDF link opens the page.
* test_bid_on_screen: the bid (200 MW, any 6 Peak Hours, pay the penalty, a PPA date and the
  dates it sets), the benchmarks for the sources, HiGHS sizing against every peak and off-peak
  block, the money at stake; a tariff quoted below the target IRR is warned with the equity and
  project IRR it earns; the particulars and the RfS formats are filled and reviewed one by one; the
  bid pack (Word) and the financial model (Excel, its Live model recalculated by LibreOffice when
  installed) download.
* test_agent_panel: the GPT-Live bid agent's panel; without a key on the server it says how to set
  it up; with one, starting it sends the browser's WebRTC offer and shows the voice service's
  answer (a refusal, against a stand-in for OpenAI).

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
        rfs = page.locator("[data-testid=seci-doc-rfs]")
        assert "139 pages" in rfs.inner_text() and rfs.locator("a:has-text('Open the PDF')").get_attribute("href").endswith("RfS.pdf")
        assert page.locator("[data-testid=seci-process] li").count() == len(PACK["bidProcess"]) >= 10
        assert page.locator("[data-testid=seci-queries] li").count() == len(PACK["queries"]) >= 10
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
        n = len(PACK["conditions"])
        assert page.locator(".seci-cond").count() == n >= 50
        summary = page.locator("[data-testid=seci-cond-summary]").inner_text()
        assert f"{n} conditions" in summary and "removed" in summary, summary
        offpeak = page.locator("[data-testid=seci-cond-dfrOffpeak]")
        assert "70%" in offpeak.inner_text()
        offpeak.locator("summary:has-text('RfS as issued')").click()
        assert "80%" in offpeak.inner_text(), "the RfS's original off-peak floor, before Amendment-01"
        assert "Unclear" in page.locator("[data-testid=seci-cond-technical]").inner_text()
        assert "25 years from the Scheduled Commencement" in page.locator("[data-testid=seci-cond-term]").inner_text()
        assert "None stated in the RfS" in page.locator("[data-testid=seci-cond-ceiling]").inner_text()
        assert "INR 4,00,00,000/MW" in page.locator("[data-testid=seci-cond-liquidity]").inner_text()


def test_bid_on_screen(tmp_path):
    with _session() as page:
        _open_tab(page)
        # what you bid
        page.click("[data-testid=seci-step-bid]")
        page.fill("[data-testid=seci-bid-mw]", "200")
        page.click("[data-testid=seci-peak-any]")
        page.click("[data-testid=seci-shortfall-penalty]")
        page.fill("[data-testid=seci-ppa-date]", "2026-06-07")
        dates = page.locator("[data-testid=seci-tab]").inner_text()
        assert "07.06.2028" in dates and "07.12.2027" in dates, "SCSD 24 months after the PPA, Financial Closure 6 months before it"

        # the sources: benchmarks in every empty input, then HiGHS
        page.click("[data-testid=seci-step-sources]")
        page.click("[data-testid=bid-fill]")
        assert page.locator("[data-testid=bid-missing]").count() == 0
        page.click("[data-testid=bid-size]")
        sizes = page.wait_for_selector("[data-testid=bid-sizes]", timeout=1_800_000)
        page.wait_for_timeout(1500)
        size_text = sizes.inner_text().upper()
        for label in ("SOLAR", "WIND", "BATTERY"):
            assert label in size_text, size_text
        table = page.locator("[data-testid=bid-compliance]").inner_text()
        assert "of hours" in table and "Peak Hours floor" in table, table
        page.click("[data-testid=seci-step-bid]")
        money = page.locator("[data-testid=seci-money]").inner_text()
        assert "EMD" in money.upper() and "cr" in money, money

        # the bid tariff for the target IRR
        page.click("[data-testid=seci-step-finance]")
        page.wait_for_selector("[data-testid=bid-finance]")
        bid_tariff = float(re.search(r"BID TARIFF\s*₹([\d.]+)/kWh", page.locator("[data-testid=bid-finance]").inner_text()).group(1))

        # the tariff quoted: below the target IRR it is warned with the equity and project IRR it earns
        page.click("[data-testid=seci-step-finance]")
        page.wait_for_selector("[data-testid=quote-check]")
        finance_text = page.locator("[data-testid=bid-finance]").inner_text()
        assert "PROJECT IRR" in finance_text.upper(), finance_text
        low = f"{bid_tariff - 0.5:.2f}"
        page.fill("[data-testid=quote-check-input]", low)
        warning = page.locator("[data-testid=quote-check-warning]").inner_text()
        assert "below the" in warning and "equity IRR is" in warning and "project IRR" in warning, warning
        assert "%" in page.locator("[data-testid=quote-check]").inner_text()

        # the particulars, asked once; the quote is the same tariff as on Financials
        page.click("[data-testid=seci-step-forms]")
        assert page.locator("[data-testid=seci-form-tariff]").input_value() == low
        assert "below the" in page.locator("[data-testid=seci-quote]").inner_text()
        for key, value in {"bidder": "Acme Renewables Ltd", "address": "New Delhi", "contact": "A. Kumar", "email": "bids@acme.example",
                           "signatory": "A. Kumar, Director", "letterDate": "2026-05-20", "place": "New Delhi",
                           "substation": "Bhadla-III", "substationScd": "2027-12-31", "netWorthCr": "50000",
                           "experience": "Plant A, 180 MW, 2022-05-01"}.items():
            page.fill(f"[data-testid=seci-form-{key}]", value)
        for key, value in {"bidderType": "company", "connectivity": "final", "bessWith": "solar", "emdForm": "bg", "commonShareholding": "no"}.items():
            page.select_option(f"[data-testid=seci-form-{key}]", value)
        quoted = re.search(r"use ₹([\d.]+)/kwh", page.locator("[data-testid=seci-form-use-tariff]").inner_text(), re.I).group(1)
        assert 0 <= float(quoted) - bid_tariff < 0.0151, (quoted, bid_tariff)
        page.click("[data-testid=seci-form-use-tariff]")
        assert page.locator("[data-testid=seci-form-tariff]").input_value() == quoted
        assert page.locator("[data-testid=seci-quote]").get_attribute("role") is None, "at the target tariff there is no warning"
        checks = page.locator("[data-testid=seci-checks]").inner_text()
        for row in ("capacity", "storage", "substation", "networth", "experience", "emd", "pbg", "dates", "formats"):
            assert page.locator(f"[data-testid=seci-check-{row}]").count() == 1, row
        assert "Not met" not in checks, checks

        # the RfS formats: the ones this bid needs, each blank filled from the bid, the particulars or typed, beside the RfS page
        nav = page.locator("[data-testid=seci-forms-nav]").inner_text().upper()
        assert "ENVELOPE I " in nav and "ENVELOPE II" in nav and "NOT NEEDED FOR THIS BID" in nav, nav
        page.click("[data-testid=seci-formsnav-7\\.1]")
        f71 = page.locator("[data-testid=seci-format-7\\.1]")
        assert "needed for this bid" in f71.locator("[data-testid=seci-format-applies]").inner_text().lower()
        assert page.locator("[data-testid=seci-rfs-frame]").get_attribute("src").endswith("RfS.pdf#page=68&view=FitH")
        assert page.locator("[data-testid=seci-blank-7\\.1-contractedMw]").inner_text() == "200"
        assert page.locator("[data-testid=seci-blank-7\\.1-solarMw]").inner_text() in size_text.replace(",", ""), "the installed solar from the sizing"
        assert page.locator("[data-testid=seci-blank-7\\.1-emdAmount]").inner_text().startswith("INR ")
        page.fill("[data-testid=seci-blank-7\\.1-refNo]", "ACME/SECI/2026/01")
        page.locator("[data-testid=seci-format-7\\.1] .seci-blank-ctx").nth(5).click()
        assert "#page=6" in page.locator("[data-testid=seci-rfs-frame]").get_attribute("src"), "a blank's words in the RfS open its page"
        page.click("[data-testid=seci-format-review]")
        assert "reviewed" in page.locator("[data-testid=seci-format-reviewed]").inner_text().lower()
        assert "reviewed" in page.locator("[data-testid=seci-formsnav-7\\.1]").inner_text().lower()
        page.fill("[data-testid=seci-blank-7\\.1-refNo]", "ACME/SECI/2026/02")
        assert "changed since review" in page.locator("[data-testid=seci-format-review]").inner_text().lower(), "an edit after the review shows"
        page.click("[data-testid=seci-format-review]")
        page.click("[data-testid=seci-formsnav-7\\.10]")
        assert page.locator("[data-testid=seci-format-7\\.10]").count() == 1
        assert page.locator("[data-testid=seci-formsnav-7\\.2]").count() == 1 and "not needed" in page.locator("[data-testid=seci-formsnav-7\\.2]").inner_text().lower()

        with page.expect_download(timeout=60_000) as dl:
            page.click("[data-testid=seci-forms-download]")
        pack = Path(tmp_path) / dl.value.suggested_filename
        dl.value.save_as(str(pack))
        assert pack.name.endswith(".docx")
        with zipfile.ZipFile(pack) as z:
            xml = z.read("word/document.xml").decode()
        for needle in ("Acme Renewables Ltd", "Bhadla-III", "EMD", "Performance Bank Guarantee", "Amendment-02, p. 3", f"{quoted}",
                       "Format 7.1: Covering Letter", "ACME/SECI/2026/02", "Format 7.10", "RfS pp. 68"):
            assert needle in xml, needle
        assert "Format 7.2:" not in xml, "a single company's pack has no consortium Power of Attorney"

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


def test_agent_panel():
    with _session(permissions=["microphone"]) as page:
        _open_tab(page)
        info = page.evaluate("fetch('/api/seci/live').then((r) => r.json())")
        assert info["model"] == "gpt-live-1"
        page.click("[data-testid=agent-open]")
        assert "GPT-LIVE" in page.locator("[data-testid=agent-panel]").inner_text().upper()
        if not info["available"]:
            assert "OPENAI_API_KEY" in page.locator("[data-testid=agent-unavailable]").inner_text(), "no key: the panel says how to set it up"
            assert page.locator("[data-testid=agent-start]").is_disabled()
            return
        page.click("[data-testid=agent-start]")
        page.wait_for_selector("[data-testid=agent-error], [data-testid=agent-stop]", timeout=30_000)
        if page.locator("[data-testid=agent-error]").count():
            # a stand-in for OpenAI (or a wrong key) refuses: the panel says so and nothing is left running
            assert "voice service" in page.locator("[data-testid=agent-error]").inner_text()
            assert page.locator("[data-testid=agent-start]").count() == 1
        else:
            page.click("[data-testid=agent-stop]")
