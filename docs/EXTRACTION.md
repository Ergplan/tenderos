# Tender extraction (`engine/extraction`)

Reads an Indian power tender (RfS / RfQ / RfP / NIT; PDF, DOCX or text) into typed fields. Every
field carries the page and verbatim quote it rests on, and deterministic rules check it. The
package is stateless and sits behind FastAPI endpoints. Nothing is stored except short-lived job
files.

## Origin

The extraction engine of `Ergplan/tender_engine` at commit `5c29b4e` (main, read-only reference).
FDRE's jouleWise branch (`tender_intel/`, ported from tender_engine `bd4959c`) made the first
stateless port. This package carries that port forward to the current tender_engine.

| `engine/extraction/` | From tender_engine | Notes |
| --- | --- | --- |
| `packs/core/common.yaml`, `packs/core/prompts/**` | `tender/domain_packs/core/` | copied, every prompt version |
| `packs/power/*.yaml`, `packs/power/prompts/**` | `tender/domain_packs/power/` | schema v4: pack.yaml and every type file, including `re_rtc` and its `supply_sources` section; `released/` signatures not copied |
| `prompts/extract/v1.md`, `v2.md`, `prompts/section_map/v1.md` | `core/llm/prompts/` | `extract/v2` adds the withdrawal rule |
| `schema.py` | `tender/services/packs.py` | `compile_type`; sections marked `derived: true` are dropped (rules compute them; the model does not read them) |
| `values.py`, `resolver.py`, `pages.py`, `section_map.py`, `rules.py` | `core/…`, `tender/domain_packs/…` | as in the FDRE port |
| `extract.py` | `core/services/extract.py`, `validate.py` | page selection, one call per section, quote resolution, confidence cap 0.3, rejection without quotes, withdrawals |
| `llm.py` | `core/llm/client.py`, `registry.py` | prompt loading with `extends`; Anthropic only |

These pieces are not from tender_engine. They come from the jouleWise branch:

* `packs/overlay.yaml` adds the fields the Tender to Bid sizing needs, among them permitted RE
  sources, the annual, monthly and peak supply floors, peak hours, green share, non-RE allowed,
  the solar multiple, the supply start date and the greenshoe capacity. The catalog marks them
  `"source": "fdre_overlay"`.
* `rules_reader.py` and `lexicon.py` make up rules mode (below).
* `jobs.py` keeps file-backed read jobs.

## Model

The extraction model is **`claude-fable-5-1`**, the locked choice in tender_engine. Each call sends
the section's pages as a native PDF `document` block, and `messages.parse` checks the answer
against the section's Pydantic schema. If a call is refused or truncated (`max_tokens`), it fails.
The engine never retries such a call on another model, so results stay comparable with
tender_engine's evals. `EXTRACTION_MODEL` overrides the model for an experiment. The result reports
which model was used.

## Modes

**llm** means the model reads the PDF pages. This mode runs for `mode=llm`, or for `mode=auto`
when `ANTHROPIC_API_KEY` is set and the file is a PDF.

1. Section map: one call over a digest of every page returns the document's sections.
2. For each section of the tender type, the engine:
   * picks at most 40 pages: the mapped sections plus up to 12 keyword pages;
   * cuts those pages into a sub-PDF and sends it with the field list and a page mapping;
   * uses the section's prompt version as the system prompt, which extends `extract/v2`.

   Sections run concurrently (`EXTRACTION_CONCURRENCY`, default 4). If a section's call fails,
   its fields are left `not_found` and a warning is added.

**Withdrawals** (from `extract/v2`): a provision that a later clause deletes or withdraws is
reported with `withdrawn: true`, its quotes and no value.

* With quotes that are located on the page, the field's status is `withdrawn` and it carries a
  warning issue.
* With no quotes at all, the field is `rejected`.
* With quotes that cannot be located, the field is `needs_review`.

A withdrawn provision is never filled in from elsewhere.

**rules** needs no model. This mode runs without a key, for DOCX and text uploads, or for
`mode=rules`.

* Deterministic extractors fill the headline fields:
  * identity and key dates;
  * EMD and PBG per MW;
  * capacity, with the minimum and maximum bid and the greenshoe;
  * location, PPA tenure, SCOD and the ceiling tariff;
  * the FDRE / RTC profile: supply floors, peak hours and windows, storage, permitted sources;
  * the BESS performance figures.
* Each value comes with a verbatim quote of 5 to 40 words that contains the value.
* Confidence is 0.6, or 0.4 when the document prints conflicting values.
* Every other field is `not_found`.

**Both modes** then run the same checks:

1. Each quote is looked up on its stated page, then the neighbouring pages, then the section's
   pages, then across a page break (resolver threshold 85).
2. A value with no quote is `rejected`. If none of a value's quotes can be located, its
   confidence is capped at 0.3.
3. The value is coerced to its type.
4. The range rules and cross-field rules run, and `structured_numbers_quoted` requires every
   number in a structured value to be printed in that field's own quotes. These rules are plain
   Python with no model involved.

A field ends with one of these statuses: `validated`, `needs_review`, `not_found`, `rejected` or
`withdrawn`.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | (unset) | enables llm mode; kept on the engine only, never sent to the browser |
| `EXTRACTION_MODEL` | `claude-fable-5-1` | model id |
| `EXTRACTION_REQUIRE_LLM` | (unset) | `1`: a read that cannot use the model fails instead of using rules |
| `EXTRACTION_CONCURRENCY` | 4 | sections read in parallel |
| `EXTRACTION_TIMEOUT_SECONDS` | 300 | per-request timeout |
| `EXTRACTION_JOBS_DIR` | `/tmp/tenderos_extraction_jobs` | job files, shared by the engine's workers |

## API

The same handlers are mounted under `/api/bid/tender` and `/api/rtc/tender`. The web app forwards
a request only when the signed-in user may use a tab that needs that route family
(`web/lib/tabs.js`).

| Method and path | Result |
| --- | --- |
| `GET …/status` | `{llm_available, provider, model, default_mode, require_llm, types, extraction}` |
| `GET …/catalog?tender_type=fdre` | the sections and their fields; 422 for an unknown type |
| `POST …/read` with body `{file: {name, content_base64}, tender_type, mode}` | 202 `{job_id, status, mode}`, or the result itself with `?sync=1` |
| `GET …/read/{job_id}` | `{status, progress, error, result, …}` |
| `POST /api/bess/parse` | the BESS tab's adapter (`engine/bess/requirements.py`): `read_tender(tender_type="bess")` mapped to the BESS inputs |

Read errors:

| Status | Cause |
| --- | --- |
| 400 | the file cannot be decoded or read |
| 400 | `mode=llm` without a key |
| 413 | the file is over 60 MB |
| 422 | unknown tender type or mode |

The result holds:

* the document: name, page count, sha256, text pages and scanned pages;
* the tender type and how it was chosen;
* `sections`, each with its fields;
* `values`, the coerced value of each field found;
* `rules`, `counts`, `usage` and `warnings`.

Each field carries its value, display text, confidence, status, rationale, `withdrawn`, its
`evidence` (page, quote, located, score and bbox) and its `issues`.

## Tests

* `tests/engine/test_extraction.py` covers the following, without network access:
  * schema compilation, with derived sections excluded;
  * the resolver, the rules and the rules reader on real PDFs;
  * model mode against a fake SDK object, including a refusal and a truncated answer, which fail
    with no fallback model;
  * withdrawals;
  * jobs and the API.
* `tests/e2e/test_nhpc_tender.py` reads the NHPC FDRE-II RfS and compares the reading with the
  reviewed tender_engine record (`samples/tenders/nhpc-fdre-ii/reviewed-reading.yaml`). See
  `docs/E2E-NHPC.md`.

## Limitations

* Rules mode reads the headline fields only, by pattern. It misses unusual wording and cannot
  read scanned pages. Model mode sends page images, but evidence on a scanned page cannot be
  located.
* One call per section caps what a section sees at 40 pages.
* Model mode has not been run in this repository's CI, which has no key. Its tests use a fake SDK.
  Run a real tender with `ANTHROPIC_API_KEY` set before relying on it.
* There is no corrigendum versioning, approval workflow or audit of approved values. Those live
  in tender_engine and were not ported. Here a reading is an input that the reviewer ticks into
  the bid, never a stored fact.
