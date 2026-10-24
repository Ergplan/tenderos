"""The PDF writer behind the SECI bid letters (engine/documents/pdf.py, /api/bid/document/pdf)."""

from __future__ import annotations

import pymupdf
import pytest
from fastapi.testclient import TestClient

from engine.app import app
from engine.documents.pdf import MAX_PARTS, html_to_pdf

CSS = "body{font-family:serif;font-size:10.5pt} table{border-collapse:collapse} td{border:1px solid #777}"


def _pages(data: bytes) -> list[str]:
    with pymupdf.open("pdf", data) as doc:
        return [page.get_text() for page in doc]


def test_each_part_starts_a_new_page() -> None:
    parts = ["<p>Format 7.1 covering letter</p>", "<p>Format 7.2 consortium</p><table><tr><td>Rs. 1</td></tr></table>"]
    pages = _pages(html_to_pdf(parts, CSS, "Bid letters"))
    assert len(pages) == 2
    assert "7.1" in pages[0] and "7.2" not in pages[0]
    assert "7.2" in pages[1]


def test_long_part_flows_onto_more_pages_and_rupee_is_written() -> None:
    para = "<p>" + "We undertake to comply with the RfS. " * 60 + "</p>"
    pages = _pages(html_to_pdf(["<p>EMD of ₹ 1,23,000</p>" + para * 6], CSS))
    assert len(pages) >= 2
    assert "Rs. 1,23,000" in pages[0]


def test_struck_text_and_tables_are_kept_as_text() -> None:
    text = _pages(html_to_pdf(["<p><s>Not applicable</s> Applicable</p><table><tr><th>Name</th><td>Arkaja</td></tr></table>"]))[0]
    assert "Not applicable" in text and "Arkaja" in text


def test_images_and_scripts_are_not_loaded() -> None:
    text = _pages(html_to_pdf(['<p>Letter</p><img src="file:///etc/passwd"><script>secret()</script>']))[0]
    assert "Letter" in text and "root:" not in text and "secret" not in text


def test_limits() -> None:
    with pytest.raises(ValueError):
        html_to_pdf([])
    with pytest.raises(ValueError):
        html_to_pdf(["<p>x</p>"] * (MAX_PARTS + 1))


def test_endpoint() -> None:
    client = TestClient(app)
    res = client.post("/api/bid/document/pdf", json={"title": "SECI RTC TM V Bid letters", "css": CSS, "parts": ["<p>One</p>", "<p>Two</p>"]})
    assert res.status_code == 200
    assert res.headers["content-type"] == "application/pdf"
    assert 'filename="SECI_RTC_TM_V_Bid_letters.pdf"' in res.headers["content-disposition"]
    assert len(_pages(res.content)) == 2
    assert client.post("/api/bid/document/pdf", json={"parts": []}).status_code == 400
