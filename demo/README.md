# TenderOS demo: Arkaja Renewables bids SECI RTC-TM-V

A demo run of the whole application, clicked through once in a browser with every step checked,
for one bidder and one tender:

* **Bidder:** Arkaja Renewables Private Limited. It is **fictional**: the company, its people,
  figures, bank ("Demo Bank Limited") and instruments are invented (`company.json`). Nothing here
  is a real bid, guarantee or financial statement.
* **Tender:** SECI RTC-TM-V (RfS No. SECI/C&P/IPP/13/0020/25-26): 1000 MW of round-the-clock
  thermal-mimic power. The RfS, its two amendments, the clarifications and the PSA are in
  `web/public/tenders/seci-rtc-tm-v/`.

## What is in `arkaja-seci-rtc-tm-v/`

| File | What it is |
| --- | --- |
| `TenderOS-demo-report.pdf` | The report of the run: the bid at a glance, the HiGHS scenarios side by side, the tender set as read, one page per scenario, the bid agent's charts, every bid format filled and reviewed, the other tabs, every click with its result, and what the run does not show |
| `bid-pack/*.docx` | The bid pack the SECI tab writes: the particulars, the checks, every format this bid needs with every blank filled |
| `models/*.xlsx` | The financial model of each scenario (formula workbooks with the Live model tab), of Tender to Bid's sizing, of the Round the Clock tab and of the CfD tab |
| `run.json` | Every step: section, name, result, seconds, note, screenshot; plus the scenarios' sizes, compliance, money at stake and financials, the tender set as read, and the filled forms |
| `screens/*.jpg` | A screenshot of each step |

## The run

1. **Tender to Bid.** The five documents are uploaded together and read as a tender set:
   * the documents are classified;
   * Docling reads the amendment and clarification schedules;
   * the amendments are applied to the RfS (least bid 100 → 50 MW, SCSD 18 → 24 months, Peak
     Hours 18:00–10:00);
   * every page is indexed for search.

   Then the panel's tabs, a search, key dates, capacity, sources with benchmarks, a HiGHS
   sizing, the financials and the workbook.
2. **SECI RTC tender tab.**
   * The documents and the conditions in force.
   * Six HiGHS scenarios, each sized against every peak and off-peak 15-minute block:
     * meet every block;
     * evening Peak Hours only;
     * no wind;
     * 500 MW;
     * 50 MW;
     * the bid: 200 MW, any 6 Peak Hours, pay the penalty.
   * For each scenario: sizes, compliance, EMD, PBG and net worth, the tariff for the target
     IRR with the equity and project IRR, and the workbook.
3. **The bid filed.**
   * The bid agent's charts.
   * Every particular, and every blank of every format this bid needs (7.1, 7.3A, 7.4, 7.6,
     7.7, 7.8, the 7.8 annexure, 7.9, 7.10, 7.11 and Annexure-B).
   * Each format reviewed beside its RfS page, the checks, and the bid pack.
4. **Round the Clock, BESS Tender, CfD Bid.** Every chapter or step opened, and their workbooks.

## Run it again

With the stack running (`tools/dev.sh` locally, or a deployment) and Chromium available:

```
TENDEROS_URL=http://127.0.0.1:3000 TENDEROS_DEMO=1 make demo
```

On a deployment with sign-in, set `TENDEROS_EMAIL` and `TENDEROS_PASSWORD` instead of
`TENDEROS_DEMO`. `PLAYWRIGHT_CHROMIUM` points at a Chromium binary if Playwright has none.

The run takes 15 to 30 minutes, most of it HiGHS.

* `tools/demo_run.py` writes the folder. It exits non-zero if any step failed, and the report
  lists that step in red.
* `tools/demo_report.py` writes the PDF.
* The bidder's particulars and blanks are in `company.json`. Change them to demo another company.

## What the run does not show

* **Costs and financing** are the app's benchmarks, not quotes; the tariffs follow from them.
* **Tender reading:** the report says which mode ran. Without `ANTHROPIC_API_KEY` it is the
  rules reader, not the model.
* **Voice:** the GPT-Live agent's panel and charts are opened by click; a voice conversation
  needs `OPENAI_API_KEY` and a microphone.
* **The bid pack** is a Word draft. The bidder prints it on letterhead or stamp paper, signs and
  stamps it, and obtains the EMD instrument and the enclosures.
