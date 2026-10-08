"""Collect and count non-deal news articles for tracked sector-country pairs."""

from __future__ import annotations

import json
import logging
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import Any, Callable

if __package__:
    from .deal_pipeline import (
        COUNTRY_ALIASES,
        REGION_ALIASES,
        _fetch_rows,
        classify_countries,
        classify_sub_themes,
        clean_title,
        has_deal_keyword,
        keyword_matches,
        normalize_title,
        parse_datetime,
    )
else:
    from deal_pipeline import (
        COUNTRY_ALIASES,
        REGION_ALIASES,
        _fetch_rows,
        classify_countries,
        classify_sub_themes,
        clean_title,
        has_deal_keyword,
        keyword_matches,
        normalize_title,
        parse_datetime,
    )

log = logging.getLogger(__name__)

def normalize_url(url: str) -> str:
    parsed = urllib.parse.urlsplit(url.strip())
    tracking = {"fbclid", "gclid", "mc_cid", "mc_eid"}
    query = urllib.parse.urlencode(sorted(
        (key, value)
        for key, value in urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
        if not key.lower().startswith("utm_") and key.lower() not in tracking
    ))
    return urllib.parse.urlunsplit((
        parsed.scheme.lower(),
        parsed.netloc.lower().removeprefix("www."),
        parsed.path.rstrip("/"),
        query,
        "",
    ))


COUNTRY_QUERY_NAMES: dict[str, str] = {}
for _country_name, _country_code in COUNTRY_ALIASES.items():
    COUNTRY_QUERY_NAMES.setdefault(_country_code, _country_name)
for _region_name, _region_code in REGION_ALIASES.items():
    COUNTRY_QUERY_NAMES.setdefault(_region_code, _region_name)


def _country_tag(country: str) -> str:
    normalized = country.strip()
    if re.fullmatch(r"[A-Za-z]{2}", normalized):
        return normalized.upper()
    if normalized.upper() in REGION_ALIASES:
        return REGION_ALIASES[normalized.upper()]
    tags = classify_countries(normalized)
    if tags:
        return next((tag for tag in tags if len(tag) == 2), tags[0])
    raise ValueError(f"Unsupported country or region: {country}")


def coverage_level(publisher_count: int) -> str:
    """Coverage levels use distinct publishers: low <3, medium 3-9, high >=10."""
    if publisher_count < 3:
        return "low"
    if publisher_count < 10:
        return "medium"
    return "high"


def prepare_mention_items(
    items: list[dict[str, Any]],
    sector: str,
    country: str,
    sector_keywords: dict[str, list[str]],
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    """Keep dated, in-window, non-deal headlines matching the requested tags."""
    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(days=90)
    country_tag = _country_tag(country)
    prepared: dict[str, dict[str, Any]] = {}
    for item in items:
        title = clean_title(str(item.get("title") or ""))
        url = normalize_url(str(item.get("url") or ""))
        if not title or not url or has_deal_keyword(title):
            continue

        published_at = parse_datetime(item.get("published_at") or item.get("date"))
        if not published_at or published_at < cutoff or published_at > now:
            continue

        sectors = list(item.get("sectors") or [
            name for name, keywords in sector_keywords.items()
            if any(keyword_matches(title, keyword) for keyword in keywords)
        ])
        if not sectors:
            continue
        countries = classify_countries(title)
        if sector not in sectors or country_tag not in countries:
            continue

        normalized_title = normalize_title(title)
        if not normalized_title:
            continue
        prepared[url] = {
            "url": url,
            "title": title,
            "normalized_title": normalized_title,
            "publisher_domain": str(item.get("publisher_domain") or "").lower().removeprefix("www."),
            "published_at": published_at.isoformat(),
            "countries": countries,
            "sectors": sectors,
            "sub_themes": classify_sub_themes(title, sectors, sector_keywords),
        }
    return list(prepared.values())


def persist_mentions(
    client: Any,
    items: list[dict[str, Any]],
    now: datetime | None = None,
    sector_keywords: dict[str, list[str]] | None = None,
) -> int:
    if not items:
        return 0
    now = now or datetime.now(timezone.utc)
    rows: dict[str, dict[str, Any]] = {}
    for item in items:
        if not item.get("url") or not item.get("title") or has_deal_keyword(str(item["title"])):
            continue
        title = clean_title(str(item["title"]))
        published_at = parse_datetime(item.get("published_at") or item.get("date"))
        countries = list(item.get("countries") or classify_countries(title))
        sectors = list(item.get("sectors") or [
            name for name, keywords in sector_keywords.items()
            if any(keyword_matches(title, keyword) for keyword in keywords)
        ]) if sector_keywords is not None else list(item.get("sectors") or [])
        if not sectors:
            continue
        if not countries or sector_keywords is not None:
            sub_themes = classify_sub_themes(title, sectors, sector_keywords or {})
        else:
            sub_themes = list(item.get("sub_themes") or [])
        url = normalize_url(str(item["url"]))
        if not url:
            continue
        rows[url] = {
            "url": url,
            "title": title,
            "normalized_title": normalize_title(title),
            "publisher_domain": str(item.get("publisher_domain") or "").lower().removeprefix("www.") or None,
            "published_at": published_at.isoformat() if published_at else None,
            "countries": countries,
            "sectors": sectors,
            "sub_themes": sub_themes,
        }
    if not rows:
        return 0
    client.table("mentions").upsert(list(rows.values()), on_conflict="url").execute()
    return len(rows)


def compute_mentions_90d(
    items: list[dict[str, Any]],
    sector: str,
    country: str,
    now: datetime | None = None,
    coverage: dict[str, Any] | None = None,
) -> dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(days=90)
    country_tag = _country_tag(country)
    stories: set[str] = set()
    publishers: set[str] = set()
    for item in items:
        published_at = parse_datetime(item.get("published_at"))
        title = clean_title(str(item.get("title") or ""))
        if (
            not published_at
            or published_at < cutoff
            or published_at > now
            or has_deal_keyword(title)
            or sector not in (item.get("sectors") or [])
            or country_tag not in (item.get("countries") or [])
        ):
            continue
        normalized_title = str(item.get("normalized_title") or normalize_title(title))
        if normalized_title:
            stories.add(normalized_title)
        domain = str(item.get("publisher_domain") or "").lower().removeprefix("www.")
        if domain:
            publishers.add(domain)

    coverage = coverage or {}
    coverage_publishers = int(coverage.get("publisher_domain_count") or 0)
    coverage_articles = int(coverage.get("deal_item_count") or 0)
    return {
        "mentions_90d": len(stories),
        "publishers_90d": len(publishers),
        "country_coverage_level": coverage.get("coverage_level") or coverage_level(coverage_publishers),
        "country_coverage_articles": coverage_articles,
        "country_coverage_publishers": coverage_publishers,
    }


def mentions_90d(client: Any, sector: str, country: str) -> dict[str, Any]:
    """Call the Supabase mentions_90d(sector, country) RPC."""
    response = client.rpc(
        "mentions_90d",
        {"p_sector": sector, "p_country": _country_tag(country)},
    ).execute()
    result = response.data or []
    if isinstance(result, list):
        return dict(result[0]) if result else {
            "mentions_90d": 0,
            "publishers_90d": 0,
            "country_coverage_level": "low",
            "country_coverage_articles": 0,
            "country_coverage_publishers": 0,
        }
    return dict(result)


def _parse_serper_date(value: str, now: datetime) -> datetime | None:
    value = value.strip()
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parse_datetime(parsed)
    except ValueError:
        pass
    try:
        return parse_datetime(parsedate_to_datetime(value))
    except (TypeError, ValueError, OverflowError):
        pass
    relative = re.search(r"(\d+)\s+(minute|hour|day|week|month)s?\s+ago", value, re.IGNORECASE)
    if not relative:
        return None
    count = int(relative.group(1))
    unit = relative.group(2).lower()
    days = {
        "minute": 1 / 1440,
        "hour": 1 / 24,
        "day": 1,
        "week": 7,
        "month": 30,
    }[unit]
    return now - timedelta(days=count * days)


def fetch_serper_news(query: str, api_key: str, now: datetime | None = None) -> list[dict[str, Any]]:
    now = now or datetime.now(timezone.utc)
    request = urllib.request.Request(
        "https://google.serper.dev/news",
        data=json.dumps({"q": query, "tbs": "qdr:m3", "num": 20}).encode("utf-8"),
        headers={"X-API-KEY": api_key, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            payload = json.loads(response.read())
    except (OSError, urllib.error.URLError, ValueError) as error:
        log.warning("Serper news query failed for %r: %s", query, error)
        return []

    items = []
    for result in payload.get("news", []):
        link = str(result.get("link") or "").strip()
        title = clean_title(str(result.get("title") or ""))
        if not link or not title:
            continue
        host = urllib.parse.urlsplit(link).hostname or ""
        items.append({
            "url": normalize_url(link),
            "title": title,
            "publisher_domain": host.lower().removeprefix("www."),
            "date": _parse_serper_date(str(result.get("date") or ""), now),
            "publisher": result.get("source") or "",
        })
    return items


def collect_mention_items(
    client: Any,
    now: datetime,
    sector_keywords: dict[str, list[str]],
    feed_fetcher: Callable[..., list[dict[str, Any]]],
    serper_api_key: str | None = None,
) -> list[dict[str, Any]]:
    """Fetch tracked sector-country pairs from free RSS and optional Serper News."""
    tracked = _fetch_rows(
        client,
        "deal_items",
        "sectors,countries",
        now - timedelta(days=366),
    )
    pairs = {
        (sector, country)
        for row in tracked
        for sector in row.get("sectors") or []
        for country in row.get("countries") or []
        if country in COUNTRY_QUERY_NAMES
    }
    if not pairs:
        log.info("No tracked sector-country pairs available for mention collection.")
        return []
    if not serper_api_key:
        log.info("SERPER_API_KEY not configured; mention collection will use Google News RSS only.")

    candidates: dict[str, dict[str, Any]] = {}
    for sector, country in sorted(pairs):
        query = f"{sector} {COUNTRY_QUERY_NAMES[country]}"
        google_query = f"{query} when:90d"
        google_url = (
            "https://news.google.com/rss/search?q="
            f"{urllib.parse.quote(google_query)}&hl=en-US&gl=US&ceid=US:en"
        )
        results = feed_fetcher(google_url, feed_role="narrative_source")
        if serper_api_key:
            results.extend(fetch_serper_news(query, serper_api_key, now))
        for item in prepare_mention_items(results, sector, country, sector_keywords, now):
            candidates[item["url"]] = item
    return list(candidates.values())
