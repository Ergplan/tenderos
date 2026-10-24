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
| `DOCLING_URL` | `http://docling:5001` in compose, else unset | docling-serve for a tender set's tables; empty: PyMuPDF's table finder |
| `DOCLING_TIMEOUT_SECONDS` | 900 | how long one Docling conversion may take |
| `LLAMA_CLOUD_API_KEY` | (unset) | LlamaParse text for scanned pages of a tender set |
| `LLAMA_CLOUD_BASE_URL`, `LLAMAPARSE_TIMEOUT_SECONDS` | `https://api.cloud.llamaindex.ai`, 600 | LlamaParse endpoint and timeout |

## API

The same handlers are mounted under `/api/bid/tender` and `/api/rtc/tender`. The web app forwards
a request only when the signed-in user may use a tab that needs that route family
(`web/lib/tabs.js`).

| Method and path | Result |
| --- | --- |
| `GET …/status` | `{llm_available, provider, model, default_mode, require_llm, types, extraction}` |
| `GET …/catalog?tender_type=fdre` | the sections and their fields; 422 for an unknown type |
| `POST …/read` with body `{file: {name, content_base64}, tender_type, mode}` | 202 `{job_id, status, mode}`, or the result itself with `?sync=1` |
| `GET …/read/{job_id}` | `{status, progress, error, preview, result, …}`. `preview` arrives about a second after the upload, before `result`: for each scan-screen agent, up to 40 lines of the document's own text with their page and the matched phrases (`preview.py`) |
| `POST …/read-set` with body `{files: [{name, content_base64}, …], tender_type, mode}` | 202 `{job_id, status, files}`; poll `…/read/{job_id}` as for one file. Up to 20 files, 120 MB in all |
| `GET …/search?job_id=…&q=…&k=10&role=&doc=` | `{query, engine, hits: [{doc, title, role, page, text, score}]}` over every page of a finished set read; 404 unknown job, 409 not a finished set |
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

## Tender sets (`engine/extraction/tenderset`)

A tender is rarely one document. The RfS comes with amendments (or corrigenda), the issuer's
answers to bidders' queries, and the draft PPA and PSA. `read_set(files)` reads them together:

| Step | Module | What it does |
| --- | --- | --- |
| Pages | `pages.py`, `tenderset/llamaparse.py` | PyMuPDF text with character boxes for every file. A page with no text layer is sent to LlamaParse when `LLAMA_CLOUD_API_KEY` is set (its text has no boxes, so quotes on it are located but not highlighted); otherwise the set warns. |
| Documents | `tenderset/documents.py` | Each file's role from its first page: `rfs`, `amendment` (amendment, corrigendum, addendum), `clarification`, `agreement` (PPA, PSA, BESPA, TSA) or `other`, with its number, reference and date. The set is ordered as it applies: the RfS, then amendments and clarifications by date and number, then agreements. Ids: `rfs`, `amd1`, `amd2`, `clar1`, `ppa`, `psa`. |
| Tables | `tenderset/layout.py`, `tenderset/docling.py` | Amendment and clarification schedules are tables. Docling (docling-serve, `DOCLING_URL`) reads their grids, merged cells and rows that run onto the next page; without it, or when it fails, PyMuPDF's table finder (with a warning). The RfS itself is not sent to Docling (139 pages would take minutes on CPU). |
| Changes | `tenderset/changes.py` | One change per schedule row: the document it amends (from rows such as "Amendments in PPA document"), S. No., clause, the existing and amended text as printed, each located on its page of the amendment (`before.evidence`, `after.evidence`), the kind (`modified`, `added`, `deleted`, `replaced`), a word diff and a mechanical effect ("'100 MW' -> '50 MW'"). A cell spanning both columns ("Clause modified as follows: …", "Not used.") is the new text, with the old text not quoted (`merged`). An amendment with no schedule is read by the model (prompt `amendment_changes/v1`) when one is available. |
| Clarifications | `tenderset/clarifications.py` | One per row: document, clause, the existing clause, the request, the rationale and the response, with a verdict from the response (`amended`, `unchanged`, `refer`, `answered`) and the changes of the set on the same clause. |
| The RfS amended | `tenderset/consolidate.py` | The RfS is read with `read_tender` as before. Each field found sits in an RfS clause (`clause_index`: "8.1" then "a." gives 8.1.a). A change touches a field when its existing text holds the field's quote, or when it amends the field's clause or a clause that holds it. The field is then read again from the amended text, by the rules reader or, in model mode, by the model (prompt `amended_fields/v1`), and the new quote is located in the amendment. The field keeps a `history` (was, now, change, how it matched) and `changed_by`. A deleted clause withdraws the field. When the amended text gives no value, the field is `needs_review` with an `amended` issue and its old value shown. Identity and summary fields are not amended. |
| Formats | `tenderset/formats.py` | Every "Format 7.x" and "Annexure – X" heading starts a format, which runs to the next. Each format has its pages, heading quote, what it is printed on, when it applies, who provides it, and its blanks (underscores, dots, dashes, "(Insert …)") with label, kind and the bid value that fills it. |
| Process | `tenderset/process.py` | The Bid Information Sheet (the lettered table near the front) and the bid steps (register, fees, EMD, queries, submission, originals, opening, financial opening, e-Reverse Auction, selection, LoA, PBG, PPA), each with the RfS sentences that govern it, quoted and located. A step the RfS never mentions is left out. |
| Search | `tenderset/search.py` | Every page cut into overlapping passages of 120 words, kept in the result, and indexed with Haystack's in-memory BM25 store per job (cached). |

The result: `{kind: "set", documents, rfs, tender, amended_fields, changes, clarifications,
formats, process, search: {engine, passages}, counts, usage, warnings}`. `tender` is
`read_tender`'s result for the RfS with the amendments applied, so it can be used in place of a
single reading. The web app saves it as the tender, with the rest under `tender_set` (without
the passages).

On the SECI RTC-TM-V set (RfS, Amendment-01 and -02, Clarifications-01, Standard PSA), in rules
mode:

* All 51 schedule rows of both amendments are read (17 + 14 RfS, 11 + 6 PPA, 2 + 1 PSA), and
  every quote is located. This includes the 23 changes of the hand-checked pack.
* All 18 numbered clarifications are read, plus a garbled 19th from a "Note" row, with verdicts
  that agree with the pack.
* 11 RfS fields are amended:
  * the least bid goes from 100 to 50 MW (Amendment-01, 5.1);
  * SCSD goes from 18 to 24 months (Amendment-01 9.2.a, then Amendment-02 9.2.a);
  * the peak window goes from 00:00–10:00 to 18:00–10:00 (Amendment-01, 42.41);
  * 6.1 (location) is flagged for review, because the rules cannot re-read it.
* All 20 formats of the pack are found with their exact page ranges, plus 7 later annexures.
* The bid process sources hit 14 of the pack's 17 source pages.
* Timing: 5 s with recorded Docling output, 112 s with docling-serve on CPU (mostly the first
  model load).

## Tests

* `tests/engine/test_extraction.py` covers the following, without network access:
  * schema compilation, with derived sections excluded;
  * the resolver, the rules and the rules reader on real PDFs;
  * model mode against a fake SDK object, including a refusal and a truncated answer, which fail
    with no fallback model;
  * withdrawals;
  * jobs and the API.
* `tests/engine/test_tenderset.py` runs the tender-set pipeline on the SECI set and checks it
  against the pack (`web/src/seci/seci-rtc-tm-v.json`). It covers:
  * the document roles;
  * the changes and clarifications, from the recorded Docling output
    (`tests/engine/fixtures/docling`) and from the PyMuPDF fallback;
  * the amended fields with their history, a withdrawal, and the model re-read and the prose
    amendment against fake SDKs;
  * the formats and the process;
  * Haystack search;
  * the docling-serve and LlamaParse clients on httpx mock transports;
  * the API.
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
* There is no approval workflow or audit of approved values. Those live in tender_engine and were
  not ported. A tender set applies the amendments to the reading, with each field's history, but
  it is still an input the reviewer ticks into the bid, never a stored fact.
* Tender sets have these limits:
  * Amendments are read from their schedule tables. A prose amendment needs the model.
  * An amended field is re-read only for the fields the reading found in the RfS. A new
    provision added by an amendment shows only among the changes.
  * The rules re-read only what the rules read: 6.1 of the SECI set is flagged, not re-read.
  * The LlamaParse client follows LlamaParse's v1 upload, job and result API and is tested
    against a mock; it has not been run against the live service here.
  * The model paths (`amended_fields/v1`, `amendment_changes/v1`) are tested with fake SDKs only.
