"""Build weekly snapshots for the configured sector and market universe."""

from __future__ import annotations

import json
import logging
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from .deal_pipeline import _fetch_rows, parse_datetime

log = logging.getLogger(__name__)
UNIVERSE_PATH = Path(__file__).with_name("theme_universe.json")


def load_theme_universe(sectors: list[str], path: Path = UNIVERSE_PATH) -> list[dict[str, Any]]:
    with path.open(encoding="utf-8") as config_file:
        config = json.load(config_file)

    themes = [
        {"sector": sector, "country": country["code"]}
        for sector in sectors
        for country in config["countries"]
    ]
    if config.get("include_sector_global", False):
        themes.extend({"sector": sector, "country": None} for sector in sectors)
    themes.extend(
        {"sector": sector, "country": region}
        for sector in sectors
        for region in config["regions"]
    )
    return themes


def _matches_market(countries: list[str], market: str | None, regions: dict[str, list[str]]) -> bool:
    if market is None:
        return True
    if market in regions:
        return market in countries or any(member in countries for member in regions[market])
    return market in countries


def build_theme_snapshots(
    deal_items: list[dict[str, Any]],
    mentions: list[dict[str, Any]],
    coverage_rows: list[dict[str, Any]],
    sectors: list[str],
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    now = now or datetime.now(timezone.utc)
    as_of = now.date()
    cutoff_90 = now - timedelta(days=90)
    cutoff_180 = now - timedelta(days=180)
    with UNIVERSE_PATH.open(encoding="utf-8") as config_file:
        regions = json.load(config_file)["regions"]

    coverage_by_country = {
        row["country_code"]: row
        for row in coverage_rows
        if row.get("country_code")
    }
    snapshots = []
    for theme in load_theme_universe(sectors):
        sector = theme["sector"]
        country = theme["country"]
        current_clusters: set[str] = set()
        prior_clusters: set[str] = set()
        for item in deal_items:
            if item.get("is_deal") is False:
                continue
            item_date = parse_datetime(item.get("published_at"))
            if not item_date or item_date < cutoff_180 or item_date > now:
                continue
            if sector not in (item.get("sectors") or []):
                continue
            if not _matches_market(item.get("countries") or [], country, regions):
                continue
            cluster_id = str(item.get("cluster_id") or "")
            if not cluster_id:
                continue
            if item_date >= cutoff_90:
                current_clusters.add(cluster_id)
            else:
                prior_clusters.add(cluster_id)

        story_titles: set[str] = set()
        publisher_domains: set[str] = set()
        for mention in mentions:
            item_date = parse_datetime(mention.get("published_at"))
            if not item_date or item_date < cutoff_90 or item_date > now:
                continue
            if sector not in (mention.get("sectors") or []):
                continue
            if not _matches_market(mention.get("countries") or [], country, regions):
                continue
            normalized_title = str(mention.get("normalized_title") or "").strip()
            if normalized_title:
                story_titles.add(normalized_title)
            domain = str(mention.get("publisher_domain") or "").lower().removeprefix("www.")
            if domain:
                publisher_domains.add(domain)

        deals_90d = len(current_clusters)
        mentions_90d = len(story_titles)
        if deals_90d < 3 and mentions_90d < 3:
            continue

        coverage = coverage_by_country.get(country, {}) if country else {}
        snapshots.append({
            "as_of": as_of.isoformat(),
            "sector": sector,
            "country": country,
            "deals_90d": deals_90d,
            "deals_prior_90d": len(prior_clusters),
            "mentions_90d": mentions_90d,
            "publishers_90d": len(publisher_domains),
            "country_coverage_items": int(coverage.get("deal_item_count") or 0),
            "country_coverage_publishers": int(coverage.get("publisher_domain_count") or 0),
        })
    return snapshots


def create_weekly_snapshots(client: Any, sectors: list[str], now: datetime | None = None) -> list[dict[str, Any]]:
    now = now or datetime.now(timezone.utc)
    deal_items = _fetch_rows(
        client,
        "deal_items",
        "cluster_id,published_at,sectors,countries,is_deal",
        now - timedelta(days=180),
    )
    mentions = _fetch_rows(
        client,
        "mentions",
        "normalized_title,publisher_domain,published_at,sectors,countries",
        now - timedelta(days=90),
    )
    coverage = _fetch_rows(client, "market_coverage", "country_code,deal_item_count,publisher_domain_count,coverage_level")
    snapshots = build_theme_snapshots(deal_items, mentions, coverage, sectors, now)
    if snapshots:
        client.table("theme_snapshots").upsert(
            snapshots,
            on_conflict="as_of,sector,country_key",
        ).execute()
    log.info("Qualified themes: %d; as_of=%s", len(snapshots), now.date().isoformat())
    return snapshots


def main() -> None:
    from . import trend_scanner

    configured_sectors = list(trend_scanner.SECTOR_KEYWORDS)
    snapshots = create_weekly_snapshots(trend_scanner.supabase, configured_sectors)
    print(f"Qualified themes: {len(snapshots)}")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    main()
