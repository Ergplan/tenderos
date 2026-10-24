"""A tender set: the RfS read with its amendments, clarifications and agreements.

documents.py   what each file is (RfS, amendment, clarification, PPA, PSA), its number and date
layout.py      tables of a document (Docling via docling-serve, or PyMuPDF's table finder)
docling.py     the docling-serve client
llamaparse.py  text for scanned pages (LlamaParse, optional)
changes.py     amendment schedules -> changes (clause, was, now, quotes, effect)
clarifications.py  query/response schedules -> clarifications with a verdict
consolidate.py the RfS fields with the amendments applied, and their history
formats.py     the bid formats (Section 7, annexures) with their blanks
process.py     the bid process: Bid Information Sheet dates and the steps, with quotes
search.py      Haystack BM25 full-text search over every page of the set
read_set.py    the orchestrator: read_set(files) -> one result
"""
