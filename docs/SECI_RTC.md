# SECI RTC tender tab

The **SECI RTC tender** tab takes one named tender, SECI's RTC-TM-V (1,000 MW of firm and
dispatchable RE power, ISTS-connected, RfS No. SECI/C&P/IPP/13/0002/25-26), from its documents to a
priced, sized bid and a filled bid pack. A voice guide can walk the bidder through the tab from
start to finish.

## The documents

These documents are in `web/public/tenders/seci-rtc-tm-v/`:

* Amendment-01
* Amendment-02
* Clarifications-01
* the Standard PSA

**The main RfS was not provided.** The tab says so on its first screen. It shows the RfS's terms
only where an amendment, the clarifications or the PSA quote them.

These terms are not in any of the four documents:

* the PPA term (25 years is assumed and marked "assumed");
* any ceiling tariff;
* the bid deadline;
* the exact wording of the bid formats.

The tender pack `web/src/seci/seci-rtc-tm-v.json` holds the following, each item with its
document, page and quote:

* 23 amendment changes, each clause as it was and as it is now;
* 9 clarifications;
* 31 bid conditions.

`tests/test_seci_pack.py` (part of `make test`) checks that every quote is on its page.

Clause 34.3 (technical eligibility) is shown as **unclear**. Amendment-02 marks it "Not used", but
other clauses still refer to it.

## The steps

| Step | What it shows | Code |
| --- | --- | --- |
| Documents | The documents, the amendment trail (filter by amendment), SECI's answers to the clarifications; each quote links to its page in the PDF | `DocumentsStep.jsx` |
| Conditions | The 31 conditions grouped, each marked as from the PSA, amended, clarified, removed or unclear | `ConditionsStep.jsx` |
| What you bid | The contracted MW (50 to 500), the Peak Hours plan, the shortfall plan, the PPA date and the dates that follow from it (Amendment-02: SCSD 24 months after the PPA, Financial Closure 6 months before the SCSD, latest start SCSD + 6 months), and the EMD, PBG and net worth on the sized plant | `BidStep.jsx`, `terms.js` |
| Supply sources | Solar, wind, biomass and the mandatory battery, with costs (Tender to Bid's step) | `../bid/SourcesStep.jsx` |
| Size | HiGHS sizes the least-tariff plant against every peak and off-peak block | `../bid/SizeStep.jsx`, `../bid/useSizing.js` |
| Financials | The financial model and the Excel workbook with its Live model tab (every cell a formula) | `../bid/FinanceStep.jsx`, `web/lib/liveModel.js` |
| Bid forms | The bidder's particulars, the tariff, the substation, connectivity, net worth and experience, checked against the tender; the bid pack as Word | `BidForms.jsx`, `forms.js`, `POST /api/seci/forms` |

## How the tender's supply rules reach the engine

`seciTerms(settings)` (`web/src/seci/terms.js`) turns the tender and the bidder's two planning
choices into terms shaped like Tender to Bid's terms. The sizing, the finance and the Excel export
are the same code as in Tender to Bid.

The supply rules are two time-block floors on the contracted capacity, both with
`basis: "block"`:

| Rule | Hours | Floor |
| --- | --- | --- |
| Peak | `hours: "peak"` | 90% |
| Off-peak | `hours: "offpeak"` | 70% |

**Peak Hours.** The Buying Entity picks any 6 hours between 18:00 and 10:00, and names them only a
day ahead. The bidder chooses one of two plans:

* **Any 6 of the 16 hours (the default):** all 16 hours are held to 90%, so the plant is safe
  whichever hours are picked.
* **Evening only:** 18:00 to 24:00 only, which is cheaper but short whenever a morning hour is
  picked.

**Shortfall.** The bidder chooses one of two plans:

* **Pay the penalty (the default):** each block's floor gets a shortfall variable, priced at
  1.5 × the tariff. HiGHS then weighs each missing MWh against the extra plant that would cover it.
* **Meet every block:** the floors are hard.

The engine side is in `engine/sizing/rtc_lp.py`:

* `block_rules` and `penalty_mult` set up the floors;
* the per-hour rows are `delivered + shortfall ≥ floor`;
* `rule_outcome` reports the hours met and the MWh short.

The finance charges the block penalty each year as `blockPenalty`, and the Live model has the same
rows as Excel formulas.

Excess power above the contracted capacity may be sold (PSA 2.11.5).

## Voice guide

The guide (`VoiceGuide.jsx`, `voice.js`) is a guided model-filling exercise that runs in a fixed
order:

1. It explains six key conditions: what you bid, the floors, the Peak Hours, the penalty, the plant
   and the money at stake.
2. It asks the bid questions: MW, Peak Hours plan, shortfall plan and PPA date.
3. It offers to fill in the industry benchmarks, then asks whether surplus power will be sold.
4. It goes through each source's inputs and the financing inputs, reading out the benchmark for
   each.
5. It sizes the plant, then explains the result: the sizes, the floors met, the shortfall, EMD,
   PBG, net worth and the dates.
6. It explains the financial model (the tariff, rounded up to the paisa, and the IRR), then points
   to the bid forms.

While it runs, the guide shows the step it is asking about and highlights the input.

**Speech.** The guide speaks with the browser's speech synthesis. It listens with speech
recognition (`en-IN`).

**Answers.** Answers can be:

* numbers in words ("two hundred");
* dates ("7 June 2026");
* option names ("any", "penalty");
* yes or no.

**Commands.** The guide accepts these commands:

* "next" or "skip" keeps the benchmark;
* "back";
* "repeat";
* "benchmark";
* "help";
* "stop".

**Typed answers.** Every answer can also be typed into the guide's box, and the guide can be muted.

**HTTPS.** Microphones work only on HTTPS (or localhost). On a plain-HTTP deployment the guide
says so and takes typed answers. Speech output works either way.

Nothing is recorded or sent anywhere: recognition runs in the browser.

## Bid forms

`forms.js` defines the fields and checks them against the tender (`bidChecks`):

* the capacity band;
* the mandatory storage;
* the substation commissioning date (by 30.06.2028);
* the net worth against the sized plant;
* the experience, where cl. 34.3 still applies;
* the EMD and PBG amounts;
* the PPA dates.

`POST /api/seci/forms` writes a Word bid pack with `web/lib/docx.js`. The pack contains:

* the particulars;
* the offer;
* the checks;
* the EMD and PBG on the sized plant;
* the sources quoted.

The exact wording of the formats is in the RfS, which was not provided. **Check the pack against
the RfS formats before submission.**

## Tests

| Test | Command |
| --- | --- |
| The pack's quotes are on their pages | `make test` (`tests/test_seci_pack.py`) |
| Block floors in the LP: hard (fast), penalty (slow) | `make test`, `make test-slow` (`tests/engine/test_block_rules.py`) |
| Terms, LP payload, dates, money at stake, forms, voice parsing and the guide's script | `make check-web` (`tools/check_seci.mjs`) |
| The block penalty in the Live model, recalculated by LibreOffice | `make check-web` (`tools/check_live_model.mjs`) |
| In the browser: documents, conditions, the guided voice run with typed answers through sizing, results and finance, the bid forms and the Word pack, the Excel workbook | `make e2e` (`tests/e2e/test_seci_tab.py`) |

## Access

An administrator grants the tab (`seciRtc`) per user. It uses the engine's `rtc` and `bid` route
families. The tender PDFs are served behind the login.
