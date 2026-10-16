# End to end on one tender: NHPC FDRE-II

The tender is the NHPC RfS for 1,200 MW of Firm & Dispatchable RE power (ISTS, anywhere in India,
Tranche-II, Open Category). It is tender no. `2024_NHPC_800202_1` and runs to 264 pages:
`samples/tenders/nhpc-fdre-ii/RfS.pdf`. The reviewed reading in `reviewed-reading.yaml` is the
tender_engine gold record: 97 fields, each decided by a reviewer.

Run 2026-10-16. The reading used rules mode: no `ANTHROPIC_API_KEY` was available, so the model
reader was not exercised here.

## 1. Reading (`tests/e2e/test_nhpc_tender.py`)

* The tender type was detected as `fdre`. 31 fields were found and all 31 are located on their
  page and validated. None needs review and none was rejected. The read takes about 5 s.
* Comparison with the reviewed reading:

| Outcome | Fields |
| --- | --- |
| Same value | 17 |
| Same facts, different wording | 7 |
| No reviewed value | 7 |

* The 17 fields with the same value include the tender number, the issuer, every key date, the
  total capacity, the minimum and maximum bid, the location, SCOD, the PPA tenure, the assured
  availability, the storage mandate and the shortfall multiple. The test asserts these 17 are
  equal.
* The 7 fields with different wording are:
  * free text the reviewer wrote in their own words: the summary, the title, the type as stated
    and the demand profile;
  * structured fields the reviewer filled in more detail: the shortfall rules, the peak window
    definition and the structured demand profile.

  These are not asserted equal.
* The 7 fields with no reviewed value are overlay fields (from the jouleWise port) that tender_engine does not
  have: permitted sources, the annual and peak floors, peak hours per day, the market sale scope,
  the PPA priority and who sets the peak hours.

## 2. Terms for the bid (`tools/check_nhpc_terms.mjs`)

`tenderMap.js` turns the reading into the sizing terms. Each term below is proved by a located
quote.

| Term | Value | Page |
| --- | --- | --- |
| Capacity | 1,200 MW; one bidder 50 to 600 MW | 1, 8 |
| Annual supply floor | 40% CUF each year | 29 |
| Peak-hour supply floor | 90% every month | 29 |
| Peak hours | 4 h a day: 2 h within 05:00 to 10:00, 2 h within 18:00 to 23:00, as the Buying Entity schedules | 29 |
| Permitted sources | solar, wind, any other renewable resource (so hydro and biomass), storage | 17 |
| Storage | mandatory | 56 |
| Market sale | to a third party or on a power exchange | 35 |
| PPA term | 25 years | 8 |
| Ceiling tariff | not stated | n/a |

The bid starts at 600 MW, the most one bidder may offer.

## 3. Browser, sign-in to Excel (`tests/e2e/test_tender_to_bid.py`)

1. Sign in.
2. Upload the RfS, which reads 264 pages and 31 fields.
3. Bid capacity is 600 MW, with "Allowed: 50 to 600 MW".
4. Sources are solar, wind and battery (biomass switched off), with the benchmark costs filled in.
5. Size with HiGHS: optimal in about 50 s.
6. Tender conditions.
7. Financials, then download the Excel model.

| Result | Value |
| --- | --- |
| Solar | 1,281 MW (2.14 × contracted) |
| Wind | 619 MW (1.03 × contracted) |
| Battery | 924 MW / 3,697 MWh (4.0 h) |
| Bid tariff | ₹5.435/kWh (no design below ₹5.434) |
| Equity IRR / project IRR | 14.00% / 9.96% |
| Minimum DSCR | 1.13 (average 1.56) |
| Project cost | ₹14,267 cr (₹23.78 cr per contracted MW) |
| Levelised cost | ₹4.729/kWh at 10% |
| Year-1 supply | 4,117 MU |
| Annual floor, worst year | 75.1% (target 40%) |
| Peak floor, worst year | 90.0% in every window hour (target 90%) |
| Tender conditions | 7 met, 0 not met, 2 noted or not required |
| Excel | `…_600MW_financial_model.xlsx` |

The same test passed twice: against the local processes (`tools/dev.sh`) and against the Docker
Compose stack (`docker compose up`).

The costs are the built-in benchmarks, not a bidder's quotes. The tariff therefore shows that the
chain works end to end. It is not a bid recommendation.
