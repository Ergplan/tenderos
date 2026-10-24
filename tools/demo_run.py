"""The TenderOS demo, run once through the browser with every click recorded.

A fictional bidder (demo/company.json) works the SECI RTC-TM-V tender end to end:

1. Tender to Bid: the tender set (RfS, two amendments, clarifications, PSA) uploaded at once and
   read; the Tender set panel (documents, amended terms, changes, clarifications, formats,
   process, search); then key dates, capacity, sources, HiGHS sizing, the financial model and its
   Excel workbook.
2. SECI RTC tender tab: documents and conditions; then several HiGHS scenarios (bid size, Peak
   Hours plan, shortfall policy, source mix), each with its sizes, compliance, money at stake,
   financials and Excel workbook; the agent's charts on the bid scenario; every particular and
   every blank of every format this bid needs filled, each format reviewed, the checks, and the
   bid pack (Word).
3. Round the Clock, BESS Tender and CfD Bid: every chapter or step opened, their workbooks.

Everything goes to demo/<run>/: run.json (every click with its result and time), the scenarios,
screenshots, workbooks and the bid pack. tools/demo_report.py turns it into the PDF report.

    TENDEROS_URL=http://127.0.0.1:3000 TENDEROS_DEMO=1 .venv/bin/python tools/demo_run.py [out-dir]

Needs the stack running (tools/dev.sh, or a deployment) with a user who may use every tab, or
TENDEROS_DEMO=1. Optional: PLAYWRIGHT_CHROMIUM, TENDEROS_EMAIL / TENDEROS_PASSWORD.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
import traceback
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACK = json.loads((ROOT / "web/src/seci/seci-rtc-tm-v.json").read_text())
SET_DIR = ROOT / "web/public/tenders/seci-rtc-tm-v"
SET_FILES = ["RfS.pdf", "Amendment-01.pdf", "Amendment-02.pdf", "Clarifications-01.pdf", "Standard-PSA.pdf"]
COMPANY = json.loads((ROOT / "demo/company.json").read_text())
URL = os.environ.get("TENDEROS_URL", "http://127.0.0.1:3000").rstrip("/")
DEMO = os.environ.get("TENDEROS_DEMO") == "1"
SIZING_TIMEOUT = 30 * 60 * 1000

# The SECI tab's HiGHS scenarios; the last is the bid the forms are filled for.
SCENARIOS = [
    {"id": "S2", "short": "Meet every block", "title": "Meet every block", "mw": 200, "peak": "any", "shortfall": "hard", "wind": True,
     "why": "No shortfall in any 15-minute block of any modelled year: the price of never paying the penalty."},
    {"id": "S3", "short": "Evening peak only", "title": "Evening Peak Hours only", "mw": 200, "peak": "evening", "shortfall": "penalty", "wind": True,
     "why": "Plans the 90% floor for 18:00-24:00 only; a morning pick by the Buying Entity would fall short and pay."},
    {"id": "S4", "short": "No wind", "title": "Solar and battery, no wind", "mw": 200, "peak": "any", "shortfall": "penalty", "wind": False,
     "why": "The same bid without wind: how much more solar and storage the floors need."},
    {"id": "S5", "short": "500 MW", "title": "Largest bid, 500 MW", "mw": 500, "peak": "any", "shortfall": "penalty", "wind": True,
     "why": "The most one bidder may offer (RfS 5.1)."},
    {"id": "S6", "short": "50 MW", "title": "Smallest bid, 50 MW", "mw": 50, "peak": "any", "shortfall": "penalty", "wind": True,
     "why": "The least one bidder may offer after Amendment-01 (was 100 MW)."},
    {"id": "S1", "short": "The bid", "title": "Bid: 200 MW, any 6 Peak Hours, pay the penalty", "mw": 200, "peak": "any", "shortfall": "penalty", "wind": True,
     "why": "The bid filed in the forms: solar, wind and battery sized for whichever 6 Peak Hours are picked, a shortfall priced at 1.5 x tariff.", "bid": True},
]


def _flat(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def _num(pattern: str, text: str) -> float | None:
    found = re.search(pattern, text, re.I)
    return float(found.group(1).replace(",", "")) if found else None


def tariff_words(tariff: float) -> str:
    """₹4.82 -> 'Rupees Four and Paise Eighty-Two only per kWh' (as the financial bid asks)."""
    ones = "Zero One Two Three Four Five Six Seven Eight Nine Ten Eleven Twelve Thirteen Fourteen Fifteen Sixteen Seventeen Eighteen Nineteen".split()
    tens = "_ _ Twenty Thirty Forty Fifty Sixty Seventy Eighty Ninety".split()

    def words(n: int) -> str:
        if n < 20:
            return ones[n]
        return tens[n // 10] + ("" if n % 10 == 0 else "-" + ones[n % 10])

    rupees = int(tariff)
    paise = int(round((tariff - rupees) * 100))
    if paise == 100:
        rupees, paise = rupees + 1, 0
    return f"Rupees {words(rupees)} and Paise {words(paise)} only per kWh"


class Run:
    """The click log: every step with its outcome, time and screenshot."""

    def __init__(self, out: Path) -> None:
        self.out = out
        self.shots = out / "screens"
        self.shots.mkdir(parents=True, exist_ok=True)
        self.steps: list[dict] = []
        self.errors: list[str] = []
        self.data: dict = {}
        self.page = None

    @contextmanager
    def step(self, section: str, name: str, shot: str | None = None, element: str | None = None):
        started = time.monotonic()
        entry = {"section": section, "name": name, "status": "pass", "seconds": 0.0, "screenshot": None, "note": ""}
        self.steps.append(entry)
        print(f"  · {section}: {name}", flush=True)
        try:
            yield entry
            if shot:
                entry["screenshot"] = self.snap(shot, element)
        except Exception as exc:  # noqa: BLE001 - recorded; the run goes on
            entry["status"] = "fail"
            entry["note"] = f"{type(exc).__name__}: {str(exc).splitlines()[0][:300]}"
            print(f"    FAILED {entry['note']}", flush=True)
            traceback.print_exc(limit=1)
            try:
                entry["screenshot"] = self.snap(f"fail-{len(self.steps):03d}")
            except Exception:  # noqa: BLE001
                pass
        entry["seconds"] = round(time.monotonic() - started, 2)

    def snap(self, name: str, element: str | None = None) -> str:
        path = self.shots / f"{name}.jpg"
        if element:
            loc = self.page.locator(element).first
            loc.scroll_into_view_if_needed()
            loc.screenshot(path=str(path), type="jpeg", quality=72)
        else:
            self.page.screenshot(path=str(path), type="jpeg", quality=72)
        return str(path.relative_to(self.out))

    def save(self) -> None:
        payload = {**self.data, "steps": self.steps}
        (self.out / "run.json").write_text(json.dumps(payload, indent=1, ensure_ascii=False, default=str))


def download(page, run: Run, selector: str, folder: str, name: str | None = None, timeout: int = 180_000) -> str:
    with page.expect_download(timeout=timeout) as dl:
        page.click(selector)
    target = run.out / folder
    target.mkdir(parents=True, exist_ok=True)
    path = target / (name or dl.value.suggested_filename)
    dl.value.save_as(str(path))
    return str(path.relative_to(run.out))


def seci_state(page) -> dict:
    return page.evaluate("() => JSON.parse(localStorage.getItem('tenderos.seci.v1') || '{}')")


def bid_state(page) -> dict:
    return page.evaluate("""() => { for (const k of Object.keys(localStorage)) if (k.startsWith('tenderos.bid')) return JSON.parse(localStorage.getItem(k)); return {}; }""")


def slim(lp: dict | None) -> dict | None:
    """The sizing summary without its long series (kept for the report)."""
    if not lp:
        return None
    return {k: v for k, v in lp.items() if len(json.dumps(v, default=str)) < 20_000}


def finance_numbers(text: str) -> dict:
    t = _flat(text)
    return {
        "bid_tariff": _num(r"BID TARIFF\s*₹([\d.]+)/kWh", t) or _num(r"tariff (?:for target irr|\(fixed\))\s*₹([\d.]+)", t),
        "equity_irr": _num(r"EQUITY IRR\s*([\d.]+)%", t),
        "project_irr": _num(r"PROJECT IRR\s*([\d.]+)%", t),
        "text": t[:4000],
    }


# ----------------------------------------------------------------------------- Tender to Bid


def tender_to_bid(page, run: Run) -> None:
    S = "Tender to Bid"
    with run.step(S, "Open the tab: the start screen", "t2b-00-start"):
        page.click("aside.sidebar button:has-text('Tender to Bid')")
        page.wait_for_selector("[data-testid=bid-start]", timeout=60_000)
    with run.step(S, "Choose the five documents of the tender set", "t2b-01-chosen", "[data-testid=start-upload]") as e:
        page.set_input_files("[data-testid=bid-file]", [str(SET_DIR / f) for f in SET_FILES])
        n = page.locator("[data-testid=start-set-files] li").count()
        assert n == 5, n
        e["note"] = page.locator("[data-testid=bid-read]").inner_text()
    with run.step(S, "Read the tender set (scan screen, Docling tables, amendments applied)", "t2b-02-read") as e:
        started = time.monotonic()
        page.click("[data-testid=bid-read]")
        page.wait_for_selector("[data-testid=scan-stage]", timeout=60_000)
        page.wait_for_timeout(4000)
        run.snap("t2b-02a-scan")
        page.wait_for_selector("[data-testid=tender-set]", timeout=20 * 60_000)
        e["note"] = f"read in {time.monotonic() - started:.0f} s"
    tabs = [("amended", "Amended terms"), ("documents", "Documents"), ("changes", "Changes"), ("clarifications", "Clarifications"),
            ("formats", "Bid formats"), ("process", "Bid process")]
    reading: dict = {}
    for key, label in tabs:
        with run.step(S, f"Tender set panel: {label}", f"t2b-set-{key}", "[data-testid=tender-set]") as e:
            page.click(f"[data-testid=set-tab-{key}]")
            page.wait_for_timeout(400)
            rows = {"amended": "set-amended-row", "documents": "set-doc-row", "changes": "set-change-row", "clarifications": "set-clar-row",
                    "formats": "set-format-row", "process": "set-step"}[key]
            count = page.locator(f"[data-testid={rows}]").count()
            reading[key] = count
            e["note"] = f"{count} rows"
            if key == "amended":
                reading["amended_rows"] = [_flat(t)[:400] for t in page.locator("[data-testid=set-amended-row]").all_inner_texts()]
            if key == "documents":
                reading["documents"] = [_flat(t) for t in page.locator("[data-testid=set-doc-row]").all_inner_texts()]
            if key == "changes":
                page.locator("[data-testid=set-change-row]").first.click()
                reading["first_change"] = _flat(page.locator("[data-testid=set-change-detail]").inner_text())[:800]
            if key == "clarifications":
                reading["clarification_rows"] = [_flat(t)[:300] for t in page.locator("[data-testid=set-clar-row]").all_inner_texts()]
    with run.step(S, "Search every page: 'e-reverse auction'", "t2b-set-search", "[data-testid=tender-set]") as e:
        page.click("[data-testid=set-tab-search]")
        page.fill("[data-testid=set-search-input]", "e-reverse auction")
        page.click("[data-testid=set-search-go]")
        page.wait_for_selector("[data-testid=set-search-hit]", timeout=60_000)
        hits = [_flat(t)[:200] for t in page.locator("[data-testid=set-search-hit]").all_inner_texts()]
        reading["search"] = {"query": "e-reverse auction", "hits": hits[:5]}
        e["note"] = f"{len(hits)} passages"
    with run.step(S, "What the tender requires (amended values, quoted)", "t2b-requirements"):
        page.locator("text=What the tender requires").first.scroll_into_view_if_needed()
    with run.step(S, "Key dates", "t2b-dates"):
        page.click("[data-testid=bid-step-dates]")
        page.wait_for_selector("[data-testid=bid-dates-head]", timeout=30_000)
    with run.step(S, "Capacity", "t2b-capacity") as e:
        page.click("[data-testid=bid-step-capacity]")
        box = page.locator("[data-testid=bid-base-mw]")
        e["note"] = f"{box.locator('input').input_value()} MW; {_flat(box.inner_text())}"
    with run.step(S, "Supply sources: fill the benchmarks", "t2b-sources"):
        page.click("[data-testid=bid-step-sources]")
        page.click("[data-testid=bid-fill]")
        assert page.locator("[data-testid=bid-missing]").count() == 0, "inputs still missing"
    sizing: dict = {}
    with run.step(S, "Size the plant with HiGHS (the tender as read)", "t2b-size", "[data-testid=bid-sizes]") as e:
        started = time.monotonic()
        page.click("[data-testid=bid-step-size]")
        page.locator("[data-testid=bid-size-again], [data-testid=bid-size]").first.click()
        page.wait_for_selector("[data-testid=bid-sizes]", timeout=SIZING_TIMEOUT)
        page.wait_for_timeout(1500)
        sizing["seconds"] = round(time.monotonic() - started, 1)
        sizing["sizes_text"] = _flat(page.locator("[data-testid=bid-sizes]").inner_text())
        e["note"] = f"{sizing['seconds']} s"
    with run.step(S, "Compliance with the tender's floors", "t2b-compliance", "[data-testid=bid-compliance]"):
        sizing["compliance_text"] = _flat(page.locator("[data-testid=bid-compliance]").inner_text())[:3000]
    if page.locator("[data-testid=bid-d15-run]").count():
        with run.step(S, "15-minute dispatch for every PPA year", "t2b-d15"):
            page.click("[data-testid=bid-d15-run]")
            page.wait_for_selector("[data-testid=bid-d15-download]", timeout=SIZING_TIMEOUT)
    with run.step(S, "Financials", "t2b-finance", "[data-testid=bid-finance]") as e:
        page.click("[data-testid=bid-step-finance]")
        page.wait_for_selector("[data-testid=bid-finance]", timeout=60_000)
        page.wait_for_timeout(1500)
        sizing["finance"] = finance_numbers(page.locator("[data-testid=bid-finance]").inner_text())
        e["note"] = f"tariff ₹{sizing['finance']['bid_tariff']}/kWh, equity IRR {sizing['finance']['equity_irr']}%"
    with run.step(S, "Download the financial model (Excel)") as e:
        e["note"] = sizing["workbook"] = download(page, run, "[data-testid=bid-download]", "models", "TenderToBid_SECI-set_financial_model.xlsx")
    st = bid_state(page)
    sizing["lp"] = slim(st.get("lp"))
    run.data["tender_to_bid"] = {"reading": reading, "sizing": sizing}


# ----------------------------------------------------------------------------- SECI tab


def open_seci(page) -> None:
    page.click("aside.sidebar button:has-text('SECI RTC tender')")
    page.wait_for_selector("[data-testid=seci-tab]", timeout=30_000)


def seci_overview(page, run: Run) -> None:
    S = "SECI RTC tender"
    with run.step(S, "Open the tab", "seci-00-tab"):
        open_seci(page)
    with run.step(S, "Tender & amendments: documents, bid process, changes, clarifications", "seci-01-documents") as e:
        page.click("[data-testid=seci-step-documents]")
        e["note"] = f"{page.locator('[data-testid=seci-docs] article').count()} documents, {page.locator('[data-testid=seci-changes] .seci-change').count()} changes"
        run.snap("seci-01b-changes", "[data-testid=seci-changes]")
    with run.step(S, "Bid conditions (in force after the amendments)", "seci-02-conditions") as e:
        page.click("[data-testid=seci-step-conditions]")
        e["note"] = _flat(page.locator("[data-testid=seci-cond-summary]").inner_text())[:200]


def set_choice(page, testid: str, value: str) -> None:
    page.click(f"[data-testid={testid}-{value}]")


def set_switch(page, testid: str, on: bool) -> None:
    button = page.locator(f"[data-testid={testid}]")
    if (button.get_attribute("aria-pressed") == "true") != on:
        button.click()


def seci_scenario(page, run: Run, sc: dict) -> dict:
    S = f"SECI scenario {sc['id']}"
    out: dict = {**sc}
    with run.step(S, f"What you bid: {sc['mw']} MW, Peak Hours '{sc['peak']}', shortfall '{sc['shortfall']}'", f"seci-{sc['id']}-bid"):
        page.click("[data-testid=seci-step-bid]")
        page.fill("[data-testid=seci-bid-mw]", str(sc["mw"]))
        set_choice(page, "seci-peak", sc["peak"])
        set_choice(page, "seci-shortfall", sc["shortfall"])
        if not page.locator("[data-testid=seci-ppa-date]").input_value():
            page.fill("[data-testid=seci-ppa-date]", COMPANY["ppaDate"])
    with run.step(S, f"Supply sources: solar, {'wind, ' if sc['wind'] else ''}battery; benchmarks filled", f"seci-{sc['id']}-sources"):
        page.click("[data-testid=seci-step-sources]")
        set_switch(page, "have-wind", sc["wind"])
        page.click("[data-testid=bid-fill]")
        assert page.locator("[data-testid=bid-missing]").count() == 0, "inputs still missing"
        out["sources_text"] = _flat(page.locator("[data-testid=source-solar]").inner_text())[:600]
    with run.step(S, "Size with HiGHS against every peak and off-peak block", f"seci-{sc['id']}-sizes", "[data-testid=bid-sizes]") as e:
        started = time.monotonic()
        page.click("[data-testid=bid-size]")
        page.wait_for_selector("[data-testid=bid-sizes]", timeout=SIZING_TIMEOUT)
        page.wait_for_timeout(1500)
        out["seconds"] = round(time.monotonic() - started, 1)
        out["sizes_text"] = _flat(page.locator("[data-testid=bid-sizes]").inner_text())
        e["note"] = f"{out['seconds']} s"
    with run.step(S, "Compliance, block by block", f"seci-{sc['id']}-compliance", "[data-testid=bid-compliance]"):
        out["compliance_text"] = _flat(page.locator("[data-testid=bid-compliance]").inner_text())[:3000]
    state = seci_state(page)
    out["lp"] = slim(state.get("lp"))
    with run.step(S, "Money at stake: EMD, PBG, net worth", f"seci-{sc['id']}-money", "[data-testid=seci-money]"):
        page.click("[data-testid=seci-step-bid]")
        out["money_text"] = _flat(page.locator("[data-testid=seci-money]").inner_text())
    with run.step(S, "Financials: tariff for the target IRR, equity and project IRR", f"seci-{sc['id']}-finance", "[data-testid=bid-finance]") as e:
        page.click("[data-testid=seci-step-finance]")
        page.wait_for_selector("[data-testid=bid-finance]", timeout=60_000)
        page.wait_for_timeout(1500)
        out["finance"] = finance_numbers(page.locator("[data-testid=bid-finance]").inner_text())
        e["note"] = f"tariff ₹{out['finance']['bid_tariff']}/kWh, equity IRR {out['finance']['equity_irr']}%, project IRR {out['finance']['project_irr']}%"
    with run.step(S, "Download the financial model (Excel)") as e:
        e["note"] = out["workbook"] = download(page, run, "[data-testid=bid-download]", "models", f"SECI_{sc['id']}_financial_model.xlsx")
    return out


def seci_charts(page, run: Run) -> list[str]:
    S = "SECI bid agent"
    shots = []
    with run.step(S, "Open the bid agent (GPT-Live) panel", "seci-agent-panel", "[data-testid=agent-panel]") as e:
        page.click("[data-testid=agent-open]")
        page.wait_for_selector("[data-testid=agent-panel]", timeout=10_000)
        e["note"] = "voice not configured on this server" if page.locator("[data-testid=agent-unavailable]").count() else "voice available"
    for kind in ("peak_window", "typical_day", "monthly_energy", "irr_vs_tariff", "cash_flows", "money"):
        with run.step(S, f"Agent chart: {kind.replace('_', ' ')}", f"seci-chart-{kind}", "[data-testid=agent-chart]") as e:
            page.click(f"[data-testid=agent-chart-{kind}]")
            page.wait_for_timeout(900)
            assert page.locator("[data-testid=agent-chart] canvas").count() >= 1
            shots.append(f"screens/seci-chart-{kind}.jpg")
    with run.step(S, "Close the agent"):
        page.click("[aria-label='Close the agent']")
    return shots


def needed_formats(forms: dict) -> list[dict]:
    """The formats this bid needs (formats.js applies(): a single company, the EMD instrument chosen)."""
    out = []
    for f in PACK["formats"]:
        a = f["applies"]
        if a == "always":
            ok = True
        elif a == "consortium":
            ok = forms["bidderType"] == "consortium"
        elif a.startswith("emd-"):
            ok = a == f"emd-{forms['emdForm']}"
        elif a.startswith("pbg-"):
            ok = False  # after the award
        elif a == "common-shareholding":
            ok = forms["commonShareholding"] == "yes"
        elif f["id"] == "Annexure-I":
            ok = forms["connectivity"] == "other"
        else:
            ok = True
        if ok:
            out.append(f)
    return out


def fill_control(page, testid: str, value) -> None:
    loc = page.locator(f'[data-testid="{testid}"]')
    tag = loc.evaluate("(el) => el.tagName")
    if tag == "SELECT":
        loc.select_option(label=str(value)) if not loc.locator(f'option[value="{value}"]').count() else loc.select_option(str(value))
    else:
        loc.fill(str(value))


def seci_forms(page, run: Run, bid: dict) -> dict:
    S = "SECI bid forms"
    company = COMPANY
    forms = company["particulars"]
    out: dict = {"formats": []}
    with run.step(S, "Particulars: the bidder, signing, the offer, the project, eligibility", "seci-forms-00-particulars", "[data-testid=seci-particulars]"):
        page.click("[data-testid=seci-step-forms]")
        page.click("[data-testid=seci-formsnav-particulars]")
        for key, value in forms.items():
            fill_control(page, f"seci-form-{key}", value)
    with run.step(S, "Quote the tariff for the target IRR (Use ₹…/kWh)", "seci-forms-01-tariff", "[data-testid=seci-particulars]") as e:
        page.click("[data-testid=seci-form-use-tariff]")
        out["tariff"] = float(page.locator("[data-testid=seci-form-tariff]").input_value())
        e["note"] = f"₹{out['tariff']:.2f}/kWh"
    own = dict(company["blanks"])
    own["7.10.tariffWords"] = tariff_words(out["tariff"])
    sizes = (bid.get("lp") or {}).get("sizes") or {}
    own["7.11.costBreakup"] = company["costBreakup"].format(
        solar=round(sizes.get("solarMw") or 0), wind=round(sizes.get("windMw") or 0),
        bessMw=round(sizes.get("bessMw") or 0), bessMwh=round(sizes.get("bessMwh") or 0))
    for fmt in needed_formats(forms):
        fid = fmt["id"]
        entry = {"id": fid, "title": fmt["title"], "pages": fmt["pages"], "typed": 0}
        with run.step(S, f"Format {fid}: {fmt['title']}", f"seci-forms-{fid}", f'[data-testid="seci-format-{fid}"]') as e:
            page.click(f'[data-testid="seci-formsnav-{fid}"]')
            page.wait_for_selector(f'[data-testid="seci-format-{fid}"]', timeout=10_000)
            for field in fmt["fields"]:
                key = f"{fid}.{field['key']}"
                testid = f"seci-blank-{fid}-{field['key']}"
                if field.get("maps") or not page.locator(f'[data-testid="{testid}"]').count():
                    continue  # from the bid or the particulars, or not applicable to a single company
                if page.locator(f'[data-testid="{testid}"]').evaluate("(el) => el.tagName") == "DIV":
                    continue
                assert key in own, f"no value for {key} ({field['label']})"
                fill_control(page, testid, own[key])
                entry["typed"] += 1
            for i in range(len(fmt.get("attachments") or [])):
                box = page.locator(f'[data-testid="seci-attach-{fid}-{i}"]')
                if not box.is_checked():
                    box.check()
            entry["values"] = page.eval_on_selector_all(f'[data-testid="seci-format-{fid}"] .seci-blank', """els => els.map((el) => {
                const c = el.querySelector('input, select, textarea');
                const value = c ? (c.tagName === 'SELECT' ? (c.options[c.selectedIndex] || {}).text || '' : c.value) : ((el.querySelector('.seci-blank-model') || {}).innerText || '');
                return { label: (el.querySelector('.seci-blank-head span') || {}).innerText || '', source: (el.querySelector('.seci-blank-head em') || {}).innerText || '', value };
            })""")
            entry["attachments"] = page.eval_on_selector_all(f'[data-testid="seci-format-{fid}"] .seci-attach', "els => els.map((el) => ({ label: el.querySelector('label').innerText, checked: el.querySelector('input').checked }))")
            head = _flat(page.locator(f'[data-testid="seci-format-{fid}"] .seci-group-title').first.inner_text())
            entry["blanks"] = head
            assert "of" not in head or re.match(r"(\d+) of \1 blanks", head) or head.startswith("Nothing"), head
            page.locator(f'[data-testid="seci-format-{fid}"]').scroll_into_view_if_needed()
            page.evaluate("(sel) => document.querySelector(sel).scrollIntoView({block: 'start'})", f'[data-testid="seci-format-{fid}"]')
            page.wait_for_timeout(600)
            run.snap(f"seci-forms-{fid}")
            # the RfS page beside the blanks loads as the format opens and can move the button
            # under the pointer: click again until the review shows
            for _ in range(4):
                page.locator("[data-testid=seci-format-review]").scroll_into_view_if_needed()
                page.wait_for_timeout(400)
                page.click("[data-testid=seci-format-review]")
                try:
                    page.wait_for_selector("[data-testid=seci-format-reviewed]", timeout=4_000)
                    break
                except Exception:  # noqa: BLE001 - try again
                    continue
            assert page.locator("[data-testid=seci-format-reviewed]").count() == 1, "the review did not register"
            e["note"] = f"{head}; reviewed"
        out["formats"].append(entry)
    with run.step(S, "Checks: capacity, storage, substation, net worth, experience, EMD, PBG, dates, formats", "seci-forms-checks", "[data-testid=seci-checks]") as e:
        page.click("[data-testid=seci-formsnav-particulars]")
        checks = _flat(page.locator("[data-testid=seci-checks]").inner_text())
        out["checks"] = checks
        assert "Not met" not in checks, checks
        e["note"] = "all met"
    with run.step(S, "Formats navigator: every needed format reviewed", "seci-forms-nav", "[data-testid=seci-forms-nav]") as e:
        out["nav"] = _flat(page.locator("[data-testid=seci-forms-nav]").inner_text())
        e["note"] = _flat(page.locator("[data-testid=seci-step-forms]").inner_text())
    with run.step(S, "Download the bid pack (Word)") as e:
        e["note"] = out["bid_pack"] = download(page, run, "[data-testid=seci-forms-download]", "bid-pack")
    out["state_forms"] = seci_state(page).get("forms")
    return out


def seci_letters(page, run: Run, forms: dict) -> dict:
    """Every needed format as its full letter: viewed, one paragraph changed in place and reverted,
    each letter downloaded as Word and PDF, then all letters in one Word file and one PDF."""
    S = "SECI RTC tender: the letters"
    out: dict = {"letters": [], "edit": {}}
    for entry in forms.get("formats") or []:
        fid = entry["id"]
        letter = {"id": fid, "title": entry["title"]}
        with run.step(S, f"Letter {fid}: {entry['title']}", f"seci-letter-{fid}") as e:
            page.click(f'[data-testid="seci-formsnav-{fid}"]')
            page.click("[data-testid=seci-format-mode-letter]")
            view = page.wait_for_selector("[data-testid=seci-letter]", timeout=10_000)
            assert page.locator("[data-testid=seci-letter-missing]").count() == 0, page.locator("[data-testid=seci-letter-missing]").inner_text()
            letter["struck"] = page.locator("[data-testid=seci-letter] .letter-paper s, [data-testid=seci-letter] .letter-alt.struck").count()
            letter["words"] = len(view.inner_text().split())
            page.evaluate("() => document.querySelector('[data-testid=seci-letter]').scrollIntoView({block: 'start'})")
            letter["word"] = download(page, run, "[data-testid=seci-letter-word]", "letters/word")
            letter["pdf"] = download(page, run, "[data-testid=seci-letter-pdf]", "letters/pdf")
            e["note"] = f"{letter['words']} words, every blank filled; {letter['word']}, {letter['pdf']}"
        out["letters"].append(letter)
        if fid == "7.1":
            with run.step(S, "Change a paragraph's wording in place (Format 7.1)", "seci-letter-edit", "[data-testid=seci-letter]") as e:
                # the opening paragraph of the letter, not an address block
                para = page.locator("[data-testid=seci-letter] .letter-para:not(.struck)", has_text="having read, examined").locator(".letter-text").first
                block = para.get_attribute("data-testid").rsplit("-", 1)[1]
                sentence = " We also confirm that the Project shall be developed by Arkaja Renewables Private Limited itself."
                para.click()
                page.keyboard.press("End")
                page.keyboard.type(sentence)
                page.locator("[data-testid=seci-letter] .letter-heading").first.click()
                assert "changed from the RfS" in page.locator(f"[data-testid=letter-block-{block}]").inner_text()
                page.evaluate("(sel) => document.querySelector(sel).scrollIntoView({block: 'center'})", f"[data-testid=letter-block-{block}]")
                out["edit"] = {"format": "7.1", "block": block, "added": sentence.strip(), "review": _flat(page.locator("[data-testid=seci-format-review]").inner_text())}
                run.snap("seci-letter-edit-block", f"[data-testid=letter-block-{block}]")
                e["note"] = f"paragraph {block}: marked as your wording; the format's review asks to be redone ({out['edit']['review']})"
            with run.step(S, "Revert the paragraph to the RfS wording", "seci-letter-revert", f"[data-testid=letter-block-{block}]") as e:
                page.click(f"[data-testid=letter-revert-{block}]")
                assert sentence.strip() not in page.locator(f"[data-testid=letter-text-{block}]").inner_text()
                out["edit"]["reverted"] = True
                # back to the reviewed wording, the review stands again: the badge replaces the button
                assert page.locator("[data-testid=seci-format-reviewed]").count() == 1, "the review did not come back with the RfS wording"
                e["note"] = "back to the RfS wording; the review stands again: " + _flat(page.locator("[data-testid=seci-format-reviewed]").inner_text())
    with run.step(S, "All letters in one Word file") as e:
        e["note"] = out["all_word"] = download(page, run, "[data-testid=seci-letters-word]", "letters")
    with run.step(S, "All letters in one PDF") as e:
        e["note"] = out["all_pdf"] = download(page, run, "[data-testid=seci-letters-pdf]", "letters")
    with run.step(S, "Save the bid to the scenario library (forms, reviews and letters)", "seci-saved", "[data-testid=seci-saved]") as e:
        page.click("[data-testid=seci-format-mode-blanks]")
        page.click("[data-testid=seci-save]")
        page.fill(".modal input[required]", f"{COMPANY['name']}: SECI RTC-TM-V bid")
        page.click(".modal button[type=submit]")
        page.wait_for_selector("[data-testid=seci-saved]", timeout=30_000)
        e["note"] = out["saved"] = _flat(page.locator("[data-testid=seci-saved]").inner_text())
    return out


# ----------------------------------------------------------------------------- the other tabs


def other_tabs(page, run: Run) -> None:
    S = "Round the Clock"
    rtc: dict = {}
    with run.step(S, "Open the tab: default plant, tariff and returns", "rtc-00", "[data-testid=rtc-finance-stats]") as e:
        page.click("aside.sidebar button:has-text('Round the Clock')")
        page.wait_for_selector("[data-testid=rtc-finance-stats]", timeout=120_000)
        page.wait_for_timeout(1500)
        rtc["stats"] = _flat(page.locator("[data-testid=rtc-finance-stats]").inner_text())
        e["note"] = rtc["stats"][:160]
    for title in ("Energy needed", "Supply type", "DFR", "Solar", "Wind", "Battery storage"):
        with run.step(S, f"Chapter: {title}", f"rtc-{title.split()[0].lower()}"):
            page.click(f"nav.story-rail button:has-text('{title}')")
            page.wait_for_timeout(500)
    with run.step(S, "Download the financial model (Excel)") as e:
        page.locator("[data-testid=rtc-download]").scroll_into_view_if_needed()
        e["note"] = rtc["workbook"] = download(page, run, "[data-testid=rtc-download]", "models")
    run.data["rtc"] = rtc

    S = "BESS Tender"
    with run.step(S, "Open the tab", "bess-00"):
        page.click("aside.sidebar button:has-text('BESS Tender')")
        page.wait_for_selector("section.story-book nav.story-rail", timeout=30_000)
        page.evaluate("window.scrollTo(0, 0)")
    for title in ("Tender", "Requirements", "Battery", "Costs", "Finance"):
        with run.step(S, f"Chapter: {title}", f"bess-{title.lower()}"):
            page.locator(f"nav.story-rail button:has(strong:text-is('{title}'))").click()
            page.wait_for_timeout(700)
            page.evaluate("window.scrollTo(0, 0)")
    with run.step(S, "Optimize: the battery and augmentation plan with the lowest capacity charge", "bess-optimized") as e:
        go = page.locator("nav.story-rail button.story-tab-go")
        go.click()
        page.wait_for_timeout(1500)
        page.wait_for_function("() => !document.querySelector('nav.story-rail button.story-tab-go')?.disabled", timeout=15 * 60_000)
        page.wait_for_timeout(1500)
        e["note"] = _flat(page.locator("section.story-book").inner_text())[:200]
    if page.locator("button:has-text('CSV')").count():
        with run.step(S, "Download the yearly table (CSV)") as e:
            e["note"] = download(page, run, "button:has-text('CSV') >> nth=0", "models", "BESS_financial_model_yearly.csv")

    S = "CfD Bid"
    with run.step(S, "Open the tab", "cfd-00"):
        page.click("aside.sidebar button:has-text('CfD Bid')")
        page.wait_for_selector("[data-testid=cfd-next]", timeout=30_000)
    for i in range(1, 12):
        if not page.locator("[data-testid=cfd-next]").count():
            break
        with run.step(S, f"Next step ({i})", f"cfd-{i:02d}"):
            page.click("[data-testid=cfd-next]")
            page.wait_for_timeout(700)
            if page.locator("[data-testid=cfd-fill]").count():
                page.click("[data-testid=cfd-fill]")
    if page.locator("[data-testid=cfd-download]").count():
        with run.step(S, "Download the CfD financial model (Excel)") as e:
            e["note"] = download(page, run, "[data-testid=cfd-download]", "models")


# ----------------------------------------------------------------------------- main


def main() -> int:
    from playwright.sync_api import sync_playwright

    out = Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / "demo" / COMPANY["slug"]).resolve()
    out.mkdir(parents=True, exist_ok=True)
    run = Run(out)
    started = datetime.now(timezone.utc)
    commit = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "--short", "HEAD"], capture_output=True, text=True).stdout.strip()
    run.data.update(company=COMPANY, url=URL, started=started.isoformat(timespec="seconds"), commit=commit, tender=PACK["title"], rfs_no=PACK["rfsNo"])
    print(f"TenderOS demo run -> {out}", flush=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=os.environ.get("PLAYWRIGHT_CHROMIUM") or None)
        ctx = browser.new_context(viewport={"width": 1500, "height": 1000}, accept_downloads=True, reduced_motion="reduce",
                                  ignore_https_errors=os.environ.get("E2E_IGNORE_HTTPS_ERRORS") == "1")
        page = ctx.new_page()
        run.page = page
        page_errors: list[str] = []
        page.on("pageerror", lambda e: page_errors.append(str(e)))
        with run.step("Start", "Open TenderOS" + (" (demo, no sign-in)" if DEMO else " and sign in"), "start-00"):
            if DEMO:
                page.goto(URL + "/")
                if page.locator("text=Choose an app").count():
                    page.click("a[href='/__switch/new']")
            else:
                page.goto(URL + "/login")
                page.fill("input[type=email]", os.environ["TENDEROS_EMAIL"])
                page.fill("input[type=password]", os.environ["TENDEROS_PASSWORD"])
                page.click("button[type=submit]")
            page.wait_for_selector("aside.sidebar", timeout=60_000)
        status = page.evaluate("fetch('/api/bid/tender/status').then((r) => r.json()).catch(() => null)")
        run.data["engine"] = {"tender_reading": status}
        tender_to_bid(page, run)
        run.save()
        seci_overview(page, run)
        scenarios = []
        for sc in SCENARIOS:
            scenarios.append(seci_scenario(page, run, sc))
            run.data["scenarios"] = scenarios
            run.save()
        bid = scenarios[-1]
        run.data["charts"] = seci_charts(page, run)
        run.data["forms"] = seci_forms(page, run, bid)
        run.save()
        run.data["letters"] = seci_letters(page, run, run.data["forms"])
        run.save()
        other_tabs(page, run)
        run.data["page_errors"] = page_errors
        browser.close()
    run.data["finished"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    run.save()
    failed = [s for s in run.steps if s["status"] != "pass"]
    print(f"{len(run.steps)} steps, {len(failed)} failed; page errors: {len(run.data.get('page_errors') or [])}")
    for s in failed:
        print(f"  FAIL {s['section']}: {s['name']}: {s['note']}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
