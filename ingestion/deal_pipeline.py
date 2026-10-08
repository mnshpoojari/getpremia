"""Pure helpers and persistence for append-only deal items and canonical clusters."""

from __future__ import annotations

import re
import unicodedata
import urllib.parse
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

DEAL_STOP_WORDS = {
    "a", "an", "and", "by", "for", "from", "in", "of", "on", "the", "to",
    "with", "acquire", "acquires", "acquired", "acquisition", "announces",
    "announcement", "deal", "investment", "merger", "merges", "merged", "stake",
    "raises", "raised", "raising", "funding", "round", "reportedly", "said",
    "company", "firm", "group", "limited", "ltd", "inc", "corp", "corporation",
}
DEAL_KEYWORDS = [
    "acquires", "acquisition", "takes stake", "majority stake",
    "buyout", "take private", "merger", "carve-out", "divestiture",
    "strategic review", "sale process", "capital injection",
    "going private", "spin-off", "invested in", "portfolio company",
]
DEAL_KEYWORD_PATTERNS = [
    re.compile(r"\b" + re.escape(keyword) + r"\b", re.IGNORECASE)
    for keyword in DEAL_KEYWORDS
]
WIRE_DOMAINS = {
    "businesswire.com", "prnewswire.com", "globenewswire.com",
    "newswire.ca", "accesswire.com",
}
VALUE_PATTERN = re.compile(
    r"(?<![\w.])(?:US\s*)?(?:USD\s*)?[$]\s*([\d,.]+)\s*"
    r"(billion|bn|b\b|million|mn|m\b|thousand|k\b)?",
    re.IGNORECASE,
)
VALUE_CODE_PATTERN = re.compile(
    r"\bUSD\s*([\d,.]+)\s*(billion|bn|b\b|million|mn|m\b|thousand|k\b)?",
    re.IGNORECASE,
)
TITLE_PUBLISHER_SUFFIX = re.compile(r"\s+-\s+[^-]{2,100}\s*$")

COUNTRY_ALIASES: dict[str, str] = {
    "Afghanistan": "AF", "Albania": "AL", "Algeria": "DZ", "Argentina": "AR",
    "Australia": "AU", "Austria": "AT", "Bangladesh": "BD", "Belgium": "BE",
    "Brazil": "BR", "Canada": "CA", "Chile": "CL", "China": "CN",
    "Colombia": "CO", "Czech Republic": "CZ", "Czechia": "CZ", "Denmark": "DK",
    "Egypt": "EG", "Ethiopia": "ET", "Finland": "FI", "France": "FR",
    "Germany": "DE", "Ghana": "GH", "Greece": "GR", "Hong Kong": "HK",
    "Hungary": "HU", "India": "IN", "Indonesia": "ID", "Ireland": "IE",
    "Israel": "IL", "Italy": "IT", "Japan": "JP", "Jordan": "JO",
    "Kenya": "KE", "Kuwait": "KW", "Luxembourg": "LU", "Malaysia": "MY",
    "Mexico": "MX", "Morocco": "MA", "Nepal": "NP", "Netherlands": "NL",
    "New Zealand": "NZ", "Nigeria": "NG", "Norway": "NO", "Oman": "OM",
    "Pakistan": "PK", "Peru": "PE", "Philippines": "PH", "Poland": "PL",
    "Portugal": "PT", "Qatar": "QA", "Romania": "RO", "Russia": "RU",
    "Saudi Arabia": "SA", "Singapore": "SG", "South Africa": "ZA",
    "South Korea": "KR", "Republic of Korea": "KR", "Spain": "ES",
    "Sri Lanka": "LK", "Sweden": "SE", "Switzerland": "CH", "Taiwan": "TW",
    "Thailand": "TH", "Turkey": "TR", "Türkiye": "TR", "Ukraine": "UA",
    "United Arab Emirates": "AE", "UAE": "AE", "United Kingdom": "GB",
    "UK": "GB", "United States": "US", "United States of America": "US",
    "USA": "US", "Vietnam": "VN", "Côte d'Ivoire": "CI", "Ivory Coast": "CI",
    "Democratic Republic of the Congo": "CD", "DR Congo": "CD",
    "Republic of the Congo": "CG", "Tanzania": "TZ", "Uganda": "UG",
    "Senegal": "SN", "Cameroon": "CM", "Tunisia": "TN", "Libya": "LY",
    "Sudan": "SD", "Iraq": "IQ", "Iran": "IR", "Lebanon": "LB",
    "Yemen": "YE", "Palestine": "PS", "Syria": "SY", "Bahrain": "BH",
    "Costa Rica": "CR", "Panama": "PA", "Ecuador": "EC", "Uruguay": "UY",
    "Paraguay": "PY", "Bolivia": "BO", "Venezuela": "VE", "Guatemala": "GT",
    "Dominican Republic": "DO", "Serbia": "RS", "Croatia": "HR", "Bulgaria": "BG",
    "Slovakia": "SK", "Slovenia": "SI", "Estonia": "EE", "Latvia": "LV",
    "Lithuania": "LT", "Cyprus": "CY", "Malta": "MT", "Iceland": "IS",
    "Kazakhstan": "KZ", "Uzbekistan": "UZ", "Azerbaijan": "AZ", "Georgia": "GE",
    "Armenia": "AM", "Cambodia": "KH", "Laos": "LA", "Myanmar": "MM",
    "Brunei": "BN", "Mongolia": "MN",
    "Andorra": "AD", "Angola": "AO", "Antigua and Barbuda": "AG",
    "Bahamas": "BS", "The Bahamas": "BS", "Barbados": "BB", "Belarus": "BY",
    "Belize": "BZ", "Benin": "BJ", "Bhutan": "BT", "Bosnia and Herzegovina": "BA",
    "Botswana": "BW", "Burkina Faso": "BF", "Burundi": "BI", "Cabo Verde": "CV",
    "Cape Verde": "CV", "Central African Republic": "CF", "Chad": "TD",
    "Comoros": "KM", "Cuba": "CU", "Djibouti": "DJ", "Dominica": "DM",
    "El Salvador": "SV", "Equatorial Guinea": "GQ", "Eritrea": "ER",
    "Eswatini": "SZ", "Swaziland": "SZ", "Fiji": "FJ", "Gabon": "GA",
    "The Gambia": "GM", "Gambia": "GM", "Grenada": "GD", "Guinea": "GN",
    "Guinea-Bissau": "GW", "Guyana": "GY", "Haiti": "HT", "Honduras": "HN",
    "Jamaica": "JM", "Kiribati": "KI", "Kyrgyzstan": "KG", "Lesotho": "LS",
    "Liberia": "LR", "Liechtenstein": "LI", "Madagascar": "MG", "Malawi": "MW",
    "Maldives": "MV", "Mali": "ML", "Marshall Islands": "MH", "Mauritania": "MR",
    "Mauritius": "MU", "Micronesia": "FM", "Moldova": "MD", "Monaco": "MC",
    "Montenegro": "ME", "Mozambique": "MZ", "Namibia": "NA", "Nauru": "NR",
    "Nicaragua": "NI", "Niger": "NE", "North Macedonia": "MK", "Palau": "PW",
    "Papua New Guinea": "PG", "Rwanda": "RW", "Samoa": "WS", "San Marino": "SM",
    "Sao Tome and Principe": "ST", "São Tomé and Príncipe": "ST",
    "Seychelles": "SC", "Sierra Leone": "SL", "Solomon Islands": "SB",
    "Somalia": "SO", "South Sudan": "SS", "Saint Kitts and Nevis": "KN",
    "Saint Lucia": "LC", "Saint Vincent and the Grenadines": "VC",
    "Suriname": "SR", "Tajikistan": "TJ", "Timor-Leste": "TL", "East Timor": "TL",
    "Togo": "TG", "Tonga": "TO", "Trinidad and Tobago": "TT",
    "Turkmenistan": "TM", "Tuvalu": "TV", "Vanuatu": "VU",
    "Vatican City": "VA", "Holy See": "VA", "Zambia": "ZM", "Zimbabwe": "ZW",
}
PLACE_ALIASES: dict[str, str] = {
    "Abu Dhabi": "AE", "ADGM": "AE", "Dubai": "AE", "DIFC": "AE",
    "Abu Dhabi Global Market": "AE", "Dubai International Financial Centre": "AE",
    "JAFZA": "AE", "DMCC": "AE", "RAKEZ": "AE",
    "Sharjah": "AE", "Ras Al Khaimah": "AE", "Ajman": "AE",
    "Mumbai": "IN", "Bombay": "IN", "Bengaluru": "IN", "Bangalore": "IN",
    "New Delhi": "IN", "Delhi": "IN", "Hyderabad": "IN", "Chennai": "IN",
    "Madras": "IN", "Gurugram": "IN", "Gurgaon": "IN", "Pune": "IN",
    "GIFT City": "IN", "GIFT IFSC": "IN", "Kolkata": "IN", "Ahmedabad": "IN",
    "Singapore": "SG", "Lagos": "NG", "Nairobi": "KE", "Johannesburg": "ZA",
    "Cape Town": "ZA", "Abuja": "NG", "Accra": "GH", "Kigali": "RW",
    "Sao Paulo": "BR", "Rio de Janeiro": "BR", "Brasilia": "BR",
    "Mexico City": "MX", "Bogota": "CO", "Santiago": "CL", "Buenos Aires": "AR",
    "New York": "US", "New York City": "US", "San Francisco": "US",
    "Los Angeles": "US", "Chicago": "US", "Boston": "US", "Miami": "US",
    "Washington DC": "US", "Silicon Valley": "US", "Austin": "US",
    "London": "GB", "Manchester": "GB", "Paris": "FR", "Frankfurt": "DE",
    "Berlin": "DE", "Munich": "DE", "Zurich": "CH", "Geneva": "CH",
    "Amsterdam": "NL", "Luxembourg City": "LU", "Dublin": "IE", "Milan": "IT",
    "Madrid": "ES", "Stockholm": "SE", "Copenhagen": "DK", "Brussels": "BE",
    "Hong Kong": "HK", "Tokyo": "JP", "Osaka": "JP", "Seoul": "KR",
    "Shanghai": "CN", "Beijing": "CN", "Shenzhen": "CN", "Sydney": "AU",
    "Melbourne": "AU", "Jakarta": "ID", "Kuala Lumpur": "MY", "Bangkok": "TH",
    "Manila": "PH", "Ho Chi Minh City": "VN", "Hanoi": "VN", "Taipei": "TW",
    "Riyadh": "SA", "Jeddah": "SA", "Doha": "QA", "Kuwait City": "KW",
    "Manama": "BH", "Muscat": "OM", "Cairo": "EG", "Casablanca": "MA",
    "Istanbul": "TR", "Tel Aviv": "IL", "Amman": "JO", "Las Vegas": "US",
}
REGIONAL_ROLLUPS: dict[str, set[str]] = {
    "GCC": {"AE", "BH", "KW", "OM", "QA", "SA"},
    "MENA": {
        "AE", "BH", "DZ", "EG", "IL", "IQ", "IR", "JO", "KW", "LB", "LY",
        "MA", "OM", "PS", "QA", "SA", "SD", "SY", "TN", "TR", "YE",
    },
    "ASEAN": {"BN", "ID", "KH", "LA", "MM", "MY", "PH", "SG", "TH", "VN"},
}
REGION_ALIASES = {
    "GCC": "GCC",
    "Gulf Cooperation Council": "GCC",
    "MENA": "MENA",
    "Middle East and North Africa": "MENA",
    "ASEAN": "ASEAN",
    "Southeast Asia": "ASEAN",
}
FINTECH_SUBTHEMES: dict[str, str] = {
    "payment": "payments", "payments": "payments", "payment processing": "payments",
    "digital payments": "payments", "lending": "lending",
    "wealthtech": "wealthtech", "wealth tech": "wealthtech",
    "insurtech": "insurtech", "insurance tech": "insurtech",
    "regtech": "regtech", "neobank": "neobank",
    "embedded finance": "embedded finance", "open banking": "open banking",
}
GENERIC_SUBTHEMES = {
    "healthcare", "health care", "hospital", "medical", "pharma", "pharmaceutical",
    "climate", "energy", "infrastructure", "technology", "tech company",
    "technology company", "software", "software company", "platform", "industrial",
    "manufacturing", "real estate", "property", "retail", "consumer goods",
    "consumer tech", "media", "entertainment", "financial technology", "fintech",
    "logistics", "transport", "agriculture", "farming", "education technology",
    "defence", "defense", "aerospace", "financial services",
}


def clean_title(title: str) -> str:
    return TITLE_PUBLISHER_SUFFIX.sub("", (title or "").strip()).strip()


def _ascii_fold(value: str) -> str:
    return "".join(
        char for char in unicodedata.normalize("NFKD", value)
        if not unicodedata.combining(char)
    )


def keyword_matches(text: str, keyword: str) -> bool:
    """Match a whole phrase; short uppercase acronyms stay case-sensitive."""
    folded_text = _ascii_fold(text)
    folded_keyword = _ascii_fold(keyword)
    flags = 0 if keyword.isupper() and len(keyword) <= 4 else re.IGNORECASE
    return re.search(r"(?<!\w)" + re.escape(folded_keyword) + r"(?!\w)", folded_text, flags) is not None


def has_deal_keyword(text: str) -> bool:
    return any(pattern.search(text or "") for pattern in DEAL_KEYWORD_PATTERNS)


def classify_countries(headline: str) -> list[str]:
    """Return ISO-3166 alpha-2 tags and matched regional roll-ups from headline evidence."""
    matches: set[str] = set()
    for alias, country_code in {**COUNTRY_ALIASES, **PLACE_ALIASES}.items():
        if keyword_matches(headline, alias):
            matches.add(country_code)
    for alias, region in REGION_ALIASES.items():
        if keyword_matches(headline, alias):
            matches.add(region)
    for region, member_codes in REGIONAL_ROLLUPS.items():
        if matches & member_codes:
            matches.add(region)
    if "GCC" in matches:
        matches.add("MENA")
    return sorted(matches)


def classify_sub_themes(
    headline: str,
    sectors: list[str],
    sector_keywords: dict[str, list[str]],
) -> list[str]:
    """Derive specific tags from existing sector keyword groups."""
    found: set[str] = set()
    for sector in sectors:
        keywords = sector_keywords.get(sector, [])
        if sector == "Fintech":
            candidates = FINTECH_SUBTHEMES
        else:
            candidates = {
                keyword: keyword.casefold()
                for keyword in keywords
                if keyword.casefold() not in GENERIC_SUBTHEMES
            }
        for keyword, canonical in candidates.items():
            if keyword_matches(headline, keyword):
                found.add(canonical)
    return sorted(found)


def tag_deal_item(item: dict[str, Any], sector_keywords: dict[str, list[str]]) -> dict[str, Any]:
    title = clean_title(str(item.get("title") or ""))
    sectors = list(item.get("sectors") or [])
    return {
        **item,
        "countries": classify_countries(title),
        "sub_themes": classify_sub_themes(title, sectors, sector_keywords),
    }


def parse_publisher(entry: dict[str, Any], feed_url: str) -> tuple[str, str]:
    """Return publisher label and domain, preferring Google News's <source>."""
    source = entry.get("source") or {}
    if not isinstance(source, dict):
        source = {}
    publisher = str(source.get("title") or entry.get("publisher") or "").strip()
    source_href = str(source.get("href") or "").strip()
    article_url = str(entry.get("link") or "").strip()

    def domain(url: str) -> str:
        host = urllib.parse.urlsplit(url).hostname or ""
        return host.lower().removeprefix("www.")

    publisher_domain = domain(source_href) or domain(article_url)
    if publisher_domain == "news.google.com":
        publisher_domain = ""
    feed_domain = domain(feed_url)
    if feed_domain == "news.google.com":
        feed_domain = ""
    if not publisher:
        publisher = publisher_domain or feed_domain or "Unknown"
    if not publisher_domain:
        publisher_domain = feed_domain
    return publisher, publisher_domain


def normalize_title(title: str) -> str:
    title = clean_title(title).casefold()
    tokens = re.findall(r"[a-z0-9]+", title)
    return " ".join(token for token in tokens if token not in DEAL_STOP_WORDS)


def token_set_similarity(left: str, right: str) -> float:
    left_tokens = set(normalize_title(left).split())
    right_tokens = set(normalize_title(right).split())
    if not left_tokens or not right_tokens:
        return 1.0 if left_tokens == right_tokens else 0.0
    return len(left_tokens & right_tokens) / len(left_tokens | right_tokens)


def parse_deal_value_usd(title: str) -> float | None:
    """Parse explicitly USD-denominated headline values; do not guess FX."""
    match = VALUE_PATTERN.search(title or "") or VALUE_CODE_PATTERN.search(title or "")
    if not match:
        return None
    try:
        value = float(match.group(1).replace(",", ""))
    except ValueError:
        return None
    multiplier = (match.group(2) or "").lower()
    if multiplier in {"billion", "bn", "b"}:
        value *= 1_000_000_000
    elif multiplier in {"million", "mn", "m"}:
        value *= 1_000_000
    elif multiplier in {"thousand", "k"}:
        value *= 1_000
    return value


def publisher_key(domain: str) -> str:
    normalized = (domain or "").lower().removeprefix("www.")
    return "wire-service" if normalized in WIRE_DOMAINS else normalized


def assign_cluster_ids(
    items: list[dict[str, Any]],
    existing_items: list[dict[str, Any]],
    similarity_threshold: float = 0.8,
    max_days: int = 7,
) -> list[dict[str, Any]]:
    """Attach items to similar title clusters published within seven days."""
    known = [dict(item) for item in existing_items]
    cluster_dates: dict[str, list[datetime]] = defaultdict(list)
    for item in known:
        cluster_id = item.get("cluster_id")
        published_at = parse_datetime(item.get("published_at"))
        if cluster_id and published_at:
            cluster_dates[str(cluster_id)].append(published_at)
    assigned: list[dict[str, Any]] = []
    ordered = sorted(items, key=lambda item: item["published_at"])
    for original in ordered:
        item = dict(original)
        item["normalized_title"] = item.get("normalized_title") or normalize_title(item["title"])
        if item.get("cluster_id"):
            known.append(item)
            cluster_dates[str(item["cluster_id"])].append(item["published_at"])
            assigned.append(item)
            continue
        best: tuple[float, str] | None = None
        for previous in known:
            previous_date = previous.get("published_at")
            if isinstance(previous_date, str):
                previous_date = parse_datetime(previous_date)
            if not previous_date:
                continue
            if abs((item["published_at"] - previous_date).total_seconds()) > max_days * 86400:
                continue
            previous_cluster = previous.get("cluster_id")
            cluster_published = cluster_dates.get(str(previous_cluster), [])
            if cluster_published and (
                max(cluster_published + [item["published_at"]])
                - min(cluster_published + [item["published_at"]])
            ).total_seconds() > max_days * 86400:
                continue
            similarity = token_set_similarity(item["normalized_title"], previous.get("normalized_title", ""))
            if similarity >= similarity_threshold and previous_cluster:
                candidate = (similarity, str(previous_cluster))
                if best is None or candidate[0] > best[0]:
                    best = candidate
        item["cluster_id"] = best[1] if best else str(uuid.uuid4())
        known.append(item)
        cluster_dates[str(item["cluster_id"])].append(item["published_at"])
        assigned.append(item)
    return assigned


def parse_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)
    except ValueError:
        return None


def prepare_item(item: dict[str, Any], now: datetime | None = None) -> dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    first_seen = parse_datetime(item.get("first_seen_at")) or now
    published = parse_datetime(item.get("published_at") or item.get("date"))
    estimated = published is None or bool(item.get("date_is_estimated"))
    if published is None:
        published = first_seen
    title = clean_title(item.get("title", ""))
    publisher = item.get("publisher") or item.get("source") or "Unknown"
    publisher_domain = (item.get("publisher_domain") or "").lower().removeprefix("www.")
    return {
        **item,
        "title": title,
        "normalized_title": normalize_title(title),
        "publisher": publisher,
        "publisher_domain": publisher_domain,
        "published_at": published,
        "first_seen_at": first_seen,
        "date_is_estimated": estimated,
        "deal_value_usd": item.get("deal_value_usd", parse_deal_value_usd(title)),
        "deal_status": item.get("deal_status") or classify_status(title),
        "deal_type": item.get("deal_type") or classify_deal_type(title),
        "buyer_type": item.get("buyer_type") or classify_buyer_type(title),
        "countries": classify_countries(title),
    }


def classify_deal_type(title: str) -> str:
    text = title.casefold()
    if re.search(r"\b(merger|merges|merged)\b", text):
        return "Merger"
    if re.search(r"\b(carve[- ]out|spin[- ]off|divestiture)\b", text):
        return "Carve-out"
    if re.search(r"\b(ipo|initial public offering)\b", text):
        return "IPO"
    if re.search(r"\b(stake|minority|majority|equity investment)\b", text):
        return "Stake"
    if re.search(r"\b(acquir|acquisition|buyout|take private|purchase|bought)\b", text):
        return "Acquisition"
    return "Other"


def classify_buyer_type(title: str) -> str:
    text = title.casefold()
    if re.search(r"\b(sovereign wealth|sovereign fund|swf|state-owned fund)\b", text):
        return "SWF"
    if re.search(r"\b(private equity|buyout|lbo|take private)\b", text):
        return "PE"
    if re.search(r"\b(series [a-f]|venture capital|vc fund|seed round)\b", text):
        return "VC"
    if re.search(r"\b(acquir|acquisition|merger|strategic buyer)\b", text):
        return "Strategic"
    return "Unknown"


def classify_status(title: str) -> str:
    text = title.casefold()
    if re.search(r"\b(rumou?r|speculation|considering|in talks|exploring)\b", text):
        return "rumor"
    if re.search(r"\b(completed|completes|closed|finalized|finalised)\b", text):
        return "confirmed"
    return "reported"


def _fetch_rows(client: Any, table_name: str, columns: str, since: datetime | None = None) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        query = client.table(table_name).select(columns)
        if since is not None:
            query = query.gte("published_at", since.isoformat())
        response = query.range(offset, offset + 999).execute()
        batch = response.data or []
        rows.extend(batch)
        if len(batch) < 1000:
            return rows
        offset += 1000


def _fetch_rows_for_urls(
    client: Any,
    table_name: str,
    columns: str,
    urls: list[str],
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for start in range(0, len(urls), 100):
        response = (
            client.table(table_name)
            .select(columns)
            .in_("url", urls[start:start + 100])
            .execute()
        )
        rows.extend(response.data or [])
    return rows


def persist_deal_items(
    client: Any,
    candidates: list[dict[str, Any]],
    now: datetime | None = None,
    sector_keywords: dict[str, list[str]] | None = None,
) -> int:
    """Upsert raw article rows and one canonical deal row per matched cluster."""
    if not candidates:
        return 0
    now = now or datetime.now(timezone.utc)
    prepared = [
        prepare_item(
            tag_deal_item(item, sector_keywords) if sector_keywords is not None else item,
            now,
        )
        for item in candidates
        if item.get("url") and item.get("title")
    ]
    if not prepared:
        return 0

    unique_by_url: dict[str, dict[str, Any]] = {}
    for item in prepared:
        unique_by_url[item["url"]] = item
    prepared = list(unique_by_url.values())
    existing_items = _fetch_rows(
        client,
        "deal_items",
        "url,title,normalized_title,published_at,first_seen_at,date_is_estimated,publisher,publisher_domain,cluster_id,sectors,countries,sub_themes,deal_type,buyer_type,deal_value_usd,deal_status",
        now - timedelta(days=372),
    )
    existing_items.extend(_fetch_rows_for_urls(
        client,
        "deal_items",
        "url,title,normalized_title,published_at,first_seen_at,date_is_estimated,publisher,publisher_domain,cluster_id,sectors,countries,sub_themes,deal_type,buyer_type,deal_value_usd,deal_status",
        [item["url"] for item in prepared],
    ))
    existing_items = list({item["url"]: item for item in existing_items}.values())
    legacy_deals = _fetch_rows(
        client,
        "deals",
        "cluster_id,title,normalized_title,published_at,date_is_estimated,source,publisher_domains,sectors,countries,sub_themes,deal_type,buyer_type,deal_value_usd,deal_status,times_seen",
        now - timedelta(days=372),
    )
    existing_items.extend(
        {
            **deal,
            "url": "",
            "publisher_domain": "",
            "normalized_title": deal.get("normalized_title") or normalize_title(deal.get("title", "")),
        }
        for deal in legacy_deals
        if deal.get("cluster_id")
    )
    existing_by_url = {item["url"]: item for item in existing_items}
    for item in prepared:
        existing = existing_by_url.get(item["url"])
        if existing:
            item["first_seen_at"] = parse_datetime(existing.get("first_seen_at")) or item["first_seen_at"]
            item["cluster_id"] = existing.get("cluster_id")
            if existing.get("date_is_estimated") and item.get("date_is_estimated"):
                item["published_at"] = parse_datetime(existing.get("published_at")) or item["published_at"]

    assigned = assign_cluster_ids(prepared, existing_items)
    item_rows = []
    for item in assigned:
        item_rows.append({
            "url": item["url"],
            "item_key": item["url"],
            "title": item["title"],
            "normalized_title": item["normalized_title"],
            "publisher": item["publisher"],
            "publisher_domain": item["publisher_domain"],
            "source": item["publisher"],
            "published_at": item["published_at"].isoformat(),
            "published_date": item["published_at"].date().isoformat(),
            "first_seen_at": item["first_seen_at"].isoformat(),
            "first_seen": item["first_seen_at"].isoformat(),
            "date_is_estimated": item["date_is_estimated"],
            "deal_type": item["deal_type"],
            "buyer_type": item["buyer_type"],
            "deal_value_usd": item["deal_value_usd"],
            "deal_status": item["deal_status"],
            "cluster_id": item["cluster_id"],
            "countries": item.get("countries", []),
            "sectors": item.get("sectors", []),
            "sub_themes": item.get("sub_themes", []),
            "feed_role": item.get("feed_role", "deal_source"),
            "feed_url": item.get("feed_url"),
            "last_seen_at": now.isoformat(),
        })
    client.table("deal_items").upsert(item_rows, on_conflict="url").execute()

    items_by_cluster: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in assigned:
        items_by_cluster[item["cluster_id"]].append(item)
    existing_by_cluster: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in existing_items:
        if item.get("cluster_id"):
            existing_by_cluster[str(item["cluster_id"])].append(item)

    deal_rows = []
    for cluster_id, incoming in items_by_cluster.items():
        cluster_items_by_url = {
            item.get("url") or f"legacy-{index}": item
            for index, item in enumerate(existing_by_cluster[cluster_id] + incoming)
        }
        cluster_items = list(cluster_items_by_url.values())
        legacy = next((item for item in cluster_items if not item.get("url")), {})
        dated_items = [item for item in cluster_items if item.get("url")]
        representative = min(
            dated_items or cluster_items,
            key=lambda item: parse_datetime(item.get("published_at")) or now,
        )
        publisher_domains = sorted({
            publisher_key(str(item.get("publisher_domain") or ""))
            for item in cluster_items
            if item.get("publisher_domain")
        } | {
            publisher_key(domain)
            for item in cluster_items
            for domain in item.get("publisher_domains", [])
            if domain
        })
        sectors = sorted({value for item in cluster_items for value in item.get("sectors", [])})
        countries = sorted({value for item in cluster_items for value in item.get("countries", [])})
        sub_themes = sorted({value for item in cluster_items for value in item.get("sub_themes", [])})
        published_at = parse_datetime(representative.get("published_at")) or now
        original_item = incoming[0]
        deal_value = next((item.get("deal_value_usd") for item in cluster_items if item.get("deal_value_usd") is not None), None)
        deal_rows.append({
            "cluster_id": cluster_id,
            "deal_key": cluster_id,
            "title": representative.get("title") or legacy.get("title") or original_item["title"],
            "normalized_title": representative.get("normalized_title") or legacy.get("normalized_title") or original_item["normalized_title"],
            "url": representative.get("url") or legacy.get("url") or original_item["url"],
            "source": ", ".join(publisher_domains),
            "publisher_domains": publisher_domains,
            "distinct_source_count": len(publisher_domains),
            "published_at": published_at.isoformat(),
            "published_date": published_at.date().isoformat(),
            "date_is_estimated": all(bool(item.get("date_is_estimated")) for item in cluster_items),
            "deal_type": original_item["deal_type"],
            "buyer_type": original_item["buyer_type"],
            "deal_size_usd": deal_value,
            "deal_value_usd": deal_value,
            "deal_status": original_item["deal_status"],
            "sector": sectors[0] if sectors else None,
            "sectors": sectors,
            "sub_sector": sub_themes[0] if sub_themes else None,
            "sub_themes": sub_themes,
            "geography": countries[0] if countries else None,
            "countries": countries,
            "feed_role": "deal_source",
            "status": "NEW",
            "times_seen": max(int(legacy.get("times_seen") or 0), len(dated_items)),
            "mention_count": max(int(legacy.get("times_seen") or 0), len(dated_items)),
            "created_at": min(
                (parse_datetime(item.get("first_seen_at")) or now for item in cluster_items),
                default=now,
            ).isoformat(),
            "last_seen_at": now.isoformat(),
        })
    client.table("deals").upsert(deal_rows, on_conflict="cluster_id").execute()
    return len(assigned)


def compute_sector_counts(
    deals: list[dict[str, Any]],
    now: datetime | None = None,
    known_sectors: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Aggregate canonical deals into rolling windows and 12 calendar months."""
    now = now or datetime.now(timezone.utc)
    cutoff_30 = now - timedelta(days=30)
    cutoff_90 = now - timedelta(days=90)
    cutoff_180 = now - timedelta(days=180)
    month_keys = []
    month_start = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
    for offset in range(11, -1, -1):
        index = month_start.year * 12 + month_start.month - 1 - offset
        year, month_zero = divmod(index, 12)
        month_keys.append((year, month_zero + 1))

    counts: dict[str, dict[str, Any]] = defaultdict(lambda: {
        "count_30d": 0, "count_90d": 0, "count_prior_90d": 0, "monthly": defaultdict(int),
    })
    for sector in known_sectors or []:
        counts[sector]
    seen: set[str] = set()
    for deal in deals:
        cluster_id = str(deal.get("cluster_id") or deal.get("deal_key") or deal.get("id") or "")
        if cluster_id and cluster_id in seen:
            continue
        if cluster_id:
            seen.add(cluster_id)
        published_at = parse_datetime(deal.get("published_at") or deal.get("published_date"))
        if not published_at:
            continue
        sectors = deal.get("sectors") or ([deal["sector"]] if deal.get("sector") else [])
        for sector in set(sectors):
            sector_counts = counts[sector]
            if published_at >= cutoff_30:
                sector_counts["count_30d"] += 1
            if published_at >= cutoff_90:
                sector_counts["count_90d"] += 1
            elif published_at >= cutoff_180:
                sector_counts["count_prior_90d"] += 1
            month_key = (published_at.year, published_at.month)
            if month_key in month_keys:
                sector_counts["monthly"][month_key] += 1

    output = []
    for sector, data in counts.items():
        monthly_counts = [
            {"month": datetime(year, month, 1).strftime("%b %Y"), "count": data["monthly"].get((year, month), 0)}
            for year, month in month_keys
        ]
        output.append({
            "sector": sector,
            "count_30d": data["count_30d"],
            "count_90d": data["count_90d"],
            "count_prior_90d": data["count_prior_90d"],
            "monthly_counts": monthly_counts,
            "updated_at": now.isoformat(),
        })
    return output


def refresh_sector_trends(client: Any, now: datetime | None = None) -> list[dict[str, Any]]:
    now = now or datetime.now(timezone.utc)
    deals = _fetch_rows(client, "deals", "id,cluster_id,deal_key,published_at,published_date,sector,sectors", now - timedelta(days=366))
    known_trends = _fetch_rows(client, "sector_trends", "sector")
    rows = compute_sector_counts(deals, now, [row["sector"] for row in known_trends])
    if rows:
        client.table("sector_trends").upsert(rows, on_conflict="sector").execute()
    return rows
