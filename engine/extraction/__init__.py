"""Tender extraction: read an Indian power tender into typed, evidence-backed fields.

The extraction engine of Ergplan/tender_engine (commit 5c29b4e) as a stateless package: the
domain packs (YAML schemas and versioned prompts, schema v4 with the RE-RTC type), value
types, the evidence resolver, the section map and per-section extraction with the
withdrawal rule, and the deterministic validation rules. The first stateless port was made
in FDRE (`tender_intel/`, from tender_engine bd4959c); this package carries it forward.
Without a model (no ANTHROPIC_API_KEY, or a DOCX/text upload) a rules reader fills the
headline fields, each with a verbatim quote. See docs/EXTRACTION.md.
"""

from engine.extraction.extract import MODES, detect_tender_type, read_tender
from engine.extraction.llm import llm_available
from engine.extraction.schema import TENDER_TYPES, catalog, compile_type

__all__ = [
    "MODES",
    "TENDER_TYPES",
    "catalog",
    "compile_type",
    "detect_tender_type",
    "llm_available",
    "read_tender",
]
