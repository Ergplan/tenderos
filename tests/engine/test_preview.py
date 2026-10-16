"""The scan screen's preview (engine/extraction/preview.py): every line is the document's own
text on its page, and a read job shows it before the result."""
from __future__ import annotations

import base64
import re
import sys
import threading
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from engine.extraction import jobs  # noqa: E402
from engine.extraction import preview as P  # noqa: E402
from engine.extraction.pages import read_pages  # noqa: E402
from engine.extraction.resolver import PageText  # noqa: E402

RFS = ROOT / "samples" / "tenders" / "nhpc-fdre-ii" / "RfS.pdf"


def _flat(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _page(no: int, text: str) -> PageText:
    return PageText(page_no=no, text=text, char_boxes=None, has_text_layer=True)


@pytest.mark.skipif(not RFS.exists(), reason="NHPC RfS not in samples/")
def test_every_line_is_on_its_page_in_the_nhpc_rfs():
    pages = read_pages("RfS.pdf", RFS.read_bytes())
    flat = {p.page_no: _flat(p.text) for p in pages}
    out = P.build_preview(pages)
    assert out["pages"] == 264 and out["text_pages"] == 264
    assert set(out["agents"]) == {"dates", "eligibility", "constraints", "finance", "risks"}
    for agent, lines in out["agents"].items():
        assert 0 < len(lines) <= P.MAX_LINES, agent
        assert [line["page"] for line in lines] == sorted(line["page"] for line in lines), "document order"
        for line in lines:
            assert line["text"] in flat[line["page"]], (agent, line)
            assert len(line["text"]) <= P.LINE_CHARS
            assert line["hits"] and all(0 <= s < e <= len(line["text"]) for s, e in line["hits"])
    dates = " ".join(line["text"] for line in out["agents"]["dates"])
    assert re.search(r"\d{2}\.\d{2}\.\d{4}", dates), "dates as the RfS prints them"


def test_hits_mark_the_matched_phrases_and_long_lines_are_cut_at_words():
    body = "The Bidder shall furnish an Earnest Money Deposit of INR 9,28,000 per MW " + "word " * 60 + "before the bid submission."
    out = P.build_preview([_page(3, body)])
    line = out["agents"]["finance"][0]
    assert line["page"] == 3 and len(line["text"]) <= P.LINE_CHARS
    assert _flat(body).find(line["text"]) >= 0
    phrases = {line["text"][s:e].lower() for s, e in line["hits"]}
    assert "earnest money" in phrases
    assert not line["text"].startswith(" ") and not line["text"].endswith(" ")


def test_an_agent_with_nothing_to_find_gets_an_empty_list():
    out = P.build_preview([_page(1, "This short note talks about the weather and nothing else at all.")])
    assert all(lines == [] for lines in out["agents"].values())


def test_headings_rank_below_body_text():
    heading = "3.27 FINANCIAL CLOSURE OR PROJECT FINANCING ARRANGEMENTS AND THE PPA"
    body = "The Project shall achieve Financial Closure within 12 months from the Effective Date of the PPA."
    out = P.build_preview([_page(4, heading), _page(9, body)], max_lines=1)
    assert out["agents"]["dates"][0]["text"] == body


def test_text_uploads_have_a_preview():
    text = b"Last date of bid submission is 12.04.2024. The net worth shall be INR 1.3 crore per MW.\n"
    out = P.build_preview(read_pages("notes.txt", text))
    assert out["agents"]["dates"] and out["agents"]["eligibility"]


def test_a_read_job_shows_the_preview_before_the_result(monkeypatch, tmp_path):
    monkeypatch.setenv("EXTRACTION_JOBS_DIR", str(tmp_path))
    release = threading.Event()

    def slow_read(*args, **kwargs):
        release.wait(10)
        return {"engine": "test", "values": {}}

    monkeypatch.setattr(jobs, "read_tender", slow_read)
    from fastapi.testclient import TestClient

    from engine.app import app

    client = TestClient(app)
    payload = b"Last date of bid submission is 12.04.2024. Penalty for shortfall shall be 1.5 times the tariff.\n"
    started = client.post("/api/bid/tender/read", json={"file": {"name": "t.txt", "content_base64": base64.b64encode(payload).decode()}, "mode": "rules"})
    assert started.status_code == 202, started.text
    job_id = started.json()["job_id"]
    seen = None
    for _ in range(100):
        seen = client.get(f"/api/bid/tender/read/{job_id}").json()
        if seen.get("preview"):
            break
        time.sleep(0.05)
    assert seen["preview"]["agents"]["dates"][0]["page"] == 1
    assert seen["result"] is None and seen["status"] == "running"
    release.set()
    for _ in range(100):
        seen = client.get(f"/api/bid/tender/read/{job_id}").json()
        if seen["status"] == "done":
            break
        time.sleep(0.05)
    assert seen["status"] == "done" and seen["result"] == {"engine": "test", "values": {}}
