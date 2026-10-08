import json
import os
import unittest
from unittest.mock import patch

os.environ["GEMINI_API_KEY"] = "unit-test-key"
os.environ["SUPABASE_URL"] = "https://example.supabase.co"
os.environ["SUPABASE_SERVICE_ROLE_KEY"] = "unit-test-key"

with patch("supabase.create_client", return_value=None):
    from ingestion import ingest

from ingestion.deal_rules import deal_rejection_reason, exclusion_reason, has_transaction_phrase


class FakeResponse:
    def __init__(self, data):
        self.data = data


class FakeQuery:
    def __init__(self, database, table):
        self.database = database
        self.table = table
        self.operation = None
        self.payload = None
        self.filters = []

    def select(self, _columns):
        self.operation = "select"
        return self

    def eq(self, column, value):
        self.filters.append((column, value))
        return self

    def upsert(self, row, on_conflict):
        self.operation = "upsert"
        self.payload = row
        self.conflict = on_conflict
        return self

    def insert(self, row):
        self.operation = "insert"
        self.payload = row
        return self

    def update(self, row):
        self.operation = "update"
        self.payload = row
        return self

    def execute(self):
        rows = self.database.tables.setdefault(self.table, [])
        matching = [
            row for row in rows
            if all(row.get(column) == value for column, value in self.filters)
        ]
        if self.operation == "select":
            return FakeResponse([dict(row) for row in matching])
        if self.operation == "upsert":
            payload = dict(self.payload)
            existing = next(
                (row for row in rows if row.get(self.conflict) == payload.get(self.conflict)),
                None,
            )
            if existing:
                existing.update(payload)
            else:
                rows.append(payload)
            return FakeResponse([payload])
        if self.operation == "insert":
            self.database.tables[self.table].append(dict(self.payload))
            return FakeResponse([self.payload])
        if self.operation == "update":
            for row in matching:
                row.update(self.payload)
            return FakeResponse(matching)
        raise AssertionError(f"Unexpected query operation: {self.operation}")


class FakeDatabase:
    def __init__(self):
        self.tables = {}

    def table(self, table):
        return FakeQuery(self, table)


class IngestGuardrailTests(unittest.TestCase):
    def setUp(self):
        self.database = FakeDatabase()
        self.supabase_patch = patch.object(ingest, "supabase", self.database)
        self.supabase_patch.start()
        self.addCleanup(self.supabase_patch.stop)

    def test_both_problem_headlines_are_rejected_before_gemini_and_stored(self):
        items = [
            {
                "title": "TOP 20 SAAS CUSTOMER ACQUISITION STATISTICS 2026 THAT EXPOSE SKYROCKETING CAC",
                "url": "https://example.com/top-saas",
                "source": "Example",
                "feed_role": "deal_source",
            },
            {
                "title": "Software as a Service (SaaS) Market Size | CAGR of 18.0% - Market.us",
                "url": "https://market.us/report/saas",
                "source": "Market.us",
                "publisher_domain": "market.us",
                "feed_role": "deal_source",
            },
        ]
        classifier = patch.object(ingest, "classify_batch")
        mock_classifier = classifier.start()
        self.addCleanup(classifier.stop)

        self.assertEqual(ingest.process_items(items), (0, 0, 2))
        mock_classifier.assert_not_called()
        self.assertEqual(self.database.tables.get("deals", []), [])
        self.assertEqual(
            [item["reject_reason"] for item in self.database.tables["feed_items"]],
            ["listicle", "market_report"],
        )
        self.assertTrue(all(not item["is_deal"] for item in self.database.tables["feed_items"]))

    def test_required_transactions_pass_the_post_gemini_gate(self):
        cases = [
            ("Mynd Fintech acquires C2FO India ...", "Mynd Fintech", "C2FO India"),
            ("Alta raises $25M Series A ...", "Alta", None),
            ("Carro acquires CarPlace ...", "Carro", "CarPlace"),
            ("B2B SaaS platform Mojro raises $3 Mn led by IAN Alpha Fund", "Mojro", None),
        ]
        items = [
            {
                "title": title,
                "url": f"https://example.com/{index}",
                "source": "Example News",
                "publisher_domain": "example.com",
                "published_date": "2026-10-08",
                "feed_role": "deal_source",
            }
            for index, (title, _, _) in enumerate(cases)
        ]
        classifications = [
            {
                "is_deal": True,
                "buyer_name": buyer,
                "target_name": target,
                "deal_type": "Acquisition" if target else "Other",
                "reject_reason": None,
            }
            for _, buyer, target in cases
        ]
        classifier = patch.object(ingest, "classify_batch", return_value=classifications)
        classifier.start()
        self.addCleanup(classifier.stop)

        self.assertEqual(ingest.process_items(items), (4, 0, 0))
        self.assertEqual(len(self.database.tables["deals"]), 4)
        self.assertTrue(all(row["is_deal"] for row in self.database.tables["feed_items"]))

    def test_rejects_missing_parties_and_non_transaction_headlines(self):
        item = {
            "title": "A fast-growing SaaS company launches a new product",
            "url": "https://example.com/news",
            "source": "Example",
            "feed_role": "deal_source",
        }
        classified = {"is_deal": True, "buyer_name": None, "target_name": None}
        self.assertEqual(deal_rejection_reason(item, classified), "not_a_transaction")
        self.assertEqual(ingest.upsert_deal(item, classified), "skipped")
        self.assertEqual(self.database.tables.get("deals", []), [])
        self.assertFalse(self.database.tables["feed_items"][0]["is_deal"])
        self.assertFalse(has_transaction_phrase("Alta raises capital for expansion"))

    def test_nameless_deal_keys_use_normalized_titles(self):
        first = ingest.generate_deal_key(None, None, "Other", "Acme buys Beta")
        second = ingest.generate_deal_key(None, None, "Other", "Gamma merges with Delta")
        self.assertNotEqual(first, second)

    def test_google_news_publisher_and_suffix_are_used(self):
        config = ingest.FeedConfig(
            1,
            "deal_source",
            None,
            None,
            "google_news",
            query="acquisition",
        )
        entry = {
            "title": "Acme acquires Beta - Actual Publisher",
            "link": "https://news.google.com/rss/articles/123",
            "source": {
                "title": "Actual Publisher",
                "href": "https://www.publisher.example/news",
            },
            "summary": "Deal announced",
        }
        with (
            patch.object(ingest.feedparser, "parse", return_value=type(
                "Feed", (), {"bozo": False, "feed": {"title": "Google News"}, "entries": [entry]}
            )()),
            patch.object(ingest, "update_feed_health"),
        ):
            result = ingest.fetch_feed(config)
        self.assertEqual(result[0]["source"], "Actual Publisher")
        self.assertEqual(result[0]["publisher_domain"], "publisher.example")
        self.assertEqual(result[0]["title"], "Acme acquires Beta")

    def test_classifier_prompt_has_transaction_only_instruction_and_few_shots(self):
        items = [{"title": "Acme acquires Beta"}]
        generated = {}

        class Model:
            def generate_content(self, **kwargs):
                generated.update(kwargs)
                return type("Response", (), {"text": json.dumps([{"is_deal": True}])})()

        class Gemini:
            models = Model()

        with patch.object(ingest, "_gemini", Gemini()):
            ingest.classify_batch(items)
        prompt = generated["contents"]
        self.assertIn("is true ONLY", prompt)
        self.assertIn("TOP 20 SAAS CUSTOMER ACQUISITION STATISTICS", prompt)
        self.assertIn("Software as a Service (SaaS) Market Size", prompt)
        self.assertIn("reject_reason", prompt)

    def test_publishers_are_blocked_without_blocking_press_wires(self):
        self.assertEqual(
            exclusion_reason("Acme acquires Beta", "reports.market.us"),
            "market_report",
        )
        self.assertIsNone(exclusion_reason("Acme acquires Beta", "businesswire.com"))


if __name__ == "__main__":
    unittest.main()
