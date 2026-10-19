"""Browser end to end: the Round the Clock tab's financial model workbook.

* test_rtc_workbook: opens the tab on its default plant, reads the tariff and equity IRR it
  shows, downloads the Excel workbook and checks its Live model tab: second after the Cover,
  built of formulas, linked from the Cover, every key result the same as the app's, before and
  after LibreOffice (when installed) recalculates every formula.
* test_rtc_separate_sites: switches the Battery chapter to separate sites (nothing to enter; each
  battery charges from its own site; the split is shown) and checks the workbook again.

Needs the whole stack running; see tests/e2e/test_tender_to_bid.py for the environment.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

from tests.e2e.test_tender_to_bid import DEMO, EMAIL, PASSWORD, URL, _check_live_model, _session

pytestmark = [
    pytest.mark.slow,
    pytest.mark.skipif(not (URL and (DEMO or (EMAIL and PASSWORD))), reason="set TENDEROS_URL and TENDEROS_EMAIL, TENDEROS_PASSWORD (or TENDEROS_DEMO=1)"),
]


def test_rtc_workbook(tmp_path):
    with _session() as page:
        page.click("aside.sidebar button:has-text('Round the Clock')")
        stats = page.wait_for_selector("[data-testid=rtc-finance-stats]", timeout=120_000)
        page.wait_for_timeout(1500)
        text = re.sub(r"\s+", " ", stats.inner_text())
        tariff = re.search(r"tariff (?:for target irr|\(fixed\)) ₹([\d.]+)", text, re.I)
        irr = re.search(r"equity irr ([\d.]+)%", text, re.I)
        assert tariff and irr, text
        button = page.locator("[data-testid=rtc-download]")
        button.scroll_into_view_if_needed()
        with page.expect_download(timeout=120_000) as dl:
            button.click()
        name = dl.value.suggested_filename
        assert name.startswith("Round_the_clock_") and name.endswith("_financial_model.xlsx"), name
        out = Path(tmp_path) / name
        dl.value.save_as(str(out))
        _check_live_model(out, tariff=float(tariff.group(1)), irr=float(irr.group(1)) / 100, tmp=tmp_path, tariff_label="Tariff")


def test_rtc_separate_sites(tmp_path):
    """Separate sites ask for nothing: each battery charges from its own site only, and the split
    between the sites is shown, not entered; the workbook still matches the app."""
    with _session() as page:
        page.click("aside.sidebar button:has-text('Round the Clock')")
        page.click("nav.story-rail button:has-text('Battery storage')")
        page.click("[data-testid=rtc-sites-split]")
        result = page.wait_for_selector("[data-testid=rtc-sites-result]", timeout=30_000)
        text = result.inner_text()
        assert "charges from solar only" in text and "charges from wind only" in text, text
        assert re.search(r"\d+% at the wind site", text), text
        sites = page.locator("[data-testid=rtc-sites]")
        assert sites.locator("input").count() == 0, "nothing to enter for separate sites"
        assert "transmission" not in sites.inner_text().lower()
        stats = page.wait_for_selector("[data-testid=rtc-finance-stats]", timeout=120_000)
        page.wait_for_timeout(2000)
        flat = re.sub(r"\s+", " ", stats.inner_text())
        tariff = re.search(r"tariff (?:for target irr|\(fixed\)) ₹([\d.]+)", flat, re.I)
        irr = re.search(r"equity irr ([\d.]+)%", flat, re.I)
        assert tariff and irr, flat
        button = page.locator("[data-testid=rtc-download]")
        button.scroll_into_view_if_needed()
        with page.expect_download(timeout=120_000) as dl:
            button.click()
        out = Path(tmp_path) / dl.value.suggested_filename
        dl.value.save_as(str(out))
        _check_live_model(out, tariff=float(tariff.group(1)), irr=float(irr.group(1)) / 100, tmp=tmp_path, tariff_label="Tariff")
