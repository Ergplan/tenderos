"""Browser end to end: the Round the Clock tab's financial model workbook.

* test_rtc_workbook: opens the tab on its default plant, reads the tariff and equity IRR it
  shows, downloads the Excel workbook and checks its Live model tab: second after the Cover,
  built of formulas, linked from the Cover, every key result the same as the app's, before and
  after LibreOffice (when installed) recalculates every formula.

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
