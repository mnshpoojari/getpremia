-- Premia deals table
-- Run this once in the Supabase SQL editor before running the ingestion script.

CREATE TABLE IF NOT EXISTS deals (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title               TEXT NOT NULL,
  url                 TEXT NOT NULL,
  source              TEXT,
  published_date      DATE,
  sector              TEXT,
  sub_sector          TEXT,
  geography           TEXT,
  buyer_name          TEXT,
  buyer_type          TEXT CHECK (buyer_type IN ('PE', 'Strategic', 'SWF', 'VC', 'Unknown')),
  target_name         TEXT,
  deal_size_usd       NUMERIC,
  deal_type           TEXT CHECK (deal_type IN ('Acquisition', 'Stake', 'Merger', 'Carve-out', 'IPO', 'Other')),
  status              TEXT DEFAULT 'NEW' CHECK (status IN ('NEW', 'ONGOING')),
  -- Legacy dedup counter retained for older rows. New ingestion writes times_seen.
  mention_count       INTEGER DEFAULT 1,
  times_seen          INTEGER DEFAULT 1,
  distinct_source_count INTEGER DEFAULT 1,
  deal_key            TEXT UNIQUE,
  feed_role           TEXT CHECK (feed_role IN ('deal_source', 'narrative_source', 'both')),
  feed_region         TEXT,
  feed_sector         TEXT,
  feed_url            TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feed_items (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  item_key       TEXT UNIQUE NOT NULL,
  title          TEXT NOT NULL,
  url            TEXT NOT NULL,
  source         TEXT,
  published_date DATE,
  snippet        TEXT,
  feed_url       TEXT,
  feed_role      TEXT NOT NULL CHECK (feed_role IN ('deal_source', 'narrative_source', 'both')),
  feed_region    TEXT,
  feed_sector    TEXT,
  tier           INTEGER,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feed_health (
  feed_url                TEXT PRIMARY KEY,
  last_success_at         TIMESTAMPTZ,
  last_attempt_at         TIMESTAMPTZ,
  consecutive_failures    INTEGER NOT NULL DEFAULT 0,
  items_returned_last_run INTEGER NOT NULL DEFAULT 0,
  feed_role               TEXT CHECK (feed_role IN ('deal_source', 'narrative_source', 'both')),
  region                  TEXT,
  sector                  TEXT,
  tier                    INTEGER
);

ALTER TABLE deals ADD COLUMN IF NOT EXISTS times_seen INTEGER DEFAULT 1;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS distinct_source_count INTEGER DEFAULT 1;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS feed_role TEXT CHECK (feed_role IN ('deal_source', 'narrative_source', 'both'));
ALTER TABLE deals ADD COLUMN IF NOT EXISTS feed_region TEXT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS feed_sector TEXT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS feed_url TEXT;

-- Backfill the canonical dedup counter from the legacy column.
UPDATE deals
SET times_seen = COALESCE(times_seen, mention_count, 1)
WHERE times_seen IS NULL OR times_seen = 1;

CREATE INDEX IF NOT EXISTS idx_deals_sector         ON deals(sector);
CREATE INDEX IF NOT EXISTS idx_deals_geography      ON deals(geography);
CREATE INDEX IF NOT EXISTS idx_deals_published_date ON deals(published_date);
CREATE INDEX IF NOT EXISTS idx_deals_deal_key       ON deals(deal_key);
CREATE INDEX IF NOT EXISTS idx_deals_feed_role      ON deals(feed_role);
CREATE INDEX IF NOT EXISTS idx_deals_distinct_source_count ON deals(distinct_source_count);

CREATE INDEX IF NOT EXISTS idx_feed_items_feed_role      ON feed_items(feed_role);
CREATE INDEX IF NOT EXISTS idx_feed_items_feed_region    ON feed_items(feed_region);
CREATE INDEX IF NOT EXISTS idx_feed_items_feed_sector    ON feed_items(feed_sector);
CREATE INDEX IF NOT EXISTS idx_feed_items_published_date ON feed_items(published_date);
CREATE INDEX IF NOT EXISTS idx_feed_items_source         ON feed_items(source);
CREATE INDEX IF NOT EXISTS idx_feed_health_failures      ON feed_health(consecutive_failures);
