import unittest
from datetime import datetime, timedelta, timezone

from ingestion.mentions import (
    compute_mentions_90d,
    coverage_level,
    persist_mentions,
    prepare_mention_items,
)


NOW = datetime(2026, 10, 8, 12, tzinfo=timezone.utc)
SECTOR_KEYWORDS = {
    "Fintech": [
        "fintech", "payments", "payment", "lending", "wealthtech", "insurtech",
        "regtech", "neobank", "embedded finance", "open banking",
    ],
}


class FakeResponse:
    def __init__(self, data):
        self.data = data


class FakeTable:
    def __init__(self, database):
        self.database = database

    def upsert(self, rows, on_conflict):
        self.rows = rows
        self.on_conflict = on_conflict
        return self

    def execute(self):
        stored = self.database.setdefault("mentions", [])
        for row in self.rows:
            existing = next(
                (item for item in stored if item[self.on_conflict] == row[self.on_conflict]),
                None,
            )
            if existing:
                existing.update(row)
            else:
                stored.append(dict(row))
        return FakeResponse(self.rows)


class FakeSupabase:
    def __init__(self):
        self.tables = {}

    def table(self, _table_name):
        return FakeTable(self.tables)


class MentionTests(unittest.TestCase):
    def test_deal_headlines_are_excluded(self):
        items = prepare_mention_items(
            [{
                "title": "Acme acquires India fintech payments platform",
                "url": "https://example.com/deal",
                "publisher_domain": "example.com",
                "date": NOW - timedelta(days=2),
            }],
            "Fintech",
            "India",
            SECTOR_KEYWORDS,
            NOW,
        )

        self.assertEqual(items, [])

    def test_same_story_from_three_outlets_is_one_mention(self):
        article_title = "India fintech payments market expands to rural customers"
        articles = prepare_mention_items(
            [{
                "title": article_title,
                "url": f"https://{domain}/story",
                "publisher_domain": domain,
                "date": NOW - timedelta(days=2),
            } for domain in ("one.example", "two.example", "three.example")],
            "Fintech",
            "IN",
            SECTOR_KEYWORDS,
            NOW,
        )
        database = FakeSupabase()

        self.assertEqual(persist_mentions(database, articles, NOW, SECTOR_KEYWORDS), 3)
        result = compute_mentions_90d(database.tables["mentions"], "Fintech", "IN", NOW)

        self.assertEqual(result["mentions_90d"], 1)
        self.assertEqual(result["publishers_90d"], 3)

    def test_low_country_coverage_is_flagged(self):
        self.assertEqual(coverage_level(0), "low")
        self.assertEqual(coverage_level(2), "low")
        result = compute_mentions_90d(
            [],
            "Fintech",
            "India",
            NOW,
            {"coverage_level": coverage_level(1), "publisher_domain_count": 1},
        )

        self.assertEqual(result["country_coverage_level"], "low")
        self.assertEqual(result["country_coverage_publishers"], 1)


if __name__ == "__main__":
    unittest.main()
