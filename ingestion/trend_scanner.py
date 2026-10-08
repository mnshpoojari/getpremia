"""
Premia trend scanner.
Fetches RSS feeds, stores article-level tags in deal_items, then calculates
sector activity from canonical deals in Supabase.

No AI calls — runs in seconds.

Usage:
    python ingestion/trend_scanner.py
"""

import json
import logging
import os
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional

import feedparser
from dotenv import load_dotenv
from supabase import create_client, Client
if __package__:
    from .deal_pipeline import (
        clean_title,
        classify_buyer_type,
        classify_deal_type,
        classify_status,
        has_deal_keyword,
        keyword_matches,
        normalize_title,
        parse_deal_value_usd,
        parse_publisher,
        persist_deal_items,
        refresh_sector_trends,
        tag_deal_item,
    )
else:
    from deal_pipeline import (
        clean_title,
        classify_buyer_type,
        classify_deal_type,
        classify_status,
        has_deal_keyword,
        keyword_matches,
        normalize_title,
        parse_deal_value_usd,
        parse_publisher,
        persist_deal_items,
        refresh_sector_trends,
        tag_deal_item,
    )
if __package__:
    from .mentions import collect_mention_items, persist_mentions
else:
    from mentions import collect_mention_items, persist_mentions

_root = Path(__file__).parent.parent
load_dotenv(_root / ".env.local")
load_dotenv(_root / ".env")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

supabase: Client = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_SERVICE_ROLE_KEY"],
)

# ── Feed sources (same as ingest.py) ──────────────────────────────────────────

TIER_1_FEEDS = [
    # Global PE / M&A
    "https://www.altassets.net/feed",
    "https://www.pehub.com/feed",
    "https://www.pehubnetwork.com/feed",
    "https://www.privateequityinternational.com/feed",
    "https://www.buyoutsinsider.com/feed",
    "https://www.pe-insights.com/feed",
    "https://www.privateequitywire.co.uk/feed",
    "https://www.finsmes.com/feed",
    "https://www.healthcareprivateequity.com/feed",
    # Legal / governance commentary
    "https://corpgov.law.harvard.edu/feed/",
    # India exchange filings
    "https://trendlyne.com/bse-corporate-announcements/feed/",
    # Asia
    "https://www.dealstreetasia.com/feed",
    "https://www.vccircle.com/feed",
    "https://e27.co/feed",
    "https://kr-asia.com/feed",
    "https://www.techinasia.com/feed",
    # Africa
    "https://techpoint.africa/feed",
    "https://disrupt-africa.com/feed",
    "https://venturesafrica.com/feed",
    "https://www.africabusiness.com/feed",
    "https://businessday.ng/feed",
    # Latin America
    "https://contxto.com/en/feed/",
    "https://latamlist.com/feed/",
    # MENA / emerging
    "https://wamda.com/feed",
    "https://propakistani.pk/feed",
]

TIER_2_FEEDS = [
    "https://www.ft.com/rss/home/private-equity",
    "https://news.google.com/rss/search?q=site%3Areuters.com%20acquisition%20OR%20merger%20OR%20private%20equity%20when%3A90d&hl=en-US&gl=US&ceid=US:en",
    "https://rss.nytimes.com/services/xml/rss/nyt/DealBook.xml",
    "https://www.axios.com/feeds/feed/markets.xml",
    "https://www.businesswire.com/rss/home/?rss=g22",
    "https://www.prnewswire.com/rss/news-releases-list.rss",
    "https://www.arabianbusiness.com/rss",
    "https://www.zawya.com/rss/feed",
    "https://economictimes.indiatimes.com/markets/rss.cms",
    "https://www.bizcommunity.com/rss/196/1.rss",   # Africa business
    "https://www.businessinsider.com.au/sai/feed",  # APAC
    # India M&A and GlobeNewswire PE press releases
    "https://www.business-standard.com/rss/companies-101.rss",
    "https://www.globenewswire.com/RssFeed/industry/9133-private-equity",
]

TIER_3_QUERIES = [
    # Mainstream
    "private equity acquisition when:90d",
    "M&A deal India when:90d",
    "strategic acquisition United States when:90d",
    "private equity buyout Europe when:90d",
    "majority stake acquisition when:90d",
    "take private deal when:90d",
    "acquisition Singapore when:90d",
    "private equity Middle East when:90d",
    # Africa
    "private equity acquisition Nigeria when:90d",
    "private equity acquisition Kenya when:90d",
    "M&A deal South Africa when:90d",
    "venture capital acquisition Africa when:90d",
    "acquisition Ethiopia Ghana when:90d",
    # Latin America
    "private equity acquisition Brazil when:90d",
    "M&A deal Mexico when:90d",
    "private equity acquisition Colombia Chile Peru when:90d",
    "acquisition Latin America when:90d",
    # Southeast Asia (beyond Singapore)
    "acquisition Vietnam Indonesia when:90d",
    "private equity Philippines Thailand Malaysia when:90d",
    "M&A deal Southeast Asia when:90d",
    # Other frontier / emerging
    "acquisition Turkey when:90d",
    "private equity Egypt Morocco when:90d",
    "M&A deal Pakistan Bangladesh when:90d",
    "acquisition Eastern Europe Poland Romania when:90d",
    "private equity Central Asia Kazakhstan when:90d",
    # Sector-specific global
    '"climate infrastructure" OR "energy transition" acquisition when:90d',
    '"fintech" OR "financial technology" acquires OR "takes stake" when:90d',
    '"healthtech" OR "digital health" acquisition OR buyout when:90d',
    '"SaaS" OR "B2B software" private equity buyout when:90d',
    '"logistics" OR "supply chain" acquisition stake when:90d',
    '"sovereign wealth fund" acquisition stake when:90d',
    # Formal deal language
    '"definitive agreement" acquisition when:90d',
    '"binding offer" acquisition when:90d',
    '"letter of intent" acquisition merger when:90d',
    '"signs agreement" OR "completes acquisition" when:90d',
    # India SEBI / exchange-level filings
    '"open offer" India SEBI when:90d',
    '"preferential allotment" acquisition India when:90d',
    '"block deal" India stake when:90d',
    # Gulf sovereign wealth funds
    '"Mubadala" OR "ADIA" acquisition stake when:90d',
    '"PIF" OR "Public Investment Fund" acquisition when:90d',
    '"QIA" OR "Qatar Investment Authority" stake when:90d',
    '"ADQ" OR "KIPCO" acquisition when:90d',
]

SECTOR_KEYWORDS: dict[str, list[str]] = {
    "Healthcare IT": [
        "healthcare", "health care", "hospital", "medical", "pharma", "pharmaceutical",
        "biotech", "healthtech", "health tech", "digital health", "health IT", "medtech",
        "telehealth", "telemedicine", "health software", "clinical", "life sciences",
        "health data", "medical device", "diagnostics",
    ],
    "Climate Infrastructure": [
        "climate", "clean energy", "renewable", "solar", "wind", "energy transition",
        "green infrastructure", "net zero", "cleantech", "clean tech", "electric vehicle",
        "EV", "battery", "green hydrogen", "decarbonisation", "decarbonization",
        "sustainability", "carbon", "offshore wind", "photovoltaic",
    ],
    "B2B SaaS": [
        "software", "SaaS", "enterprise software", "cloud software", "B2B software",
        "tech company", "technology company", "software company", "platform",
        "HR tech", "hrtech", "martech", "marketing tech", "CRM", "ERP",
        "workflow", "automation software", "cloud platform",
    ],
    "Fintech": [
        "fintech", "financial technology", "payments", "payment", "digital banking",
        "insurtech", "neobank", "lending", "wealthtech", "wealth tech", "regtech",
        "open banking", "embedded finance", "payment processing", "digital payments",
        "insurance tech", "financial software",
    ],
    "Consumer Tech": [
        "consumer tech", "e-commerce", "ecommerce", "online marketplace", "marketplace",
        "retail tech", "food tech", "travel tech", "direct-to-consumer", "DTC",
        "consumer platform", "digital consumer",
    ],
    "Logistics & Supply Chain": [
        "logistics", "supply chain", "freight", "shipping", "last-mile", "warehouse",
        "fulfillment", "fulfilment", "fleet", "3PL", "cold chain", "distribution",
        "transport", "trucking", "cargo",
    ],
    "Industrial Tech": [
        "industrial", "manufacturing", "robotics", "factory", "automation",
        "industrial IoT", "smart factory", "process automation", "machinery",
        "industrial software", "engineering firm",
    ],
    "Real Estate": [
        "real estate", "property", "proptech", "REIT", "commercial real estate",
        "data centre", "data center", "infrastructure fund", "housing",
        "residential", "office space", "retail property",
    ],
    "Energy": [
        "oil", "gas", "energy", "power generation", "utilities", "LNG",
        "natural gas", "midstream", "upstream", "downstream", "petroleum",
        "oil field", "energy company", "power plant",
    ],
    "Financial Services": [
        "asset management", "investment management", "wealth management",
        "reinsurance", "financial services", "fund manager", "bank", "banking",
        "insurance", "pension", "hedge fund", "private credit",
    ],
    "Education Tech": [
        "edtech", "education tech", "education technology", "online learning",
        "e-learning", "skills platform", "learning management", "tutoring",
        "training platform", "higher education",
    ],
    "Defence & Aerospace": [
        "defence", "defense", "aerospace", "satellite", "space tech", "space company",
        "cybersecurity", "cyber security", "military", "government tech", "govtech",
        "intelligence", "surveillance",
    ],
    "Agriculture Tech": [
        "agritech", "agtech", "agriculture", "farming", "precision farming",
        "vertical farming", "smart farming", "food production", "crop",
        "agricultural", "animal health",
    ],
    "Media & Entertainment": [
        "media", "entertainment", "streaming", "gaming", "sports", "content",
        "publishing", "broadcast", "film", "music", "podcast", "esports",
    ],
    "Retail & Consumer": [
        "retail", "consumer goods", "FMCG", "fashion", "beauty", "food and beverage",
        "F&B", "consumer brand", "lifestyle", "luxury", "grocery", "supermarket",
    ],
}


# ── EDGAR helper ──────────────────────────────────────────────────────────────

def fetch_edgar_items() -> list[dict]:
    """Fetch recent 8-K M&A filings from SEC EDGAR full-text search API."""
    today = datetime.now(timezone.utc).date()
    start = (datetime.now(timezone.utc) - timedelta(days=30)).date()
    url = (
        "https://efts.sec.gov/LATEST/search-index?q=%22acquisition%22+OR+%22merger%22"
        f"&forms=8-K&dateRange=custom&startdt={start}&enddt={today}"
    )
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "Premia/1.0 mnshpoojari@gmail.com"},
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
        hits = data.get("hits", {}).get("hits", [])
        items = []
        for hit in hits:
            src = hit.get("_source", {})
            display_names = src.get("display_names") or []
            entity = ", ".join(display_names) if isinstance(display_names, list) and display_names else src.get("entity_name", "Unknown")
            form = src.get("form", "8-K")
            items_text = " ".join(src.get("items", []) or [])
            if form == "8-K" and "2.01" not in items_text:
                continue
            if form not in {"8-K", "SC 13D"}:
                continue
            file_date = src.get("file_date", "")
            parsed_date: Optional[datetime] = None
            if file_date:
                try:
                    parsed_date = datetime.strptime(file_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
                except ValueError:
                    pass
            accession = src.get("accession_no", "").replace("-", "")
            cik = str(src.get("entity_id", "")).lstrip("0")
            filing_url = (
                f"https://www.sec.gov/Archives/edgar/data/{cik}/{accession}/"
                if cik and accession else f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type={form}"
            )
            title = f"{entity} files {form}: merger/acquisition"
            items.append({
                "title": title,
                "url": filing_url,
                "date": parsed_date,
                "publisher": "SEC EDGAR",
                "publisher_domain": "sec.gov",
                "source": "SEC EDGAR",
                "feed_url": url,
                "feed_role": "deal_source",
            })
        log.info(f"Fetched {len(items):>3} items  ←  SEC EDGAR EFTS")
        return items
    except Exception as e:
        log.warning(f"EDGAR fetch failed  ({e})")
        return []


# ── Helpers ────────────────────────────────────────────────────────────────────

def classify_sectors(text: str) -> list[str]:
    return [sector for sector, kws in SECTOR_KEYWORDS.items() if any(keyword_matches(text, kw) for kw in kws)]

def parse_date(entry) -> Optional[datetime]:
    if hasattr(entry, "published_parsed") and entry.published_parsed:
        try:
            return datetime(*entry.published_parsed[:6], tzinfo=timezone.utc)
        except Exception:
            pass
    if hasattr(entry, "updated_parsed") and entry.updated_parsed:
        try:
            return datetime(*entry.updated_parsed[:6], tzinfo=timezone.utc)
        except Exception:
            pass
    return None


def fetch_feed(url: str, feed_role: str = "deal_source") -> list[dict]:
    try:
        feed = feedparser.parse(url)
        items = []
        for entry in feed.entries:
            title = clean_title(entry.get("title", ""))
            publisher, publisher_domain = parse_publisher(entry, url)
            link = entry.get("link", "")
            items.append({
                "title": title,
                "normalized_title": normalize_title(title),
                "url": normalize_url(link),
                "date": parse_date(entry),
                "publisher": publisher,
                "publisher_domain": publisher_domain,
                "source": publisher,
                "feed_url": url,
                "feed_role": feed_role,
                "deal_type": classify_deal_type(title),
                "buyer_type": classify_buyer_type(title),
                "deal_value_usd": parse_deal_value_usd(title),
                "deal_status": classify_status(title),
            })
        log.info(f"Fetched {len(items):>3} items  ←  {url}")
        return items
    except Exception as e:
        log.warning(f"Feed failed  ←  {url}  ({e})")
        return []


def build_explanation(sector: str, count_30d: int, monthly: list[dict]) -> str:
    if len(monthly) >= 2:
        recent = monthly[-1]["count"]
        prior = monthly[-2]["count"]
        if prior == 0:
            trend = "picking up"
        elif recent >= prior * 1.4:
            trend = "accelerating"
        elif recent <= prior * 0.6:
            trend = "slowing"
        else:
            trend = "steady"
    else:
        trend = "active"
    return f"{count_30d} deals tracked in the last 30 days — {trend}."


def normalize_url(url: str) -> str:
    parsed = urllib.parse.urlsplit(url)
    tracking = {"fbclid", "gclid", "mc_cid", "mc_eid"}
    query = urllib.parse.urlencode(sorted(
        (key, value) for key, value in urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
        if not key.lower().startswith("utm_") and key.lower() not in tracking
    ))
    return urllib.parse.urlunsplit((
        parsed.scheme.lower(),
        parsed.netloc.lower().removeprefix("www."),
        parsed.path.rstrip("/"),
        query,
        "",
    ))

def dedupe_items(items: list[dict]) -> list[dict]:
    kept: dict[str, dict] = {}
    for item in items:
        key = normalize_url(item.get('url', '')) if item.get('url') else ''
        if key:
            item["url"] = key
            kept.setdefault(key, item)
    return list(kept.values())

# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    log.info("Premia trend scanner — starting (no AI, keyword matching only)")

    now = datetime.now(timezone.utc)
    edgar_items = fetch_edgar_items()
    feed_batches: list[tuple[str, bool]] = (
        [(url, True) for url in TIER_1_FEEDS] +
        [(url, True) for url in TIER_2_FEEDS] +
        [(f"https://news.google.com/rss/search?q={urllib.parse.quote(q)}&hl=en-US&gl=US&ceid=US:en", False)
         for q in TIER_3_QUERIES]
    )
    candidates: list[dict] = []
    for url, require_deal_keyword in feed_batches:
        for item in dedupe_items(fetch_feed(url)):
            if require_deal_keyword and not has_deal_keyword(item["title"]):
                continue
            sectors = classify_sectors(item["title"])
            if not sectors:
                continue
            item["sectors"] = sectors
            candidates.append(tag_deal_item(item, SECTOR_KEYWORDS))

    for item in edgar_items:
        sectors = classify_sectors(item["title"])
        if not sectors:
            continue
        item["sectors"] = sectors
        candidates.append(tag_deal_item(item, SECTOR_KEYWORDS))

    stored_count = persist_deal_items(supabase, candidates, now, SECTOR_KEYWORDS)
    mention_items = collect_mention_items(
        supabase,
        now,
        SECTOR_KEYWORDS,
        fetch_feed,
        os.environ.get("SERPER_API_KEY"),
    )
    stored_mentions = persist_mentions(supabase, mention_items, now, SECTOR_KEYWORDS)
    results = refresh_sector_trends(supabase, now)
    results.sort(key=lambda row: row["count_30d"], reverse=True)
    log.info("Upserted %d per-publisher deal items (no item deletions)", stored_count)
    log.info("Upserted %d non-deal mention articles (no item deletions)", stored_mentions)
    log.info("Recomputed sector trends from canonical deals for %d sectors", len(results))
    for result in results[:10]:
        log.info(
            "  %-30s 30d: %3d  90d: %3d  prior 90d: %3d",
            result["sector"], result["count_30d"], result["count_90d"], result["count_prior_90d"],
        )


if __name__ == "__main__":
    main()
