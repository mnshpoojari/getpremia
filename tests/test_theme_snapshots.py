import json
import unittest
from datetime import datetime, timedelta, timezone

from ingestion.theme_snapshots import UNIVERSE_PATH, build_theme_snapshots, load_theme_universe


NOW = datetime(2026, 10, 8, 12, tzinfo=timezone.utc)


class ThemeSnapshotTests(unittest.TestCase):
    def test_universe_uses_all_scanner_sectors_for_each_market_and_global(self):
        universe = load_theme_universe(["Fintech", "Energy"])
        fintech_rows = [row for row in universe if row["sector"] == "Fintech"]
        with UNIVERSE_PATH.open(encoding="utf-8") as config_file:
            config = json.load(config_file)

        self.assertIn({"sector": "Fintech", "country": None}, fintech_rows)
        self.assertIn({"sector": "Fintech", "country": "IN"}, fintech_rows)
        self.assertIn({"sector": "Fintech", "country": "MENA"}, fintech_rows)
        self.assertEqual(
            len(universe),
            2 * (len(config["countries"]) + len(config["regions"]) + 1),
        )

    def test_only_themes_with_three_deals_or_three_mentions_qualify(self):
        deal_items = [
            {
                "cluster_id": f"deal-{index}",
                "published_at": (NOW - timedelta(days=3)).isoformat(),
                "sectors": ["Fintech"],
                "countries": ["IN"],
            }
            for index in range(3)
        ]
        mention_rows = [
            {
                "normalized_title": f"story {index}",
                "publisher_domain": f"news{index}.example",
                "published_at": (NOW - timedelta(days=2)).isoformat(),
                "sectors": ["Energy"],
                "countries": ["IN"],
            }
            for index in range(3)
        ]
        snapshots = build_theme_snapshots(
            deal_items,
            mention_rows,
            [{"country_code": "IN", "deal_item_count": 20, "publisher_domain_count": 5}],
            ["Fintech", "Energy", "Healthcare IT"],
            NOW,
        )
        by_theme = {(row["sector"], row["country"]): row for row in snapshots}

        self.assertIn(("Fintech", "IN"), by_theme)
        self.assertIn(("Energy", "IN"), by_theme)
        self.assertNotIn(("Healthcare IT", "IN"), by_theme)
        self.assertEqual(by_theme[("Fintech", "IN")]["country_coverage_publishers"], 5)
        self.assertEqual(by_theme[("Energy", "IN")]["mentions_90d"], 3)
        self.assertIn(("Fintech", None), by_theme)

    def test_distinct_clusters_and_prior_window_are_counted_once(self):
        deal_items = [
            {
                "cluster_id": "same-cluster",
                "published_at": (NOW - timedelta(days=4)).isoformat(),
                "sectors": ["Fintech"],
                "countries": ["IN"],
            },
            {
                "cluster_id": "same-cluster",
                "published_at": (NOW - timedelta(days=4)).isoformat(),
                "sectors": ["Fintech"],
                "countries": ["IN"],
            },
            {
                "cluster_id": "old-cluster",
                "published_at": (NOW - timedelta(days=100)).isoformat(),
                "sectors": ["Fintech"],
                "countries": ["IN"],
            },
        ]
        mention_rows = [{
            "normalized_title": f"story {index}",
            "publisher_domain": f"news{index}.example",
            "published_at": (NOW - timedelta(days=2)).isoformat(),
            "sectors": ["Fintech"],
            "countries": ["IN"],
        } for index in range(3)]
        snapshots = build_theme_snapshots(deal_items, mention_rows, [], ["Fintech"], NOW)
        india_snapshot = next(row for row in snapshots if row["country"] == "IN")

        self.assertEqual(india_snapshot["deals_90d"], 1)
        self.assertEqual(india_snapshot["deals_prior_90d"], 1)


if __name__ == "__main__":
    unittest.main()
