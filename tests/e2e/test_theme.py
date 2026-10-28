"""Day and night mode in the browser (web/src/theme.js, styles.css): the switch in the sidebar,
the page and its charts redrawn in the day palette, the choice kept across a reload and on the
library pages, and night again on the way back.

Run with a running stack:
  TENDEROS_URL=http://127.0.0.1:3000 TENDEROS_DEMO=1 pytest -m slow tests/e2e/test_theme.py
"""
from __future__ import annotations

import pytest

from tests.e2e.test_tender_to_bid import DEMO, EMAIL, PASSWORD, URL, _session

pytestmark = [
    pytest.mark.slow,
    pytest.mark.skipif(not (URL and (DEMO or (EMAIL and PASSWORD))), reason="set TENDEROS_URL and TENDEROS_EMAIL, TENDEROS_PASSWORD (or TENDEROS_DEMO=1)"),
]

BG = "getComputedStyle(document.body).backgroundColor"
LOGO = "[...document.querySelectorAll('aside.sidebar .jw-brand img')].filter((i) => i.offsetParent).map((i) => i.getAttribute('src'))"
# How many of the first chart's opaque pixels are dark and how many light: the canvas background is
# transparent, so what it holds is the chart's own fills, lines and text in the mode's palette (dark
# cells and bars at night, light ones by day)
CANVAS_INK = """() => {
  const c = document.querySelector('.echart canvas');
  if (!c) return null;
  const g = c.getContext('2d');
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let dark = 0, light = 0;
  for (let i = 0; i < d.length; i += 4 * 97) {
    if (d[i + 3] < 200) continue;
    const y = (d[i] + d[i + 1] + d[i + 2]) / 3;
    if (y < 60) dark += 1; else if (y > 200) light += 1;
  }
  return { dark, light };
}"""


def _mode(page):
    return page.evaluate("document.documentElement.dataset.theme")


def test_day_and_night():
    with _session() as page:
        assert _mode(page) == "dark", "night is the default"
        assert page.evaluate(BG) == "rgb(10, 10, 10)"
        assert page.evaluate(LOGO) == ["/brand/tenderos-logo-dark.png"]
        toggle = page.locator("aside.sidebar [data-testid=theme-toggle]")
        assert "day mode" in toggle.inner_text().lower()

        toggle.click()
        page.wait_for_function("document.documentElement.dataset.theme === 'light'")
        assert page.evaluate(BG) == "rgb(250, 250, 247)"
        assert page.evaluate(LOGO) == ["/brand/tenderos-logo.png"], "the dark-type logo by day"
        assert "night mode" in toggle.inner_text().lower()
        assert page.evaluate("localStorage.getItem('tenderos-theme')") == "light"

        # a chart drawn by day: its fills in the day palette
        page.click("aside.sidebar button:has-text('Round the Clock')")
        page.wait_for_selector("[data-testid=rtc-finance-stats]", timeout=120_000)
        page.wait_for_timeout(1500)
        assert page.evaluate("getComputedStyle(document.querySelector('.story-page')).backgroundColor") == "rgb(255, 255, 255)"
        day_ink = page.evaluate(CANVAS_INK)
        assert day_ink and day_ink["light"] > day_ink["dark"], day_ink

        # kept across a reload, applied before the page paints
        page.reload()
        page.wait_for_selector("aside.sidebar")
        assert _mode(page) == "light"
        assert page.evaluate(BG) == "rgb(250, 250, 247)"

        # the library pages carry the same switch and the same mode
        page.goto(URL + "/scenarios")
        page.wait_for_selector(".topbar [data-testid=theme-toggle]")
        assert _mode(page) == "light"
        assert page.evaluate(BG) == "rgb(250, 250, 247)"
        page.click(".topbar [data-testid=theme-toggle]")
        page.wait_for_function("document.documentElement.dataset.theme === 'dark'")
        assert page.evaluate(BG) == "rgb(10, 10, 10)"
        assert page.evaluate("localStorage.getItem('tenderos-theme')") == "dark"

        # back in the workspace: night, and the charts redrawn in night colours
        page.goto(URL + "/")
        page.wait_for_selector("aside.sidebar")
        assert _mode(page) == "dark"
        page.click("aside.sidebar button:has-text('Round the Clock')")
        page.wait_for_selector("[data-testid=rtc-finance-stats]", timeout=120_000)
        page.wait_for_timeout(1500)
        night_ink = page.evaluate(CANVAS_INK)
        assert night_ink and night_ink["dark"] > night_ink["light"], night_ink


def test_switch_redraws_open_charts():
    """Switching with a chart on screen redraws it at once (no reload)."""
    with _session() as page:
        page.click("aside.sidebar button:has-text('Round the Clock')")
        page.wait_for_selector("[data-testid=rtc-finance-stats]", timeout=120_000)
        page.wait_for_timeout(1500)
        before = page.evaluate(CANVAS_INK)
        page.click("aside.sidebar [data-testid=theme-toggle]")
        page.wait_for_function("document.documentElement.dataset.theme === 'light'")
        page.wait_for_timeout(800)
        after = page.evaluate(CANVAS_INK)
        assert before["dark"] > before["light"], before
        assert after["light"] > after["dark"], after
        page.click("aside.sidebar [data-testid=theme-toggle]")
        page.wait_for_function("document.documentElement.dataset.theme === 'dark'")
