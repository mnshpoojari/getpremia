"""Recompute headline-derived country and sub-theme tags for deal_items."""

from __future__ import annotations

import argparse
import logging

if __package__:
    from . import trend_scanner as scanner
    from .deal_pipeline import _fetch_rows, tag_deal_item
else:
    import trend_scanner as scanner
    from deal_pipeline import _fetch_rows, tag_deal_item


def tag_existing_rows(rows: list[dict]) -> tuple[list[dict], int]:
    updates = []
    untagged_count = 0
    for row in rows:
        title = str(row.get("title") or "")
        sectors = row.get("sectors") or scanner.classify_sectors(title)
        tagged = tag_deal_item(
            {**row, "title": title, "sectors": sectors},
            scanner.SECTOR_KEYWORDS,
        )
        countries = tagged["countries"]
        sub_themes = tagged["sub_themes"]
        if not countries and not sub_themes:
            untagged_count += 1
        if sorted(row.get("countries") or []) != countries or sorted(row.get("sub_themes") or []) != sub_themes:
            updates.append({
                "id": row["id"],
                "countries": countries,
                "sub_themes": sub_themes,
            })
    return updates, untagged_count


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="write the recalculated tags (default only reports the proposed changes)",
    )
    args = parser.parse_args()

    rows = _fetch_rows(scanner.supabase, "deal_items", "id,title,sectors,countries,sub_themes")
    updates, untagged_count = tag_existing_rows(rows)
    logging.info("deal_items rows scanned: %d", len(rows))
    logging.info("Rows whose tags will change: %d", len(updates))
    logging.info("Rows with neither a country nor a sub-theme after tagging: %d", untagged_count)
    if not args.apply:
        logging.info("Dry run: no database rows were changed. Re-run with --apply to save tags.")
        return

    for row in updates:
        scanner.supabase.table("deal_items").update({
            "countries": row["countries"],
            "sub_themes": row["sub_themes"],
        }).eq("id", row["id"]).execute()
    logging.info("Updated tags for %d deal_items rows.", len(updates))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    main()
