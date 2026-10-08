"""Print a dry-run classification review and SQL for existing non-deal rows."""

from __future__ import annotations

import argparse
import logging
from collections import defaultdict
from typing import Any

if __package__:
    from . import trend_scanner as scanner
    from .deal_pipeline import _fetch_rows, classify_deal_headline
else:
    import trend_scanner as scanner
    from deal_pipeline import _fetch_rows, classify_deal_headline


def plan_reclassification(rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[str]]:
    candidates = []
    cluster_reasons: dict[str, list[str]] = defaultdict(list)
    cluster_has_valid_deal: dict[str, bool] = defaultdict(bool)

    for row in rows:
        cluster_id = str(row.get("cluster_id") or "")
        is_deal, reason = classify_deal_headline(
            str(row.get("title") or ""),
            row.get("publisher_domain"),
        )
        if cluster_id:
            cluster_reasons[cluster_id].append(reason or "")
            cluster_has_valid_deal[cluster_id] |= is_deal
        if row.get("is_deal", True) and not is_deal:
            candidates.append({**row, "new_reason": reason})

    invalid_clusters = sorted(
        cluster_id
        for cluster_id in cluster_reasons
        if cluster_id and not cluster_has_valid_deal[cluster_id]
    )
    return candidates, invalid_clusters


def _sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def render_review_sql(candidates: list[dict[str, Any]], invalid_clusters: list[str]) -> str:
    statements = ["BEGIN;"]
    for row in candidates:
        statements.append(
            "UPDATE deal_items "
            f"SET is_deal = FALSE, deal_classification_reason = {_sql_literal(row['new_reason'])} "
            f"WHERE id = {_sql_literal(str(row['id']))}::uuid AND is_deal IS TRUE;"
        )
    if invalid_clusters:
        cluster_values = ", ".join(
            f"{_sql_literal(cluster_id)}::uuid" for cluster_id in invalid_clusters
        )
        statements.append(
            "UPDATE deals AS d SET is_deal = FALSE "
            f"WHERE d.cluster_id IN ({cluster_values}) "
            "AND NOT EXISTS ("
            "SELECT 1 FROM deal_items AS i "
            "WHERE i.cluster_id = d.cluster_id AND i.is_deal IS TRUE"
            ");"
        )
    statements.append("COMMIT;")
    return "\n".join(statements)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="read rows and print candidates/SQL only; this script never writes to Supabase",
    )
    args = parser.parse_args()
    if not args.dry_run:
        parser.error("This review-only script requires --dry-run and never applies changes.")

    rows = _fetch_rows(
        scanner.supabase,
        "deal_items",
        "id,cluster_id,title,publisher_domain,is_deal,deal_classification_reason",
    )
    candidates, invalid_clusters = plan_reclassification(rows)
    logging.info("Rows to reclassify: %d", len(candidates))
    for row in candidates:
        logging.info(
            "%s | %s | %s | %s -> non-deal (%s)",
            row["id"],
            row.get("publisher_domain") or "unknown publisher",
            row.get("title") or "",
            str(row["cluster_id"] or "no cluster"),
            row["new_reason"],
        )
    print("\nSQL for review (not executed):")
    print(render_review_sql(candidates, invalid_clusters))
    logging.info("Dry run only; no Supabase rows were changed.")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    main()
