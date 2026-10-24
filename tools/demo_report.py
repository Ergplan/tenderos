"""The demo run (tools/demo_run.py) as one PDF report, printed by Chromium from HTML.

    .venv/bin/python tools/demo_report.py demo/<run>        # writes demo/<run>/TenderOS-demo-report.pdf

Sections: the bid at a glance; the HiGHS scenarios side by side; the tender set as read; one page
per scenario (inputs, sizes, compliance, money at stake, financials, screenshots); the bid
agent's charts; the bid forms (particulars, every format filled and reviewed, the checks); the
other tabs; every click with its result; the files of the run; and what the run does not show.
"""
from __future__ import annotations

import base64
import html
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def esc(value) -> str:
    return html.escape("" if value is None else str(value))


def num(value, digits: int = 0) -> str:
    if value is None:
        return "–"
    try:
        v = float(value)
    except (TypeError, ValueError):
        return esc(value)
    return f"{v:,.{digits}f}"


def img(run_dir: Path, rel: str | None, cls: str = "shot") -> str:
    if not rel:
        return ""
    path = run_dir / rel
    if not path.exists():
        return ""
    data = base64.b64encode(path.read_bytes()).decode("ascii")
    return f'<img class="{cls}" src="data:image/jpeg;base64,{data}" alt="{esc(rel)}">'


def money(text: str, label: str) -> str | None:
    found = re.search(label + r"\s*₹\s*([\d,.]+)\s*cr", text or "", re.I)
    return found.group(1) if found else None


def sizes_of(sc: dict) -> dict:
    s = ((sc.get("lp") or {}).get("sizes")) or {}
    return {"solar": s.get("solarMw"), "wind": s.get("windMw"), "bessMw": s.get("bessMw"), "bessMwh": s.get("bessMwh")}


def shot_of(steps: list[dict], prefix: str) -> str | None:
    for s in steps:
        if s.get("screenshot") and Path(s["screenshot"]).stem == prefix:
            return s["screenshot"]
    candidate = f"screens/{prefix}.jpg"
    return candidate


CSS = """
@page { size: A4; margin: 14mm 12mm 16mm; }
* { box-sizing: border-box; }
body { font-family: "Inter", "Segoe UI", Arial, sans-serif; color: #15171a; font-size: 9.6pt; line-height: 1.42; margin: 0; }
h1 { font-size: 26pt; margin: 0 0 6mm; letter-spacing: -0.02em; line-height: 1.1; }
h2 { font-size: 15pt; margin: 0 0 4mm; padding-bottom: 2mm; border-bottom: 2px solid #15171a; }
h3 { font-size: 11pt; margin: 5mm 0 2mm; }
p { margin: 0 0 2.5mm; }
.page { break-before: page; }
.cover { height: 255mm; display: flex; flex-direction: column; justify-content: space-between; }
.eyebrow { font-family: "JetBrains Mono", Consolas, monospace; font-size: 8pt; letter-spacing: 0.12em; text-transform: uppercase; color: #5b6168; }
.band { background: #0d0f12; color: #f4f4f1; padding: 10mm; border-left: 6px solid #c8f03a; }
.band .eyebrow { color: #c8f03a; }
.band p { color: #c2c2bc; }
.kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3mm; margin: 4mm 0; }
.kpi { border: 1px solid #d5d8dc; padding: 3mm; }
.kpi small { display: block; font-size: 7.5pt; color: #5b6168; text-transform: uppercase; letter-spacing: 0.08em; }
.kpi strong { font-size: 14pt; display: block; margin-top: 1mm; }
.kpi em { font-style: normal; font-size: 7.8pt; color: #5b6168; }
table { width: 100%; border-collapse: collapse; margin: 2mm 0 4mm; font-size: 8.4pt; }
th, td { border-bottom: 1px solid #e1e4e8; padding: 1.6mm 1.8mm; text-align: left; vertical-align: top; }
th { background: #f2f4f6; font-size: 7.6pt; text-transform: uppercase; letter-spacing: 0.05em; color: #3a3f45; }
td.n, th.n { text-align: right; white-space: nowrap; }
tr.bid td { background: #f6fbe4; font-weight: 600; }
.pass { color: #1f7a3a; font-weight: 600; }
.fail { color: #b3261e; font-weight: 600; }
.note { color: #5b6168; font-size: 8.2pt; }
.shot { display: block; max-width: 100%; max-height: 228mm; margin: 2mm auto 3mm; border: 1px solid #d5d8dc; break-inside: avoid; }
.shot.mid { max-height: 108mm; }
.half { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; }
.half .shot { margin: 1mm 0; max-height: 110mm; }
td.v { font-weight: 500; }
td.src { color: #5b6168; font-size: 7.6pt; white-space: nowrap; }
.quote { border-left: 3px solid #c8f03a; padding: 1mm 3mm; color: #3a3f45; background: #fafbf6; margin: 1mm 0 2mm; font-size: 8.4pt; }
.tag { display: inline-block; border: 1px solid #c4c8cc; padding: 0 2mm; font-size: 7.4pt; text-transform: uppercase; letter-spacing: 0.06em; margin-right: 1mm; }
.warn { background: #fff6e5; border: 1px solid #f2b84b; padding: 3mm; margin: 3mm 0; }
ul { margin: 1mm 0 3mm 5mm; padding: 0; }
li { margin-bottom: 1mm; }
.mono { font-family: "JetBrains Mono", Consolas, monospace; font-size: 8pt; }
.small { font-size: 8pt; }
"""


def observations(scenarios: list[dict]) -> list[str]:
    """Plain comparisons against the bid scenario, from the numbers of the run."""
    by = {sc["id"]: sc for sc in scenarios}
    bid = next((sc for sc in scenarios if sc.get("bid")), None)
    if not bid or not (bid.get("finance") or {}).get("bid_tariff"):
        return []
    base = bid["finance"]["bid_tariff"]
    out = []

    def delta(sc: dict) -> str:
        t = (sc.get("finance") or {}).get("bid_tariff")
        if t is None:
            return "not priced"
        d = t - base
        return f"₹{t:.2f}/kWh, {'+' if d >= 0 else '−'}₹{abs(d):.2f} ({'+' if d >= 0 else '−'}{abs(d) / base * 100:.0f}%) against the bid"

    if "S2" in by:
        out.append(f"<b>Never paying the shortfall penalty is expensive:</b> meeting every block costs {delta(by['S2'])}; the bid lets HiGHS weigh a short block at 1.5 × tariff against more plant.")
    if "S3" in by:
        out.append(f"<b>Planning on the evening peak only</b> gives {delta(by['S3'])}, but the Buying Entity picks the 6 hours day-ahead anywhere in 18:00–10:00: a morning pick falls short and pays.")
    if "S4" in by:
        out.append(f"<b>Without wind</b> the floors need more solar and storage: {delta(by['S4'])}.")
    sizes = [(by[i].get("finance") or {}).get("bid_tariff") for i in ("S5", "S6", "S1") if i in by]
    if len(sizes) >= 2 and max(sizes) - min(sizes) < 0.01:
        out.append("<b>50, 200 and 500 MW price the same:</b> the model's costs are per MW, so the plant scales with the bid; economies of scale, land and connectivity limits are not in it.")
    out.append("Every tariff is the one that gives the 14% target equity IRR on benchmark costs; a real bid prices the bidder's own quotes.")
    return out


def build(run_dir: Path) -> Path:
    run = json.loads((run_dir / "run.json").read_text())
    steps = run.get("steps") or []
    company = run.get("company") or {}
    scenarios = run.get("scenarios") or []
    bid = next((s for s in scenarios if s.get("bid")), scenarios[-1] if scenarios else {})
    forms = run.get("forms") or {}
    t2b = run.get("tender_to_bid") or {}
    engine = ((run.get("engine") or {}).get("tender_reading")) or {}
    passed = sum(1 for s in steps if s["status"] == "pass")
    failed = [s for s in steps if s["status"] != "pass"]
    parts: list[str] = []

    # ------------------------------------------------------------------ cover
    reading_mode = f"model ({engine.get('model')})" if engine.get("llm_available") else "rules (no model key on this server)"
    parts.append(f"""
<section class="cover">
  <div>
    <div class="eyebrow">TenderOS · demo run · {esc(run.get('started', '')[:10])}</div>
    <h1>{esc(run.get('tender'))}</h1>
    <p class="eyebrow">RfS No. {esc(run.get('rfs_no'))}</p>
  </div>
  <div class="band">
    <div class="eyebrow">Bidder (fictional)</div>
    <p style="font-size:18pt;color:#fff;margin:2mm 0 4mm">{esc(company.get('name'))}</p>
    <p>{esc(company.get('note'))}</p>
    <div class="kpis" style="color:#15171a">
      <div class="kpi" style="background:#fff"><small>Tariff quoted</small><strong>₹{num(forms.get('tariff'), 2)}/kWh</strong><em>for the target equity IRR</em></div>
      <div class="kpi" style="background:#fff"><small>Contracted</small><strong>{num(bid.get('mw'))} MW</strong><em>RTC-TM, 25 years</em></div>
      <div class="kpi" style="background:#fff"><small>HiGHS scenarios</small><strong>{len(scenarios) + (1 if t2b.get('sizing') else 0)}</strong><em>sized and priced</em></div>
      <div class="kpi" style="background:#fff"><small>Clicks checked</small><strong>{passed} / {len(steps)}</strong><em>{'all passed' if not failed else f'{len(failed)} failed'}</em></div>
    </div>
  </div>
  <div class="small note">
    Run {esc(run.get('started'))} to {esc(run.get('finished'))} against {esc(run.get('url'))}, commit {esc(run.get('commit'))}.
    Tender reading: {esc(reading_mode)}; tables by {'Docling' if (engine.get('set') or {}).get('docling') else 'PyMuPDF'}; search by {esc((engine.get('set') or {}).get('search'))}.
  </div>
</section>""")

    # ------------------------------------------------------------------ the bid at a glance
    sz = sizes_of(bid)
    bf = bid.get("finance") or {}
    mt = bid.get("money_text") or ""
    lowest = min((s for s in scenarios if (s.get("finance") or {}).get("bid_tariff")), key=lambda s: s["finance"]["bid_tariff"], default=None)
    rows = []
    for sc in scenarios:
        s = sizes_of(sc)
        f = sc.get("finance") or {}
        rows.append(
            f"<tr class=\"{'bid' if sc.get('bid') else ''}\"><td>{esc(sc['id'])}</td><td>{esc(sc.get('short') or sc['title'])}</td><td class=n>{num(sc['mw'])}</td>"
            f"<td>{esc(sc['peak'])}</td><td>{esc(sc['shortfall'])}</td><td class=n>{num(s['solar'])}</td><td class=n>{num(s['wind'])}</td>"
            f"<td class=n>{num(s['bessMw'])} / {num(s['bessMwh'])}</td><td class=n>{num(f.get('bid_tariff'), 2)}</td>"
            f"<td class=n>{num(f.get('equity_irr'), 1)}</td><td class=n>{num(f.get('project_irr'), 1)}</td><td class=n>{num(sc.get('seconds'))}</td></tr>"
        )
    parts.append(f"""
<section class="page">
  <h2>The bid at a glance</h2>
  <p>{esc(company.get('name'))} bids <b>{num(bid.get('mw'))} MW</b> of round-the-clock thermal-mimic power under {esc(run.get('rfs_no'))},
  at <b>₹{num(forms.get('tariff'), 2)}/kWh</b>, from solar, wind and a battery sized by HiGHS against every peak and off-peak 15-minute block
  of the tender as amended (Amendment-01: 90% in the Peak Hours, 70% off-peak; Amendment-02: SCSD 24 months after the PPA).</p>
  <div class="kpis">
    <div class="kpi"><small>Solar</small><strong>{num(sz['solar'])} MWac</strong></div>
    <div class="kpi"><small>Wind</small><strong>{num(sz['wind'])} MW</strong></div>
    <div class="kpi"><small>Battery</small><strong>{num(sz['bessMw'])} MW</strong><em>{num(sz['bessMwh'])} MWh</em></div>
    <div class="kpi"><small>Equity / project IRR</small><strong>{num(bf.get('equity_irr'), 1)}% / {num(bf.get('project_irr'), 1)}%</strong></div>
    <div class="kpi"><small>EMD</small><strong>₹{esc(money(mt, 'EMD') or '–')} cr</strong></div>
    <div class="kpi"><small>Performance BG</small><strong>₹{esc(money(mt, 'Performance Bank Guarantee') or '–')} cr</strong></div>
    <div class="kpi"><small>Minimum net worth</small><strong>₹{esc(money(mt, 'Minimum net worth') or '–')} cr</strong><em>bidder: ₹{num((company.get('particulars') or {}).get('netWorthCr'))} cr</em></div>
    <div class="kpi"><small>Formats</small><strong>{len(forms.get('formats') or [])} filled</strong><em>each reviewed</em></div>
  </div>
  <h3>Scenarios, sized by HiGHS in the SECI RTC tender tab</h3>
  <table>
    <tr><th></th><th>Scenario</th><th class=n>MW</th><th>Peak plan</th><th>Shortfall</th><th class=n>Solar MW</th><th class=n>Wind MW</th><th class=n>Battery MW / MWh</th><th class=n>Tariff ₹/kWh</th><th class=n>Equity IRR %</th><th class=n>Project IRR %</th><th class=n>Solve s</th></tr>
    {''.join(rows)}
  </table>
  <p class="note">The highlighted row is the bid filed in the forms. Lowest tariff: {esc(lowest['id'] + ' ' + lowest['title']) if lowest else '–'}
  (₹{num((lowest or {}).get('finance', {}).get('bid_tariff'), 2)}/kWh). Every scenario uses the benchmark costs and financing filled by the app; the tariff is the one that gives the target equity IRR.</p>
  <h3>What the scenarios say</h3>
  <ul>{''.join(f'<li>{o}</li>' for o in observations(scenarios))}</ul>
  <h3>The scenarios</h3>
  {''.join(f'<p class="small"><b>{esc(sc["id"])} · {esc(sc["title"])}.</b> {esc(sc["why"])}</p>' for sc in scenarios)}
</section>""")

    # ------------------------------------------------------------------ the tender set
    reading = t2b.get("reading") or {}
    tsz = t2b.get("sizing") or {}
    parts.append(f"""
<section class="page">
  <h2>The tender as read: the RfS with its amendments</h2>
  <p>The five documents were uploaded together on the Tender to Bid start screen. TenderOS classified them, read the amendment and clarification
  schedules (Docling), applied the amendments to the RfS reading, and indexed every page for search.</p>
  <table><tr><th>Documents</th></tr>{''.join(f'<tr><td>{esc(d)}</td></tr>' for d in reading.get('documents') or [])}</table>
  <div class="kpis">
    <div class="kpi"><small>Terms amended</small><strong>{num(reading.get('amended'))}</strong></div>
    <div class="kpi"><small>Changes</small><strong>{num(reading.get('changes'))}</strong></div>
    <div class="kpi"><small>Clarifications</small><strong>{num(reading.get('clarifications'))}</strong></div>
    <div class="kpi"><small>Formats · steps</small><strong>{num(reading.get('formats'))} · {num(reading.get('process'))}</strong></div>
  </div>
  <h3>Amended terms (RfS → now)</h3>
  {''.join(f'<div class="quote">{esc(r)}</div>' for r in (reading.get('amended_rows') or [])[:8])}
  {img(run_dir, shot_of(steps, 't2b-set-amended'))}
</section>
<section class="page">
  <h3>A change, with its was/now and pages</h3>
  <div class="quote">{esc(reading.get('first_change'))}</div>
  {img(run_dir, shot_of(steps, 't2b-set-changes'))}
  <h3>Clarifications</h3>
  {''.join(f'<div class="quote">{esc(r)}</div>' for r in (reading.get('clarification_rows') or [])[:5])}
  <h3>Search: “{esc((reading.get('search') or {}).get('query'))}”</h3>
  {''.join(f'<div class="quote">{esc(r)}</div>' for r in ((reading.get('search') or {}).get('hits') or [])[:3])}
</section>
<section class="page">
  <h3>Bid formats and bid process found in the RfS</h3>
  <div class="half">{img(run_dir, shot_of(steps, 't2b-set-formats'))}{img(run_dir, shot_of(steps, 't2b-set-process'))}</div>
  <h3>Tender to Bid: the tender as read, sized by HiGHS</h3>
  <p class="small">{esc(tsz.get('sizes_text'))}</p>
  <p class="small">Financials: tariff ₹{num((tsz.get('finance') or {}).get('bid_tariff'), 2)}/kWh, equity IRR {num((tsz.get('finance') or {}).get('equity_irr'), 1)}%,
  project IRR {num((tsz.get('finance') or {}).get('project_irr'), 1)}%; solved in {num(tsz.get('seconds'))} s. Workbook: <span class="mono">{esc(tsz.get('workbook'))}</span>.
  This run uses the terms the reader found (rules reading); the SECI tab below uses the hand-checked conditions with time-block floors.</p>
  {img(run_dir, shot_of(steps, 't2b-size'))}
</section>""")

    # ------------------------------------------------------------------ scenarios
    for sc in scenarios:
        s = sizes_of(sc)
        f = sc.get("finance") or {}
        parts.append(f"""
<section class="page">
  <div class="eyebrow">SECI RTC tender · scenario {esc(sc['id'])}{' · the bid' if sc.get('bid') else ''}</div>
  <h2>{esc(sc['title'])}</h2>
  <p>{esc(sc['why'])}</p>
  <table>
    <tr><th>Contracted</th><th>Peak Hours plan</th><th>Shortfall</th><th>Sources</th><th class=n>Solved in</th></tr>
    <tr><td>{num(sc['mw'])} MW</td><td>{esc(sc['peak'])}</td><td>{esc(sc['shortfall'])}</td><td>solar{', wind' if sc['wind'] else ''}, battery</td><td class=n>{num(sc.get('seconds'))} s</td></tr>
  </table>
  <div class="kpis">
    <div class="kpi"><small>Solar</small><strong>{num(s['solar'])} MWac</strong></div>
    <div class="kpi"><small>Wind</small><strong>{num(s['wind'])} MW</strong></div>
    <div class="kpi"><small>Battery</small><strong>{num(s['bessMw'])} MW</strong><em>{num(s['bessMwh'])} MWh</em></div>
    <div class="kpi"><small>Tariff · equity · project IRR</small><strong>₹{num(f.get('bid_tariff'), 2)}</strong><em>{num(f.get('equity_irr'), 1)}% · {num(f.get('project_irr'), 1)}%</em></div>
  </div>
  <p class="small"><b>Money at stake:</b> {esc(sc.get('money_text'))}</p>
  {img(run_dir, shot_of(steps, f"seci-{sc['id']}-sizes"), "shot mid")}
  {img(run_dir, shot_of(steps, f"seci-{sc['id']}-compliance"), "shot mid")}
  <p class="small note">Workbook: <span class="mono">{esc(sc.get('workbook'))}</span></p>
</section>""")
        parts.append(f'<section class="page"><h3>{esc(sc["id"])}: financials</h3>{img(run_dir, shot_of(steps, f"seci-{sc["id"]}-finance"))}</section>')

    # ------------------------------------------------------------------ agent charts
    charts = run.get("charts") or []
    parts.append('<section class="page"><h2>The bid agent\'s charts, on the bid</h2><p>The GPT-Live bid agent opens these as it talks; here they are opened by click on the sized bid.</p>'
                 f'<div class="half">{"".join(img(run_dir, c) for c in charts)}</div></section>')

    # ------------------------------------------------------------------ forms
    particulars = (company.get("particulars") or {})
    prow = "".join(f"<tr><td>{esc(k)}</td><td>{esc(v)}</td></tr>" for k, v in particulars.items())
    frow = "".join(f"<tr><td>{esc(f['id'])}</td><td>{esc(f['title'])}</td><td>pp. {esc(f['pages'][0])}–{esc(f['pages'][1])}</td><td>{esc(f.get('blanks'))}</td><td class=n>{esc(f.get('typed'))}</td><td class=pass>reviewed</td></tr>"
                   for f in forms.get("formats") or [])
    parts.append(f"""
<section class="page">
  <h2>The tender, fully filled: bid forms</h2>
  <p>Every particular entered once; every blank of every format this bid needs filled (from the sized bid, from the particulars, or typed), each format
  reviewed beside its RfS page; the checks; the bid pack downloaded as Word: <span class="mono">{esc(forms.get('bid_pack'))}</span>.</p>
  <h3>Particulars</h3>
  <table><tr><th>Field</th><th>Value</th></tr>{prow}<tr><td>tariff</td><td>₹{num(forms.get('tariff'), 2)}/kWh ({esc(next((v for k, v in (company.get('blanks') or {}).items() if k == '7.10.tariffWords'), '') or '')})</td></tr></table>
  <h3>Formats needed for this bid</h3>
  <table><tr><th>Format</th><th>Title</th><th>RfS</th><th>Blanks</th><th class=n>Typed</th><th>Status</th></tr>{frow}</table>
  <h3>Checks</h3><p class="small">{esc(forms.get('checks'))}</p>
</section>
<section class="page"><h3>Particulars and checks, on screen</h3>{img(run_dir, shot_of(steps, 'seci-forms-checks'))}{img(run_dir, shot_of(steps, 'seci-forms-nav'))}</section>""")
    for f in forms.get("formats") or []:
        vals = "".join(f"<tr><td>{esc(v['label'])}</td><td class=v>{esc(v['value']) or '<span class=fail>empty</span>'}</td><td class=src>{esc(v['source'])}</td></tr>" for v in f.get("values") or [])
        atts = "".join(f"<li>{'☑' if a['checked'] else '☐'} {esc(a['label'])}</li>" for a in f.get("attachments") or [])
        parts.append(f'''<section class="page"><div class="eyebrow">Bid forms · RfS pp. {esc(f["pages"][0])}–{esc(f["pages"][1])} · {esc(f.get("blanks"))} · reviewed</div>
<h2>Format {esc(f["id"])}: {esc(f["title"])}</h2>
{'<table><tr><th>Blank</th><th>Filled with</th><th>From</th></tr>' + vals + '</table>' if vals else '<p>Nothing to fill: signed and stamped as issued.</p>'}
{('<h3>Enclosed</h3><ul>' + atts + '</ul>') if atts else ''}
{img(run_dir, shot_of(steps, "seci-forms-" + f["id"]), "shot mid")}</section>''')

    # ------------------------------------------------------------------ letters
    letters = run.get("letters") or {}
    if letters.get("letters"):
        lrow = "".join(f"<tr><td>{esc(x['id'])}</td><td>{esc(x['title'])}</td><td class=n>{esc(x.get('words'))}</td><td class=n>{esc(x.get('struck'))}</td>"
                       f"<td class=mono>{esc(x.get('word'))}<br>{esc(x.get('pdf'))}</td></tr>" for x in letters["letters"])
        edit = letters.get("edit") or {}
        parts.append(f"""
<section class="page">
  <h2>The letters: every format in the RfS wording, filled</h2>
  <p>Each format this bid needs, as the full letter SECI prints in the RfS: the blanks filled from the bid and the particulars, the
  alternatives not chosen struck out (as the RfS asks), each paragraph editable in place. Each letter was downloaded as Word and PDF,
  then all of them together: <span class="mono">{esc(letters.get('all_word'))}</span> and <span class="mono">{esc(letters.get('all_pdf'))}</span>.</p>
  <table><tr><th>Format</th><th>Title</th><th class=n>Words</th><th class=n>Struck</th><th>Files</th></tr>{lrow}</table>
  <h3>A change in place</h3>
  <p class="small">In Format {esc(edit.get('format'))}, paragraph {esc(edit.get('block'))} was extended with: <i>{esc(edit.get('added'))}</i>
  The paragraph was marked as the bidder's wording and the format's review asked to be redone ({esc(edit.get('review'))}); it was then
  reverted to the RfS wording, so the files above carry the RfS text. Saved to the scenario library: {esc(letters.get('saved'))}.</p>
  <p class="small">The paragraph as changed (left) and reverted (right):</p>
  <div class="half">{img(run_dir, shot_of(steps, 'seci-letter-edit-block'))}{img(run_dir, shot_of(steps, 'seci-letter-revert'))}</div>
</section>""")
        for x in letters["letters"]:
            parts.append(f'<section class="page"><div class="eyebrow">The letters · as shown in TenderOS</div><h2>Format {esc(x["id"])}: {esc(x["title"])}</h2>'
                         f'{img(run_dir, shot_of(steps, "seci-letter-" + x["id"]))}</section>')

    # ------------------------------------------------------------------ other tabs
    rtc = run.get("rtc") or {}
    parts.append(f"""
<section class="page">
  <h2>The other tabs</h2>
  <h3>Round the Clock</h3><p class="small">{esc(rtc.get('stats'))}</p>{img(run_dir, shot_of(steps, 'rtc-00'))}
  <div class="half">{img(run_dir, shot_of(steps, 'bess-how'))}{img(run_dir, shot_of(steps, 'cfd-00'))}</div>
</section>""")

    # ------------------------------------------------------------------ click log
    log = "".join(
        f"<tr><td class=n>{i}</td><td>{esc(s['section'])}</td><td>{esc(s['name'])}</td><td class=\"{'pass' if s['status'] == 'pass' else 'fail'}\">{esc(s['status'])}</td>"
        f"<td class=n>{num(s['seconds'], 1)}</td><td class=small>{esc(s.get('note'))}</td></tr>"
        for i, s in enumerate(steps, 1)
    )
    parts.append(f"""
<section class="page">
  <h2>Every click, checked</h2>
  <p>{passed} of {len(steps)} steps passed{'' if not failed else f'; {len(failed)} failed (listed in red)'}. Browser page errors: {len(run.get('page_errors') or [])}.</p>
  <table><tr><th class=n>#</th><th>Section</th><th>Step</th><th>Result</th><th class=n>Seconds</th><th>Note</th></tr>{log}</table>
</section>""")

    # ------------------------------------------------------------------ files and limits
    files = sorted(p.relative_to(run_dir).as_posix() for p in run_dir.rglob("*") if p.is_file() and not p.name.endswith(".pdf") and "/screens/" not in f"/{p.relative_to(run_dir).as_posix()}")
    shots = len(list((run_dir / "screens").glob("*.jpg")))
    parts.append(f"""
<section class="page">
  <h2>Files of this run</h2>
  <table><tr><th>File</th><th class=n>KB</th></tr>{''.join(f'<tr><td class=mono>{esc(f)}</td><td class=n>{num((run_dir / f).stat().st_size / 1024)}</td></tr>' for f in files)}
  <tr><td class=mono>screens/ ({shots} screenshots)</td><td class=n></td></tr></table>
  <h2>What this run does not show</h2>
  <ul>
    <li>The bidder, its people, figures, bank and instruments are invented. Nothing here is a real bid, guarantee or financial statement.</li>
    <li>Costs, CUFs and financing are the app's benchmarks, not quotes; the tariffs follow from them.</li>
    <li>Tender reading ran in {esc(reading_mode)}. The model reading (Claude) is not part of this run.</li>
    <li>The GPT-Live voice agent was {'not configured on this server; its panel and charts were opened by click' if not any('voice available' in (s.get('note') or '') for s in steps) else 'available'}.</li>
    <li>The bid pack and the letters are drafts for the bidder to print on letterhead or stamp paper, sign and stamp; the EMD instrument and enclosures are the bidder's to obtain. The letters follow the RfS wording as extracted from the RfS PDF; check them against the RfS before signing.</li>
  </ul>
</section>""")

    doc = f"<!doctype html><html><head><meta charset='utf-8'><title>TenderOS demo report</title><style>{CSS}</style></head><body>{''.join(parts)}</body></html>"
    html_path = run_dir / "report.html"
    html_path.write_text(doc, encoding="utf-8")
    pdf_path = run_dir / "TenderOS-demo-report.pdf"
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=os.environ.get("PLAYWRIGHT_CHROMIUM") or None)
        page = browser.new_page()
        page.goto(html_path.as_uri())
        page.pdf(path=str(pdf_path), format="A4", print_background=True,
                 display_header_footer=True, header_template="<span></span>",
                 footer_template="<div style='font-size:7pt;width:100%;text-align:center;color:#888'>TenderOS demo · fictional bidder · page <span class='pageNumber'></span> of <span class='totalPages'></span></div>",
                 margin={"top": "14mm", "bottom": "16mm", "left": "12mm", "right": "12mm"})
        browser.close()
    html_path.unlink()
    return pdf_path


if __name__ == "__main__":
    target = Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / "demo" / json.loads((ROOT / "demo/company.json").read_text())["slug"]).resolve()
    print(build(target))
