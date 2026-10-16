"""Word lists the rule-based reader shares: number words, the number pattern and the issuers of
Indian power tenders. Taken from FDRE `fdre_bess_tender.py` (branch claude/intelligent-carson-mwonct)
so that the reader no longer imports that module; WBSEDCL added."""

from __future__ import annotations

WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "eight": 8, "ten": 10, "twelve": 12,
         "fifteen": 15, "twenty": 20, "eighteen": 18, "twenty four": 24, "twenty-four": 24, "twenty five": 25, "twenty-five": 25}
WORD_NUM = r"(\d+(?:\.\d+)?|one|two|three|four|five|six|eight|ten|twelve|fifteen|eighteen|twenty(?:[- ]four|[- ]five)?)"


def _num(value: str) -> float:
    v = str(value).strip().lower()
    if v in WORDS:
        return float(WORDS[v])
    return float(v.replace(",", ""))


ISSUERS = [
    (r"Solar Energy Corporation of India|\bSECI\b", "Solar Energy Corporation of India Limited (SECI)"),
    (r"NTPC Vidyut Vyapar Nigam|\bNVVN\b", "NTPC Vidyut Vyapar Nigam Limited (NVVN)"),
    (r"\bNTPC\b", "NTPC Limited"),
    (r"\bNHPC\b", "NHPC Limited"),
    (r"\bSJVN\b", "SJVN Limited"),
    (r"NLC India|\bNLCIL\b", "NLC India Limited"),
    (r"West Bengal State Electricity Distribution|\bWBSEDCL\b", "West Bengal State Electricity Distribution Company Limited (WBSEDCL)"),
    (r"Gujarat Urja Vikas Nigam|\bGUVNL\b", "Gujarat Urja Vikas Nigam Limited (GUVNL)"),
    (r"Maharashtra State Electricity Distribution|\bMSEDCL\b", "Maharashtra State Electricity Distribution Co. Ltd (MSEDCL)"),
    (r"Rajasthan Urja Vikas|\bRUVITL\b|\bRUVNL\b", "Rajasthan Urja Vikas and IT Services Ltd"),
    (r"Tamil Nadu Green Energy|\bTNGECL\b", "Tamil Nadu Green Energy Corporation Ltd (TNGECL)"),
    (r"Kerala State Electricity Board|\bKSEB\b", "Kerala State Electricity Board (KSEB)"),
    (r"Power Company of Karnataka|\bPCKL\b", "Power Company of Karnataka Ltd (PCKL)"),
    (r"Andhra Pradesh|\bAPPCC\b|\bNREDCAP\b", "Andhra Pradesh (APPCC / NREDCAP)"),
]
