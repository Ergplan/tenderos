"""Full-text search over every page of a tender set, with Haystack (BM25, in memory).

Each page is cut into passages of about PASSAGE_WORDS words (overlapping by OVERLAP words,
so a sentence on a boundary is in one passage whole); a passage keeps its document id,
title, role and page. The passages are stored in the set's result (`search.passages`), so
any engine worker can rebuild the index for a job; the built indexes are cached per job.
A hit returns the passage, the document and page, and the BM25 score.
"""

from __future__ import annotations

import threading
from collections import OrderedDict
from typing import Any

from engine.extraction.resolver import PageText

PASSAGE_WORDS = 120
OVERLAP = 30
CACHE_SIZE = 8
ENGINE = "haystack-bm25"

_cache: OrderedDict[str, Any] = OrderedDict()
_cache_lock = threading.Lock()


def passages(doc: dict[str, Any], pages: list[PageText]) -> list[dict[str, Any]]:
    """The passages of one document: {doc, title, role, page, text}."""
    out: list[dict[str, Any]] = []
    step = PASSAGE_WORDS - OVERLAP
    for page in pages:
        words = page.text.split()
        if not words:
            continue
        for start in range(0, max(len(words) - OVERLAP, 1), step):
            text = " ".join(words[start : start + PASSAGE_WORDS])
            out.append({"doc": doc["id"], "title": doc["title"], "role": doc["role"], "page": page.page_no, "text": text})
    return out


def _store(items: list[dict[str, Any]]) -> Any:
    from haystack import Document
    from haystack.document_stores.in_memory import InMemoryDocumentStore

    store = InMemoryDocumentStore(bm25_algorithm="BM25Plus")
    store.write_documents(
        [
            Document(content=item["text"], meta={"doc": item["doc"], "title": item["title"], "role": item["role"], "page": item["page"]})
            for item in items
        ]
    )
    return store


def index_for(key: str, items: list[dict[str, Any]]) -> Any:
    """The document store for a job's passages, built once per key."""
    with _cache_lock:
        if key in _cache:
            _cache.move_to_end(key)
            return _cache[key]
    store = _store(items)
    with _cache_lock:
        _cache[key] = store
        while len(_cache) > CACHE_SIZE:
            _cache.popitem(last=False)
    return store


def search(key: str, items: list[dict[str, Any]], query: str, top_k: int = 10, role: str | None = None, doc: str | None = None) -> list[dict[str, Any]]:
    """The best passages for a query, optionally within one role or one document."""
    from haystack.components.retrievers.in_memory import InMemoryBM25Retriever

    query = " ".join(query.split())
    if not query or not items:
        return []
    store = index_for(key, items)
    filters = None
    conditions = []
    if role:
        conditions.append({"field": "meta.role", "operator": "==", "value": role})
    if doc:
        conditions.append({"field": "meta.doc", "operator": "==", "value": doc})
    if len(conditions) == 1:
        filters = conditions[0]
    elif conditions:
        filters = {"operator": "AND", "conditions": conditions}
    retriever = InMemoryBM25Retriever(document_store=store, top_k=max(1, min(int(top_k), 50)))
    found = retriever.run(query=query, filters=filters)["documents"]
    return [
        {
            "doc": item.meta.get("doc"),
            "title": item.meta.get("title"),
            "role": item.meta.get("role"),
            "page": item.meta.get("page"),
            "text": item.content,
            "score": round(float(item.score or 0.0), 3),
        }
        for item in found
    ]


def clear() -> None:
    with _cache_lock:
        _cache.clear()
