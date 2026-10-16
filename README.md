# TenderOS

TenderOS is a workspace for bidding Indian renewable power tenders. You upload a tender, and it
reads what the tender requires, each item with its page and quote. You then enter the sources you
have and their costs. HiGHS sizes the least-tariff plant that meets every tender condition, and the
app produces the bid's financial model as an Excel workbook, whose Live model tab is the whole
model as Excel formulas (change an input and the returns follow).

* The interface is the jouleWise design (renamed TenderOS) from `Ergplan/FDRE` branch `claude/intelligent-carson-mwonct`.
* The tender reading is the extraction engine of `Ergplan/tender_engine` (main, `5c29b4e`), with the
  extraction model `claude-fable-5-1`.

| Tab | |
| --- | --- |
| **Tender to Bid** | Start by uploading any tender (read on a scan screen where five agents work through its text) or with the prefilled simulation. Then the tender, its key dates, the bid capacity, the supply sources, the HiGHS sizing with the tender conditions and a 15-minute dispatch, then the financials and the Excel model (`docs/TENDER_TO_BID.md`) |
| Round the clock | RTC / FDRE sizing and finance from your own inputs, with the same Excel workbook and Live model tab |
| BESS tender | Standalone battery tenders |
| CfD bid | SECI CfD-I strike price (`docs/CFD.md`) |

Further reading: `docs/ARCHITECTURE.md` (the parts and the data flow) and `docs/EXTRACTION.md` (the
tender reader). `docs/E2E-NHPC.md` reports one tender run end to end: the NHPC FDRE-II RfS, 1,200 MW
and 264 pages, from upload to the Excel model.

## Run with Docker Compose

```
cp .env.example .env        # set POSTGRES_PASSWORD and SESSION_SECRET; ANTHROPIC_API_KEY optional
docker compose up -d --build
```

Open `http://<host>:3000`. On a fresh database, the first visit asks you to create the
administrator. Without `ANTHROPIC_API_KEY`, tenders are read by the rule-based reader, which reads
the headline fields only; the Tender step says which reader was used. Behind HTTPS, set
`COOKIE_SECURE=true`.

## Deploy a demo VM

`docs/DEPLOY.md`: one script creates a Google Cloud VM with HTTPS (Caddy and Let's Encrypt), a
generated administrator password, firewall rules, backups and updates.

## Run locally

You need Python 3.12, Node 22 and a Postgres database.

```
make install                # .venv with the engine and test requirements; web/node_modules
make build                  # next build
export DATABASE_URL=postgres://user:pass@127.0.0.1:5432/tenderos SESSION_SECRET=$(openssl rand -hex 32)
make dev                    # engine on :8000, web on :3000; `make stop` stops both
```

## Tests

```
make test                   # engine tests and the NHPC reading end to end (sizing tests take ~9 min)
make check-web              # browser-side models in node
JOULEWISE_URL=http://127.0.0.1:3000 JOULEWISE_EMAIL=… JOULEWISE_PASSWORD=… make e2e
                            # NHPC RfS in the browser: upload, size, conditions, Excel
```

## Status

The NHPC end-to-end runs pass in rules mode, both against local processes and against the compose
stack (see `docs/E2E-NHPC.md`).

The model reader has not been run against a real tender in this repository, because no API key was
available. Its tests use a fake SDK. Run one tender with a key, and compare the reading with
`samples/tenders/nhpc-fdre-ii/reviewed-reading.yaml`, before relying on it.

The app has sign-in, users and per-user tab access. It does not store approved tender values,
corrigendum versions or an audit trail of them; that review workflow is tender_engine's.
