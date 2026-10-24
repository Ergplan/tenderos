"""Team sharing in the browser (web/src/team, /api/team/*), on a demo deployment's seats.

The tender manager (super admin) saves a bid and assigns three data points: the solar capex to
procurement, Format 7.1 to finance for a signed copy, and a tender condition to legal. Each desk
answers from its own view ("View as"); the manager accepts the capex and the signed copy into the
bid (each a new saved version), returns the legal answer with a note, and accepts the second one.

Run with a stack in demo mode:
  TENDEROS_URL=http://127.0.0.1:3000 TENDEROS_DEMO=1 pytest -m slow tests/e2e/test_team.py
"""
from __future__ import annotations

import re
import uuid

import pymupdf
import pytest

from tests.e2e.test_tender_to_bid import DEMO, URL, _session

pytestmark = [
    pytest.mark.slow,
    pytest.mark.skipif(not (URL and DEMO), reason="set TENDEROS_URL and TENDEROS_DEMO=1 (the team's seats are switched with View as)"),
]


def _open_seci(page):
    page.click("aside.sidebar button:has-text('SECI RTC tender')")
    page.wait_for_selector("[data-testid=seci-tab]", timeout=30_000)


def _panel(page):
    if not page.locator("[data-testid=team-panel]").count():
        page.click("[data-testid=seci-team]")
    page.wait_for_selector("[data-testid=team-panel]")
    return page.locator("[data-testid=team-panel]")


def _view_as(page, name):
    _panel(page)
    sel = page.locator("[data-testid=team-view-as]")
    value = sel.locator("option", has_text=name).first.get_attribute("value")
    sel.select_option(value=value)
    page.wait_for_function("([v]) => document.querySelector('[data-testid=team-view-as]').value === v", arg=[value])
    page.wait_for_timeout(600)


def _close(page):
    if page.locator("[data-testid=team-panel]").count():
        page.click("[aria-label='Close the team panel']")


def _assign(page, key, request):
    page.click(f'[data-testid="assign-{key}"]')
    form = page.locator("[data-testid=assign-form]")
    form.locator("[data-testid=assign-request]").fill(request)
    form.locator("[data-testid=assign-send]").click()
    page.wait_for_selector(f'[data-testid="assign-{key}"].team-chip', timeout=10_000)


def _card(page, key):
    return page.locator(f'[data-testid="team-card-{key}"]').first


def test_assign_answer_accept_and_return(tmp_path):
    signed = tmp_path / "Format 7.1 signed.pdf"
    doc = pymupdf.open()
    doc.new_page().insert_text((72, 72), "Format 7.1 Covering Letter - signed and stamped (test)")
    doc.save(signed)
    with _session() as page:
        _open_seci(page)
        _view_as(page, "Tender manager")
        _close(page)
        # the bid must be saved first: the team works on the saved bid
        page.click("[data-testid=seci-step-sources]")
        page.click("[data-testid=bid-fill]")
        page.click("[data-testid=seci-save]")
        name = f"Team test bid {uuid.uuid4().hex[:6]}"
        page.fill(".modal input[required]", name)
        page.click(".modal button[type=submit]")
        page.wait_for_selector("[data-testid=seci-saved]")
        version = int(re.search(r"v(\d+)", page.locator("[data-testid=seci-linked]").inner_text(), re.I).group(1))

        # three data points to three teams
        page.click('[data-testid="assign-src.solar.capex"]')
        form = page.locator("[data-testid=assign-form]")
        assert form.locator("[data-testid=assign-team]").input_value() == "procurement", "a cost goes to procurement by default"
        form.locator("[data-testid=assign-request]").fill("EPC quote for the solar plant, per MWac")
        form.locator("[data-testid=assign-send]").click()
        page.wait_for_selector('[data-testid="assign-src.solar.capex"].team-chip')
        page.click("[data-testid=seci-step-forms]")
        page.click("[data-testid=seci-formsnav-7\\.1]")
        _assign(page, "format.7.1", "Print on the letterhead, sign and upload")
        page.click("[data-testid=seci-step-conditions]")
        cond = page.locator('[data-testid^="assign-condition."]').first
        cond_key = cond.get_attribute("data-testid").removeprefix("assign-")
        _assign(page, cond_key, "How do we read this clause?")

        # procurement answers with a figure
        _view_as(page, "Procurement desk")
        page.click("[data-testid=team-tab-todo]")
        card = _card(page, "src.solar.capex")
        card.locator("[data-testid=team-answer-value]").fill("3.6")
        card.locator("[data-testid=team-answer-note]").fill("Two EPC quotes, lower one")
        card.locator("[data-testid=team-answer-send]").click()
        page.wait_for_function("() => !document.querySelector('[data-testid=\"team-card-src.solar.capex\"] [data-testid=team-answer-send]')")
        # finance uploads the signed copy (the filled letter is offered to print)
        _view_as(page, "Finance desk")
        card = _card(page, "format.7.1")
        assert card.locator("[data-testid=team-letter-pdf]").count() == 1
        card.locator("[data-testid=team-answer-file]").set_input_files(str(signed))
        card.locator("[data-testid=team-answer-send]").click()
        page.wait_for_function("() => !document.querySelector('[data-testid=\"team-card-format.7.1\"] [data-testid=team-answer-send]')")
        # legal gives a reading
        _view_as(page, "Legal desk")
        card = _card(page, cond_key)
        card.locator("[data-testid=team-answer-note]").fill("First reading")
        card.locator("[data-testid=team-answer-send]").click()
        page.wait_for_function(f"() => !document.querySelector('[data-testid=\"team-card-{cond_key}\"] [data-testid=team-answer-send]')")

        # the manager accepts two and returns one
        _view_as(page, "Tender manager")
        page.click("[data-testid=team-tab-todo]")
        assert page.locator("[data-testid=seci-team-count]").inner_text() == "3"
        _card(page, "src.solar.capex").locator("[data-testid=team-accept]").click()
        page.wait_for_function("() => document.querySelector('[data-testid=\"team-card-src.solar.capex\"]')?.className.includes('accepted') ?? true")
        page.click("[data-testid=team-tab-all]")
        assert "Accepted" in _card(page, "src.solar.capex").locator("[data-testid=team-status]").inner_text()
        _card(page, "format.7.1").locator("[data-testid=team-accept]").click()
        page.wait_for_function("() => document.querySelector('[data-testid=\"team-card-format.7.1\"]').className.includes('accepted')")
        card = _card(page, cond_key)
        card.locator("[data-testid=team-return-note]").fill("Cite the amendment clause too")
        card.locator("[data-testid=team-return]").click()
        page.wait_for_function(f"() => document.querySelector('[data-testid=\"team-card-{cond_key}\"]').className.includes('returned')")
        assert int(re.search(r"v(\d+)", page.locator("[data-testid=seci-linked]").inner_text(), re.I).group(1)) == version + 2, "each acceptance is a saved version"

        # legal answers again, the manager accepts
        _view_as(page, "Legal desk")
        card = _card(page, cond_key)
        card.locator("[data-testid=team-answer-note]").fill("Second reading, with Amendment-02 cl. 3")
        card.locator("[data-testid=team-answer-send]").click()
        page.wait_for_function(f"() => !document.querySelector('[data-testid=\"team-card-{cond_key}\"] [data-testid=team-answer-send]')")
        _view_as(page, "Tender manager")
        page.click("[data-testid=team-tab-all]")
        _card(page, cond_key).locator("[data-testid=team-accept]").click()
        page.wait_for_function(f"() => document.querySelector('[data-testid=\"team-card-{cond_key}\"]').className.includes('accepted')")
        history = _card(page, cond_key).locator(".team-events").text_content()
        assert "returned" in history and history.count("submitted") == 2
        _close(page)

        # the answers are in the bid
        page.click("[data-testid=seci-step-sources]")
        capex = page.locator("[data-testid=source-solar] .has-assign", has_text="Capex per MWac").locator("input").first
        assert capex.input_value() == "3.6"
        page.click("[data-testid=seci-step-forms]")
        page.click("[data-testid=seci-formsnav-7\\.1]")
        signed_link = page.locator("[data-testid=seci-format-signed]")
        assert "Format 7.1 signed.pdf" in signed_link.inner_text()
        body = page.request.get(URL + signed_link.get_attribute("href")).body()
        assert body.startswith(b"%PDF") and body == signed.read_bytes(), "the signed copy comes back as uploaded"
        page.click("[data-testid=seci-step-conditions]")
        assert "Second reading" in page.locator(f'[data-testid="seci-cond-clarified-{cond_key.removeprefix("condition.")}"]').inner_text()

        # what the server refuses
        bad = page.request.post(URL + "/api/team/assignments", data={"scenarioId": "not-a-bid", "targetKind": "cost", "targetKey": "x", "targetLabel": "x", "team": "finance"})
        assert bad.status == 404
        assert page.request.get(URL + "/api/team/files/00000000-0000-0000-0000-000000000000").status == 404
