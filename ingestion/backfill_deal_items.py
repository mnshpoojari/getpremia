"""One-time, manually run 12-month Google News backfill for deal_items."""

from __future__ import annotations

import argparse
import logging
from datetime import datetime, timezone
from urllib.parse import quote

if __package__:
    from . import trend_scanner as scanner
    from .deal_pipeline import _fetch_rows, persist_deal_items, refresh_sector_trends
else:
    import trend_scanner as scanner
    from deal_pipeline import _fetch_rows, persist_deal_items, refresh_sector_trends


def month_slices(now: datetime, months: int = 12) -> list[tuple[datetime, datetime]]:
    """Return calendar-month Google News date windows, oldest first."""
    current_index = now.year * 12 + now.month - 1
    windows = []
    for offset in range(months - 1, -1, -1):
        year, month_zero = divmod(current_index - offset, 12)
        start = datetime(year, month_zero + 1, 1, tzinfo=timezone.utc)
        if month_zero == 11:
            end = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
        else:
            end = datetime(year, month_zero + 2, 1, tzinfo=timezone.utc)
        if end > now:
            end = now
        windows.append((start, end))
    return windows


def build_query(query: str, start: datetime, end: datetime) -> str:
    rolling_query = query.replace("when:90d", "").strip()
    return f"{rolling_query} after:{start:%Y-%m-%d} before:{end:%Y-%m-%d}"


def collect_backfill_items(now: datetime, months: int = 12) -> list[dict]:
    items_by_url: dict[str, dict] = {}
    for start, end in month_slices(now, months):
        for query in scanner.TIER_3_QUERIES:
            dated_query = build_query(query, start, end)
            rss_url = (
                "https://news.google.com/rss/search?q="
                f"{quote(dated_query)}&hl=en-US&gl=US&ceid=US:en"
            )
            for item in scanner.dedupe_items(scanner.fetch_feed(rss_url)):
                sectors = scanner.classify_sectors(item["title"])
                if not sectors:
                    continue
                item["sectors"] = sectors
                tagged = scanner.tag_deal_item(item, scanner.SECTOR_KEYWORDS)
                items_by_url[item["url"]] = tagged
    return list(items_by_url.values())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="fetch and report candidates without database reads/writes")
    parser.add_argument("--months", type=int, default=12, help="calendar months to backfill (default: 12)")
    args = parser.parse_args()
    if args.months < 1 or args.months > 12:
        parser.error("--months must be between 1 and 12")

    now = datetime.now(timezone.utc)
    logging.info("Fetching Google News backfill candidates for %d calendar months", args.months)
    items = collect_backfill_items(now, args.months)
    logging.info("Candidate article URLs to upsert: %d", len(items))
    for item in items:
        published = item.get("date")
        published_label = published.isoformat() if published else f"estimated at first-seen ({now.isoformat()})"
        logging.info(
            "  %s | %s | %s | %s | %s | %s",
            published_label,
            item.get("publisher", "Unknown"),
            item["title"],
            item["url"],
            ", ".join(item.get("sectors", [])),
            "estimated" if not published else "published",
        )
    if args.dry_run:
        logging.info("Dry run: no Supabase reads or writes were performed.")
        return

    item_count = persist_deal_items(scanner.supabase, items, now, scanner.SECTOR_KEYWORDS)
    trends = refresh_sector_trends(scanner.supabase, now)
    current_month_index = now.year * 12 + now.month - 1
    cutoff_year, cutoff_month_zero = divmod(current_month_index - args.months + 1, 12)
    cutoff = datetime(cutoff_year, cutoff_month_zero + 1, 1, tzinfo=timezone.utc)
    item_rows = _fetch_rows(
        scanner.supabase,
        "deal_items",
        "id",
        cutoff,
    )
    deal_rows = _fetch_rows(
        scanner.supabase,
        "deals",
        "id",
        cutoff,
    )
    logging.info("Upserted %d item records and refreshed %d sector aggregates.", item_count, len(trends))
    logging.info("Stored rows in queried backfill window: deal_items=%d, deals=%d", len(item_rows), len(deal_rows))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    main()
