import unittest
from datetime import datetime, timedelta, timezone

from ingestion.deal_pipeline import (
    assign_cluster_ids,
    classify_countries,
    classify_sub_themes,
    compute_sector_counts,
    keyword_matches,
    parse_deal_value_usd,
    parse_publisher,
    persist_deal_items,
    prepare_item,
    clean_title,
    tag_deal_item,
)


class FakeResponse:
    def __init__(self, data):
        self.data = data


class FakeQuery:
    def __init__(self, client, table_name):
        self.client = client
        self.table_name = table_name
        self.filters = []
        self.start = 0
        self.stop = 1000
        self.rows = None

    def select(self, columns):
        self.selected_columns = columns
        return self

    def gte(self, column, value):
        self.filters.append((column, value))
        return self

    def in_(self, column, values):
        self.filters.append((column, values))
        return self

    def range(self, start, stop):
        self.start = start
        self.stop = stop + 1
        return self

    def upsert(self, rows, on_conflict):
        self.rows = rows if isinstance(rows, list) else [rows]
        self.on_conflict = on_conflict
        return self

    def execute(self):
        current = self.client.tables.setdefault(self.table_name, [])
        if self.rows is not None:
            for row in self.rows:
                existing = next((entry for entry in current if entry.get(self.on_conflict) == row[self.on_conflict]), None)
                if existing is None:
                    current.append(dict(row))
                else:
                    existing.update(row)
            return FakeResponse(self.rows)
        rows = list(current)
        for column, value in self.filters:
            if isinstance(value, list):
                rows = [row for row in rows if row.get(column) in value]
            else:
                rows = [row for row in rows if (row.get(column) or "") >= value]
        return FakeResponse(rows[self.start:self.stop])


class FakeSupabase:
    def __init__(self):
        self.tables = {}

    def table(self, table_name):
        return FakeQuery(self, table_name)


class DealPipelineTests(unittest.TestCase):
    def test_three_publishers_cluster_as_one_canonical_deal(self):
        database = FakeSupabase()
        date = datetime(2026, 5, 10, tzinfo=timezone.utc)
        publishers = [
            ("Reuters", "reuters.com"),
            ("Business Wire", "businesswire.com"),
            ("GlobeNewswire", "globenewswire.com"),
        ]
        items = [
            {
                "title": "Acme acquires fintech firm Beta in India payments",
                "url": f"https://{domain}/article",
                "publisher": publisher,
                "publisher_domain": domain,
                "date": date + timedelta(days=index),
                "sectors": ["Fintech"],
                "countries": ["India"],
                "sub_themes": ["payments"],
            }
            for index, (publisher, domain) in enumerate(publishers)
        ]

        self.assertEqual(persist_deal_items(database, items, date), 3)
        self.assertEqual(len(database.tables["deal_items"]), 3)
        self.assertEqual(len(database.tables["deals"]), 1)
        self.assertEqual(database.tables["deals"][0]["distinct_source_count"], 2)

    def test_old_existing_url_keeps_its_original_cluster(self):
        database = FakeSupabase()
        published = datetime(2025, 1, 1, tzinfo=timezone.utc)
        first_seen = datetime(2025, 1, 3, tzinfo=timezone.utc)
        database.tables["deal_items"] = [{
            "url": "https://example.com/old-deal",
            "title": "Acme acquires fintech firm Beta",
            "normalized_title": "acme fintech beta",
            "published_at": published.isoformat(),
            "first_seen_at": first_seen.isoformat(),
            "date_is_estimated": False,
            "publisher_domain": "example.com",
            "cluster_id": "original-cluster",
            "sectors": ["Fintech"],
            "countries": [],
            "sub_themes": [],
        }]

        persist_deal_items(database, [{
            "title": "Acme acquires fintech firm Beta",
            "url": "https://example.com/old-deal",
            "publisher": "Example",
            "publisher_domain": "example.com",
            "date": published,
            "sectors": ["Fintech"],
        }], datetime(2026, 10, 8, tzinfo=timezone.utc))

        self.assertEqual(database.tables["deal_items"][0]["cluster_id"], "original-cluster")
        self.assertEqual(database.tables["deal_items"][0]["first_seen_at"], first_seen.isoformat())
        self.assertEqual(len(database.tables["deals"]), 1)
        self.assertEqual(database.tables["deals"][0]["cluster_id"], "original-cluster")

    def test_missing_published_date_uses_first_seen_and_is_estimated(self):
        now = datetime(2026, 10, 8, 12, tzinfo=timezone.utc)
        item = prepare_item({
            "title": "Acme acquires Beta",
            "publisher": "Example News",
            "publisher_domain": "example.com",
        }, now)

        self.assertEqual(item["first_seen_at"], now)
        self.assertEqual(item["published_at"], now)
        self.assertTrue(item["date_is_estimated"])

    def test_google_news_source_element_provides_publisher_and_domain(self):
        publisher, domain = parse_publisher({
            "title": "Acme acquires Beta - Google News",
            "link": "https://news.google.com/rss/articles/123",
            "source": {"title": "Example Journal", "href": "https://www.example.com/"},
        }, "https://news.google.com/rss/search?q=acquisition")

        self.assertEqual(publisher, "Example Journal")
        self.assertEqual(domain, "example.com")
        self.assertEqual(clean_title("Acme acquires Beta - Google News"), "Acme acquires Beta")

    def test_google_news_without_source_never_uses_google_as_publisher_domain(self):
        publisher, domain = parse_publisher({
            "title": "Acme acquires Beta",
            "link": "https://news.google.com/rss/articles/123",
        }, "https://news.google.com/rss/search?q=acquisition")

        self.assertEqual(publisher, "Unknown")
        self.assertEqual(domain, "")

    def test_usd_value_parser_handles_headline_units(self):
        self.assertEqual(parse_deal_value_usd("Raises US$40 Million in funding"), 40_000_000)
        self.assertEqual(parse_deal_value_usd("A $1.25bn acquisition"), 1_250_000_000)
        self.assertIsNone(parse_deal_value_usd("Raises €40 million"))

    def test_country_tags_use_headline_gazetteer_and_roll_up_dubai(self):
        self.assertEqual(classify_countries("Dubai fintech firm"), ["AE", "GCC", "MENA"])
        self.assertEqual(classify_countries("Payments startup in India"), ["IN"])
        self.assertEqual(classify_countries("São Paulo investment"), ["BR"])
        self.assertEqual(classify_countries("ADGM fund backs a company"), ["AE", "GCC", "MENA"])
        self.assertEqual(
            tag_deal_item(
                {"title": "Fintech payments company", "publisher_domain": "dubai.example", "sectors": ["Fintech"]},
                {"Fintech": ["payments"]},
            )["countries"],
            [],
        )

    def test_subthemes_use_word_boundaries_and_acronym_case(self):
        groups = {
            "Fintech": ["fintech", "payments", "lending", "wealthtech", "insurtech", "regtech", "neobank", "embedded finance", "open banking"],
            "Climate Infrastructure": ["EV"],
            "B2B SaaS": ["CRM", "ERP"],
            "Energy": ["gas"],
        }
        self.assertFalse(keyword_matches("development", "EV"))
        self.assertFalse(keyword_matches("Las Vegas", "gas"))
        self.assertFalse(keyword_matches("crm startup", "CRM"))
        themes = classify_sub_themes(
            "Fintech payments and lending plus an EV fleet with CRM tools",
            ["Fintech", "Climate Infrastructure", "B2B SaaS"],
            groups,
        )
        self.assertEqual(themes, ["crm", "ev", "lending", "payments"])
        self.assertFalse(keyword_matches("ev fleet", "EV"))

    def test_tagging_is_persisted_to_deal_items(self):
        database = FakeSupabase()
        item = {
            "title": "Dubai fintech lending platform expands payments",
            "url": "https://example.com/deal",
            "publisher": "Example",
            "publisher_domain": "example.com",
            "date": datetime(2026, 10, 1, tzinfo=timezone.utc),
            "sectors": ["Fintech"],
        }
        persist_deal_items(
            database,
            [item],
            datetime(2026, 10, 8, tzinfo=timezone.utc),
            {"Fintech": ["payments", "lending", "neobank"]},
        )

        stored = database.tables["deal_items"][0]
        self.assertEqual(stored["countries"], ["AE", "GCC", "MENA"])
        self.assertEqual(stored["sub_themes"], ["lending", "payments"])

    def test_cluster_similarity_requires_time_window(self):
        base_date = datetime(2026, 5, 10, tzinfo=timezone.utc)
        existing = [{
            "title": "Acme acquires fintech firm Beta",
            "normalized_title": "acme fintech beta",
            "published_at": base_date,
            "cluster_id": "cluster-1",
        }]
        close_item = {
            "title": "Acme acquisition of fintech company Beta",
            "published_at": base_date + timedelta(days=2),
        }
        far_item = {
            "title": "Acme acquisition of fintech company Beta",
            "published_at": base_date + timedelta(days=8),
        }

        assigned = assign_cluster_ids([close_item, far_item], existing)
        self.assertEqual(assigned[0]["cluster_id"], "cluster-1")
        self.assertNotEqual(assigned[1]["cluster_id"], "cluster-1")

    def test_counts_use_canonical_clusters_once(self):
        now = datetime(2026, 10, 8, tzinfo=timezone.utc)
        date = now - timedelta(days=10)
        counts = compute_sector_counts([
            {"cluster_id": "one", "published_at": date, "sectors": ["Fintech"]},
            {"cluster_id": "one", "published_at": date, "sectors": ["Fintech"]},
            {"cluster_id": "two", "published_at": now - timedelta(days=120), "sectors": ["Fintech"]},
        ], now, known_sectors=["Stale"])

        fintech = next(row for row in counts if row["sector"] == "Fintech")
        stale = next(row for row in counts if row["sector"] == "Stale")
        self.assertEqual(fintech["count_30d"], 1)
        self.assertEqual(fintech["count_90d"], 1)
        self.assertEqual(fintech["count_prior_90d"], 1)
        self.assertEqual(sum(month["count"] for month in fintech["monthly_counts"]), 2)
        self.assertEqual(stale["count_30d"], 0)
        self.assertEqual(stale["count_90d"], 0)
        self.assertEqual(stale["count_prior_90d"], 0)


if __name__ == "__main__":
    unittest.main()
