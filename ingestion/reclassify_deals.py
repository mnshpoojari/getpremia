"""Print a dry-run classification review and SQL for invalid canonical deals."""

from __future__ import annotations

import argparse
import logging
from typing import Any

if __package__:
    from . import trend_scanner as scanner
    from .deal_rules import exclusion_reason, has_transaction_phrase, publisher_domain
else:
    import trend_scanner as scanner
    from deal_rules import exclusion_reason, has_transaction_phrase, publisher_domain


def plan_reclassification(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    candidates = []
    for row in rows:
        if row.get("is_deal") is False:
            continue
        title = str(row.get("title") or "")
        domain = row.get("publisher_domain") or publisher_domain(row.get("url"))
        reason = exclusion_reason(title, domain, row.get("source"))
        if reason is None and not row.get("buyer_name") and not row.get("target_name"):
            reason = "not_a_transaction"
        if reason is None and not has_transaction_phrase(title):
            reason = "not_a_transaction"
        if reason:
            candidates.append({**row, "new_reason": reason})
    return candidates


def _sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def render_review_sql(candidates: list[dict[str, Any]]) -> str:
    statements = ["BEGIN;"]
    for row in candidates:
        statements.append(
            "UPDATE deals SET is_deal = FALSE "
            f"WHERE id = {_sql_literal(str(row['id']))}::uuid AND is_deal IS TRUE;"
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

    rows = []
    offset = 0
    while True:
        batch = scanner.supabase.table("deals").select(
            "id,title,url,source,publisher_domain,buyer_name,target_name,is_deal"
        ).range(offset, offset + 999).execute().data or []
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    candidates = plan_reclassification(rows)
    logging.info("Rows to reclassify: %d", len(candidates))
    for row in candidates:
        logging.info(
            "%s | %s | %s -> non-deal (%s)",
            row["id"],
            row.get("publisher_domain") or row.get("source") or "unknown publisher",
            row.get("title") or "",
            row["new_reason"],
        )
    print("\nSQL for review (not executed):")
    print(render_review_sql(candidates))
    logging.info("Dry run only; no Supabase rows were changed.")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    main()
