"""Shared deal exclusion and headline validation rules."""

from __future__ import annotations

import json
import re
import urllib.parse
from pathlib import Path
from typing import Any

_RULES_PATH = Path(__file__).parent.parent / "shared" / "deal-rules.json"
with _RULES_PATH.open(encoding="utf-8") as rules_file:
    _RULES = json.load(rules_file)

EXCLUSION_PATTERNS = [
    (entry["reason"], re.compile(entry["pattern"], re.IGNORECASE))
    for entry in _RULES["exclusions"]
]
MARKET_RESEARCH_PUBLISHERS = tuple(_RULES["market_research_publishers"])
TRANSACTION_PATTERN = re.compile(_RULES["transaction_pattern"], re.IGNORECASE)
FINANCING_VERB_PATTERN = re.compile(r"\b(?:raises?|raised|secures?|secured)\b", re.IGNORECASE)
FINANCING_SUPPORT_PATTERN = re.compile(
    r"\b(?:raises?|raised|secures?|secured)\s+(?:(?:us|usd)\s*)?\$\s*[\d,.]+"
    r"|\b(?:funding\s+round|series\s+[abc])\b",
    re.IGNORECASE,
)


def publisher_domain(url: str | None) -> str:
    try:
        host = urllib.parse.urlsplit(url or "").hostname or ""
    except ValueError:
        return ""
    return host.lower().removeprefix("www.")


def clean_title(title: str) -> str:
    return re.sub(r"\s+-\s+[^-]{2,100}\s*$", "", (title or "").strip()).strip()


def exclusion_reason(
    title: str,
    domain: str | None = None,
    source: str | None = None,
) -> str | None:
    host = (domain or "").strip().lower().removeprefix("www.")
    source_text = (source or "").casefold()
    if any(
        host == blocked
        or host.endswith(f".{blocked}")
        or blocked in source_text
        for blocked in MARKET_RESEARCH_PUBLISHERS
    ):
        return "market_report"
    headline = clean_title(title)
    for reason, pattern in EXCLUSION_PATTERNS:
        if pattern.search(headline):
            return reason
    return None


def has_transaction_phrase(title: str) -> bool:
    headline = clean_title(title)
    if not TRANSACTION_PATTERN.search(headline):
        return False
    return not FINANCING_VERB_PATTERN.search(headline) or bool(
        FINANCING_SUPPORT_PATTERN.search(headline)
    )


def deal_rejection_reason(
    item: dict[str, Any],
    classified: dict[str, Any] | None,
) -> str | None:
    title = clean_title(str(item.get("title") or ""))
    rejected = exclusion_reason(
        title,
        item.get("publisher_domain"),
        item.get("source"),
    )
    if rejected:
        return rejected
    if not classified or classified.get("is_deal") is not True:
        reason = classified.get("reject_reason") if classified else None
        if reason in {"listicle", "market_report", "opinion", "not_a_transaction"}:
            return reason
        return "not_a_transaction"
    if not classified.get("buyer_name") and not classified.get("target_name"):
        return "not_a_transaction"
    if not has_transaction_phrase(title):
        return "not_a_transaction"
    return None
