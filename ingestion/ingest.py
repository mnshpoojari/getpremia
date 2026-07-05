"""
Premia ingestion pipeline.

Fetches configured RSS feeds, tracks feed health, stores raw feed items with
feed-role metadata, classifies deal-source items with Gemini, and upserts deals
into Supabase.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal, Optional

import feedparser
from dotenv import load_dotenv
from google import genai
from supabase import Client, create_client

_root = Path(__file__).parent.parent
load_dotenv(_root / ".env.local")
load_dotenv(_root / ".env")

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-8s  %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger(__name__)

BATCH_SIZE = 50
DEAD_FEED_WARNING_THRESHOLD = 3

FeedRole = Literal["deal_source", "narrative_source", "both"]
FeedKind = Literal["rss", "google_news"]

_gemini = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
supabase: Client = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])


@dataclass(frozen=True)
class FeedConfig:
    tier: int
    feed_role: FeedRole
    region: Optional[str]
    sector: Optional[str]
    kind: FeedKind
    url: Optional[str] = None
    query: Optional[str] = None
    note: Optional[str] = None

    @property
    def fetch_url(self) -> str:
        if self.kind == "google_news":
            encoded = urllib.parse.quote(self.query or "")
            return f"https://news.google.com/rss/search?q={encoded}&hl=en-US&gl=US&ceid=US:en"
        if not self.url:
            raise ValueError("RSS feed config requires url")
        return self.url

    @property
    def feed_key(self) -> str:
        return self.url or self.query or self.fetch_url


GOOGLE_NEWS_DEAL_QUERIES = [
    "private equity acquisition 2026",
    "M&A deal India 2026",
    "strategic acquisition United States 2026",
    "private equity buyout Europe 2026",
    "majority stake acquisition 2026",
    "take private deal 2026",
    "carve out divestiture 2026",
    "acquisition Singapore 2026",
    "private equity Middle East 2026",
    "acquisition Australia 2026",
    "M&A Japan 2026",
    "acquisition South Korea 2026",
    "private equity China 2026",
    "acquisition Africa 2026",
    "Brazil acquisition OR private equity 2026",
    '"climate infrastructure" OR "energy transition" acquisition 2026',
    '"fintech" OR "financial technology" acquires OR "takes stake" 2026',
    '"healthtech" OR "digital health" acquisition OR buyout 2026',
    '"SaaS" OR "B2B software" private equity buyout 2026',
    '"logistics" OR "supply chain" acquisition stake 2026',
    '"agritech" OR "agriculture technology" acquisition 2026',
    '"growth equity" investment 2026',
    '"family office" acquisition 2026',
    '"sovereign wealth fund" acquisition stake 2026',
    '"definitive agreement" acquisition 2026',
    '"binding offer" acquisition 2026',
    '"letter of intent" acquisition merger 2026',
    '"signs agreement" OR "completes acquisition" 2026',
    '"open offer" India SEBI 2026',
    '"preferential allotment" acquisition India 2026',
    '"block deal" India stake 2026',
    '"Mubadala" OR "ADIA" acquisition stake 2026',
    '"PIF" OR "Public Investment Fund" acquisition 2026',
    '"QIA" OR "Qatar Investment Authority" stake 2026',
    '"ADQ" OR "KIPCO" acquisition 2026',
]


FEEDS: list[FeedConfig] = [
    FeedConfig(1, "deal_source", None, None, "rss", url="https://www.altassets.net/feed"),
    FeedConfig(1, "deal_source", "United States", None, "rss", url="https://www.pehub.com/feed"),
    FeedConfig(1, "deal_source", None, None, "rss", url="https://www.pehubnetwork.com/feed"),
    FeedConfig(1, "deal_source", None, None, "rss", url="https://www.privateequityinternational.com/feed"),
    FeedConfig(1, "deal_source", "United States", None, "rss", url="https://www.buyoutsinsider.com/feed"),
    FeedConfig(1, "deal_source", None, None, "rss", url="https://www.pe-insights.com/feed"),
    FeedConfig(1, "deal_source", None, None, "rss", url="https://www.mergermarket.com/feed"),
    FeedConfig(1, "deal_source", "United Kingdom", None, "rss", url="https://www.privateequitywire.co.uk/feed"),
    FeedConfig(1, "deal_source", "Europe", None, "rss", url="https://www.unquote.com/feed"),
    FeedConfig(1, "deal_source", "Southeast Asia", None, "rss", url="https://www.dealstreetasia.com/feed"),
    FeedConfig(1, "deal_source", "India", None, "rss", url="https://www.vccircle.com/feed"),
    FeedConfig(1, "both", "Southeast Asia", "Consumer Tech", "rss", url="https://e27.co/feed"),
    FeedConfig(1, "deal_source", "United States", "Healthcare IT", "rss", url="https://www.healthcareprivateequity.com/feed"),
    FeedConfig(1, "deal_source", None, "Fintech", "rss", url="https://www.finsmes.com/feed"),
    FeedConfig(1, "deal_source", "United States", None, "rss", url="https://corpgov.law.harvard.edu/feed/"),
    FeedConfig(1, "deal_source", "India", "Financial Services", "rss", url="https://trendlyne.com/bse-corporate-announcements/feed/"),
    FeedConfig(1, "both", "India", "Consumer Tech", "rss", url="https://inc42.com/feed/"),
    FeedConfig(1, "both", "India", "Consumer Tech", "rss", url="https://yourstory.com/feed"),
    FeedConfig(1, "both", "India", "Consumer Tech", "rss", url="https://entrackr.com/rss", note="Verified alternate for dead /feed/ endpoint."),
    FeedConfig(2, "both", "India", None, "rss", url="https://www.moneycontrol.com/rss/business.xml"),
    FeedConfig(2, "both", "India", None, "rss", url="https://www.livemint.com/rss/companies"),
    FeedConfig(2, "both", "India", "Fintech", "rss", url="https://www.medianama.com/feed/"),
    FeedConfig(2, "deal_source", "India", "Financial Services", "google_news", query="RBI NPCI press release fintech payments India 2026", note="RBI/NPCI RSS unavailable; query used until scraper exists."),
    FeedConfig(1, "both", "China", "Consumer Tech", "rss", url="https://technode.com/feed/"),
    FeedConfig(2, "narrative_source", None, None, "rss", url="https://feeds.reuters.com/reuters/businessNews"),
    FeedConfig(2, "narrative_source", "United States", None, "rss", url="https://rss.nytimes.com/services/xml/rss/nyt/DealBook.xml"),
    FeedConfig(2, "narrative_source", "United States", None, "rss", url="https://www.axios.com/feeds/feed/markets.xml"),
    FeedConfig(2, "narrative_source", None, None, "rss", url="https://feeds.content.dowjones.io/public/rss/RSSMarketsMain"),
    FeedConfig(2, "narrative_source", None, None, "rss", url="https://www.businesswire.com/rss/home/?rss=g22"),
    FeedConfig(2, "narrative_source", None, None, "rss", url="https://www.prnewswire.com/rss/news-releases-list.rss"),
    FeedConfig(2, "narrative_source", "India", None, "rss", url="https://economictimes.indiatimes.com/markets/rss.cms"),
    FeedConfig(2, "narrative_source", "India", None, "rss", url="https://www.business-standard.com/rss/companies-101.rss"),
    FeedConfig(2, "narrative_source", None, None, "rss", url="https://www.globenewswire.com/RssFeed/industry/9133-private-equity"),
    FeedConfig(2, "narrative_source", None, "Consumer Tech", "rss", url="https://techcrunch.com/feed/"),
    FeedConfig(2, "narrative_source", None, "Consumer Tech", "rss", url="https://www.theverge.com/rss/index.xml"),
    *[FeedConfig(3, "deal_source", None, None, "google_news", query=query) for query in GOOGLE_NEWS_DEAL_QUERIES],
]

# Dropped after live verification on 2026-07-05:
# - kr-asia company/feed pages: HTML/malformed, no parseable feed.
# - Tech in Asia RSS/feed: HTTP 403.
# - Arabian Business RSS variants: HTTP 403.
# - Zawya RSS variants: HTTP 404.
# - MEED /feed: redirects to HTML home page.
# - RBI/NPCI RSS endpoints: unavailable from this environment; needs scraper.

DEAL_KEYWORDS = [
    "acquires", "acquisition", "takes stake", "majority stake", "buyout",
    "take private", "merger", "carve-out", "divestiture", "strategic review",
    "sale process", "capital injection", "going private", "spin-off",
    "invested in", "portfolio company", "raises", "funding round", "series a",
    "series b", "series c", "form d", "private placement",
]

BATCH_PROMPT_HEADER = """\
Classify each news item. Return a JSON array with exactly one object per item, in the same order.
IMPORTANT: Only extract information explicitly stated in the text. Use null rather than guessing.
Fields per object:
sector: one of [Healthcare IT, Climate Infrastructure, B2B SaaS, Fintech, Consumer Tech, Industrial Tech, Real Estate, Energy, Financial Services, Media & Entertainment, Retail & Consumer, Logistics & Supply Chain, Education Tech, Defence & Aerospace, Agriculture Tech, Other]
sub_sector: string or null
geography: one of [United States, India, United Kingdom, Germany, France, Europe, Southeast Asia, Middle East, Australia, China, Africa, Latin America, Other]
buyer_name: string from text or null
buyer_type: one of [PE, Strategic, SWF, VC, Unknown]
target_name: string from text or null
deal_size_usd: number in USD millions only if explicitly stated, else null
deal_type: one of [Acquisition, Stake, Merger, Carve-out, IPO, Other]
is_deal: true if this is an actual transaction, private placement, funding round, or announced deal process; false if commentary/analysis

Return ONLY the JSON array. No explanation.

Items:
"""


def role_includes(feed_role: FeedRole, role: Literal["deal_source", "narrative_source"]) -> bool:
    return feed_role == role or feed_role == "both"


def generate_deal_key(buyer_name: Optional[str], target_name: Optional[str], deal_type: Optional[str]) -> str:
    raw = f"{(buyer_name or '').lower().strip()}-{(target_name or '').lower().strip()}-{(deal_type or '').lower().strip()}"
    return hashlib.md5(raw.encode()).hexdigest()


def generate_item_key(url: str, title: str) -> str:
    raw = url.strip().lower() or title.strip().lower()
    return hashlib.md5(raw.encode()).hexdigest()


def has_deal_keyword(text: str) -> bool:
    t = text.lower()
    return any(kw in t for kw in DEAL_KEYWORDS)


def parse_date(entry) -> Optional[str]:
    if hasattr(entry, "published_parsed") and entry.published_parsed:
        try:
            return datetime(*entry.published_parsed[:6]).strftime("%Y-%m-%d")
        except Exception:
            pass
    return None


def extract_json_array(text: str) -> list:
    text = text.strip()
    if "```" in text:
        for block in text.split("```"):
            block = block.strip().lstrip("json").strip()
            try:
                result = json.loads(block)
                if isinstance(result, list):
                    return result
            except json.JSONDecodeError:
                continue
    return json.loads(text)


def update_feed_health(config: FeedConfig, success: bool, items_returned: int) -> None:
    now = datetime.now(timezone.utc).isoformat()
    feed_url = config.fetch_url
    existing = supabase.table("feed_health").select("consecutive_failures,last_success_at").eq("feed_url", feed_url).execute()
    previous_failures = existing.data[0]["consecutive_failures"] if existing.data else 0
    previous_success = existing.data[0].get("last_success_at") if existing.data else None
    consecutive_failures = 0 if success else previous_failures + 1
    row = {
        "feed_url": feed_url,
        "last_attempt_at": now,
        "last_success_at": now if success else previous_success,
        "consecutive_failures": consecutive_failures,
        "items_returned_last_run": items_returned,
        "feed_role": config.feed_role,
        "region": config.region,
        "sector": config.sector,
        "tier": config.tier,
    }
    supabase.table("feed_health").upsert(row, on_conflict="feed_url").execute()
    if consecutive_failures >= DEAD_FEED_WARNING_THRESHOLD:
        log.warning("Feed unhealthy (%s consecutive failures): %s", consecutive_failures, feed_url)


def upsert_feed_item(item: dict) -> None:
    row = {
        "item_key": generate_item_key(item.get("url", ""), item.get("title", "")),
        "title": item.get("title", ""),
        "url": item.get("url", ""),
        "source": item.get("source"),
        "published_date": item.get("published_date"),
        "snippet": item.get("snippet"),
        "feed_url": item.get("feed_url"),
        "feed_role": item.get("feed_role"),
        "feed_region": item.get("feed_region"),
        "feed_sector": item.get("feed_sector"),
        "tier": item.get("tier"),
        "last_seen_at": datetime.now(timezone.utc).isoformat(),
    }
    supabase.table("feed_items").upsert(row, on_conflict="item_key").execute()


def fetch_edgar_items(forms: str = "8-K") -> list[dict]:
    today = datetime.now(timezone.utc).date()
    start = (datetime.now(timezone.utc) - timedelta(days=30)).date()
    query = "%22acquisition%22+OR+%22merger%22" if forms == "8-K" else "%22private+placement%22+OR+%22offering%22"
    url = f"https://efts.sec.gov/LATEST/search-index?q={query}&forms={urllib.parse.quote(forms)}&dateRange=custom&startdt={start}&enddt={today}"
    label = f"SEC EDGAR {forms}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Premia/1.0 mnshpoojari@gmail.com"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
        hits = data.get("hits", {}).get("hits", [])
        items = []
        for hit in hits:
            src = hit.get("_source", {})
            entity = src.get("entity_name", "Unknown")
            file_date = src.get("file_date", "")
            accession = src.get("accession_no", "").replace("-", "")
            cik = str(src.get("entity_id", "")).lstrip("0")
            filing_url = f"https://www.sec.gov/Archives/edgar/data/{cik}/{accession}/" if cik and accession else f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type={forms}"
            items.append({
                "title": f"{entity} files {forms}: {'private placement' if forms == 'D' else 'merger/acquisition'}",
                "snippet": f"SEC EDGAR {forms} filing dated {file_date}",
                "url": filing_url,
                "source": label,
                "published_date": file_date or None,
                "feed_url": url,
                "feed_role": "deal_source",
                "feed_region": "United States",
                "feed_sector": None,
                "tier": 1,
            })
        log.info("Fetched %3d items <- %s", len(items), label)
        return items
    except Exception as e:
        log.warning("%s fetch failed (%s)", label, e)
        return []


def fetch_feed(config: FeedConfig) -> list[dict]:
    url = config.fetch_url
    try:
        feed = feedparser.parse(url)
        if getattr(feed, "bozo", False) and not feed.entries:
            raise ValueError(getattr(feed, "bozo_exception", "malformed feed"))
        feed_title = feed.feed.get("title", config.feed_key)
        items = []
        for entry in feed.entries:
            description = entry.get("summary", entry.get("description", ""))
            items.append({
                "title": entry.get("title", ""),
                "snippet": description[:250].strip(),
                "url": entry.get("link", ""),
                "source": feed_title,
                "published_date": parse_date(entry),
                "feed_url": url,
                "feed_role": config.feed_role,
                "feed_region": config.region,
                "feed_sector": config.sector,
                "tier": config.tier,
            })
        update_feed_health(config, True, len(items))
        log.info("Fetched %3d items <- %s", len(items), url)
        return items
    except Exception as e:
        update_feed_health(config, False, 0)
        log.warning("Feed failed <- %s (%s)", url, e)
        return []


def classify_batch(items: list[dict]) -> list[Optional[dict]]:
    lines = "\n".join(
        f"{i + 1}. {item['title']}" + (f" - {item['snippet']}" if item.get("snippet") else "")
        for i, item in enumerate(items)
    )
    prompt = BATCH_PROMPT_HEADER + lines
    try:
        response = _gemini.models.generate_content(model="gemini-2.5-flash-lite", contents=prompt)
        results = extract_json_array(response.text)
        while len(results) < len(items):
            results.append(None)
        return results[:len(items)]
    except json.JSONDecodeError as e:
        log.warning("JSON parse failed for batch of %d: %s", len(items), e)
        return [None] * len(items)
    except Exception as e:
        log.warning("Gemini error for batch of %d: %s", len(items), e)
        return [None] * len(items)


def upsert_deal(item: dict, classified: dict) -> str:
    deal_key = generate_deal_key(classified.get("buyer_name"), classified.get("target_name"), classified.get("deal_type"))
    existing = supabase.table("deals").select("id, times_seen, source, distinct_source_count").eq("deal_key", deal_key).execute()
    classified_geo = classified.get("geography")
    feed_region = item.get("feed_region")
    if feed_region and classified_geo and feed_region != classified_geo:
        log.info("Geo mismatch: feed=%s classified=%s title=%s", feed_region, classified_geo, item["title"][:80])

    source = item.get("source")
    if existing.data:
        row = existing.data[0]
        existing_sources = {s.strip() for s in (row.get("source") or "").split(",") if s.strip()}
        if source:
            existing_sources.add(source)
        supabase.table("deals").update({
            "times_seen": (row.get("times_seen") or 0) + 1,
            "distinct_source_count": len(existing_sources),
            "source": ", ".join(sorted(existing_sources)) if existing_sources else source,
            "last_seen_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", row["id"]).execute()
        return "updated"

    row = {
        "title": item["title"],
        "url": item["url"],
        "source": source,
        "published_date": item["published_date"],
        "sector": classified.get("sector") or item.get("feed_sector"),
        "sub_sector": classified.get("sub_sector"),
        "geography": classified_geo or feed_region,
        "buyer_name": classified.get("buyer_name"),
        "buyer_type": classified.get("buyer_type"),
        "target_name": classified.get("target_name"),
        "deal_size_usd": classified.get("deal_size_usd"),
        "deal_type": classified.get("deal_type"),
        "deal_key": deal_key,
        "status": "NEW",
        "times_seen": 1,
        "distinct_source_count": 1 if source else 0,
        "feed_role": item.get("feed_role"),
        "feed_region": feed_region,
        "feed_sector": item.get("feed_sector"),
        "feed_url": item.get("feed_url"),
    }
    try:
        supabase.table("deals").insert(row).execute()
        return "inserted"
    except Exception as e:
        log.warning("Insert failed - '%s' - %s", item["title"][:60], e)
        return "skipped"


def process_items(items: list[dict]) -> tuple[int, int, int]:
    inserted = updated = skipped = 0
    for item in items:
        upsert_feed_item(item)

    candidates = [
        i for i in items
        if role_includes(i["feed_role"], "deal_source")
        and has_deal_keyword(i["title"] + " " + i.get("snippet", ""))
    ]
    skipped += len(items) - len(candidates)

    for batch_start in range(0, len(candidates), BATCH_SIZE):
        batch = candidates[batch_start:batch_start + BATCH_SIZE]
        classifications = classify_batch(batch)
        for item, classified in zip(batch, classifications):
            if not classified or not classified.get("is_deal"):
                skipped += 1
                continue
            result = upsert_deal(item, classified)
            if result == "inserted":
                inserted += 1
                log.info("  [+] %s", item["title"][:80])
            elif result == "updated":
                updated += 1
            else:
                skipped += 1
        if batch_start + BATCH_SIZE < len(candidates):
            time.sleep(1)

    return inserted, updated, skipped


def main() -> None:
    log.info("Premia ingestion pipeline - starting")
    total_i = total_u = 0
    by_role: dict[str, int] = {"deal_source": 0, "narrative_source": 0, "both": 0}

    for config in FEEDS:
        items = fetch_feed(config)
        by_role[config.feed_role] += len(items)
        i, u, _ = process_items(items)
        total_i += i
        total_u += u

    for forms in ["8-K", "D"]:
        items = fetch_edgar_items(forms)
        i, u, _ = process_items(items)
        total_i += i
        total_u += u

    log.info("Raw items by role: %s", by_role)
    log.info("Complete - inserted: %d updated: %d", total_i, total_u)


if __name__ == "__main__":
    main()
