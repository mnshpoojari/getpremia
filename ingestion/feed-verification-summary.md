# Feed Verification Summary

Verified from this workspace on 2026-07-05 using `feedparser` and HTTP probes.

## Included

| Feed | Role | Result |
| --- | --- | --- |
| `https://inc42.com/feed/` | both | Live RSS, 24 entries parsed. |
| `https://yourstory.com/feed` | both | Live RSS, 20 entries parsed. |
| `https://entrackr.com/rss` | both | Live RSS, 50 entries parsed. Used instead of dead `/feed/`. |
| `https://www.moneycontrol.com/rss/business.xml` | both | Live RSS/XML, 15 entries parsed. |
| `https://www.livemint.com/rss/companies` | both | Live RSS/XML, 35 entries parsed. |
| `https://www.medianama.com/feed/` | both | Live RSS, 10 entries parsed. |
| `https://technode.com/feed/` | both | Live RSS, 2000 entries parsed. |
| `https://e27.co/feed` | both | Live RSS, redirects to `index_wp.php/feed/`, 50 entries parsed. |
| `https://techcrunch.com/feed/` | narrative_source | Live RSS, 20 entries parsed. |
| `https://www.theverge.com/rss/index.xml` | narrative_source | Live RSS/XML, 10 entries parsed. |

## Dropped Or Deferred

| Feed | Reason |
| --- | --- |
| `https://entrackr.com/feed/` | HTTP 404. Replaced with `https://entrackr.com/rss`. |
| `https://kr-asia.com/company/china-tech` | HTML page, not RSS/Atom. |
| `https://kr-asia.com/feed` and `/rss` | Malformed/non-parseable content in `feedparser`. |
| `https://www.techinasia.com/rss` and `/feed` | HTTP 403 from this environment. |
| `https://www.arabianbusiness.com/rss` variants | HTTP 403 from this environment. |
| `https://www.zawya.com/rss/feed` variants | HTTP 404. |
| `https://www.meed.com/feed/` | Redirects to HTML home page, not a feed. |
| RBI RSS candidates | Returned error/HTML page, not RSS. Needs a small scraper for press releases. |
| NPCI RSS candidates | HTTP 403 from this environment. Needs a small scraper or approved endpoint. |

## Notes

Mainstream/generalist feeds are tagged `narrative_source` only. Deal-trade and specialist feeds are tagged `deal_source`; India/SEA startup verticals that can credibly contribute to both sides are tagged `both`.
