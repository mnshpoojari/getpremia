-- Create the per-publisher store, preserving existing feed_items during copy.
-- The migration aborts on source URL duplicates rather than deleting rows.
BEGIN;

CREATE TABLE IF NOT EXISTS deal_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  item_key TEXT UNIQUE,
  title TEXT NOT NULL,
  normalized_title TEXT,
  url TEXT NOT NULL,
  source TEXT,
  publisher TEXT,
  publisher_domain TEXT,
  published_date DATE,
  published_at TIMESTAMPTZ,
  first_seen TIMESTAMPTZ DEFAULT NOW(),
  first_seen_at TIMESTAMPTZ,
  date_is_estimated BOOLEAN NOT NULL DEFAULT FALSE,
  snippet TEXT,
  feed_url TEXT,
  feed_role TEXT NOT NULL DEFAULT 'deal_source',
  feed_region TEXT,
  feed_sector TEXT,
  tier INTEGER,
  deal_type TEXT,
  buyer_type TEXT,
  deal_value_usd NUMERIC,
  deal_status TEXT NOT NULL DEFAULT 'reported',
  cluster_id UUID DEFAULT gen_random_uuid(),
  countries TEXT[] NOT NULL DEFAULT '{}',
  sectors TEXT[] NOT NULL DEFAULT '{}',
  sub_themes TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE deal_items
  ADD COLUMN IF NOT EXISTS item_key TEXT,
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS published_date DATE,
  ADD COLUMN IF NOT EXISTS first_seen TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS snippet TEXT,
  ADD COLUMN IF NOT EXISTS feed_url TEXT,
  ADD COLUMN IF NOT EXISTS feed_role TEXT NOT NULL DEFAULT 'deal_source',
  ADD COLUMN IF NOT EXISTS feed_region TEXT,
  ADD COLUMN IF NOT EXISTS feed_sector TEXT,
  ADD COLUMN IF NOT EXISTS tier INTEGER,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS normalized_title TEXT,
  ADD COLUMN IF NOT EXISTS publisher TEXT,
  ADD COLUMN IF NOT EXISTS publisher_domain TEXT,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS date_is_estimated BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deal_type TEXT,
  ADD COLUMN IF NOT EXISTS buyer_type TEXT,
  ADD COLUMN IF NOT EXISTS deal_value_usd NUMERIC,
  ADD COLUMN IF NOT EXISTS deal_status TEXT NOT NULL DEFAULT 'reported',
  ADD COLUMN IF NOT EXISTS cluster_id UUID,
  ADD COLUMN IF NOT EXISTS countries TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS sectors TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS sub_themes TEXT[] NOT NULL DEFAULT '{}';

UPDATE deal_items
SET item_key = COALESCE(item_key, url);

ALTER TABLE deal_items
  ALTER COLUMN item_key SET NOT NULL;

UPDATE deal_items
SET first_seen_at = COALESCE(first_seen_at, first_seen, created_at, NOW()),
    published_at = COALESCE(published_at, published_date::TIMESTAMPTZ,
                            first_seen_at, first_seen, created_at, NOW()),
    date_is_estimated = CASE
      WHEN published_at IS NULL AND published_date IS NULL THEN TRUE
      ELSE date_is_estimated
    END,
    publisher = COALESCE(publisher, source);

ALTER TABLE deal_items
  ALTER COLUMN first_seen_at SET DEFAULT NOW(),
  ALTER COLUMN first_seen_at SET NOT NULL,
  ALTER COLUMN published_at SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'deal_items_deal_status_check'
      AND conrelid = 'deal_items'::regclass
  ) THEN
    ALTER TABLE deal_items
      ADD CONSTRAINT deal_items_deal_status_check
      CHECK (deal_status IN ('confirmed', 'reported', 'rumor'));
  END IF;

  IF EXISTS (SELECT 1 FROM deal_items GROUP BY url HAVING COUNT(*) > 1) THEN
    RAISE EXCEPTION 'deal_items contains duplicate URLs; inspect/resolve them before applying URL uniqueness';
  END IF;
  IF EXISTS (SELECT 1 FROM feed_items GROUP BY url HAVING COUNT(*) > 1) THEN
    RAISE EXCEPTION 'feed_items contains duplicate URLs; inspect/resolve them before copying to deal_items';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_deal_items_url_unique ON deal_items(url);
CREATE UNIQUE INDEX IF NOT EXISTS idx_deal_items_item_key_unique ON deal_items(item_key);
CREATE INDEX IF NOT EXISTS idx_deal_items_cluster_id ON deal_items(cluster_id);
CREATE INDEX IF NOT EXISTS idx_deal_items_published_at ON deal_items(published_at);
CREATE INDEX IF NOT EXISTS idx_deal_items_publisher_domain ON deal_items(publisher_domain);

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS cluster_id UUID DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS normalized_title TEXT,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS date_is_estimated BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deal_value_usd NUMERIC,
  ADD COLUMN IF NOT EXISTS deal_status TEXT NOT NULL DEFAULT 'reported',
  ADD COLUMN IF NOT EXISTS publisher_domains TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS countries TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS sectors TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS sub_themes TEXT[] NOT NULL DEFAULT '{}';

UPDATE deals
SET published_at = COALESCE(published_at, published_date::TIMESTAMPTZ, created_at, NOW()),
    date_is_estimated = CASE
      WHEN published_at IS NULL AND published_date IS NULL THEN TRUE
      ELSE date_is_estimated
    END;

ALTER TABLE deals
  ALTER COLUMN cluster_id SET NOT NULL,
  ALTER COLUMN published_at SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'deals_deal_status_check'
      AND conrelid = 'deals'::regclass
  ) THEN
    ALTER TABLE deals
      ADD CONSTRAINT deals_deal_status_check
      CHECK (deal_status IN ('confirmed', 'reported', 'rumor'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_deals_cluster_id_unique ON deals(cluster_id);
CREATE INDEX IF NOT EXISTS idx_deals_published_at ON deals(published_at);

ALTER TABLE sector_trends
  ADD COLUMN IF NOT EXISTS count_prior_90d INTEGER NOT NULL DEFAULT 0;

INSERT INTO deal_items (
  item_key, title, url, source, publisher, publisher_domain, published_date, published_at,
  first_seen, first_seen_at, date_is_estimated, snippet, feed_url, feed_role,
  feed_region, feed_sector, tier, cluster_id, created_at, last_seen_at
)
SELECT
  COALESCE(item_key, url),
  title,
  url,
  source,
  source,
  CASE
    WHEN split_part(split_part(url, '://', 2), '/', 1) NOT IN ('', 'news.google.com')
      THEN lower(regexp_replace(split_part(split_part(url, '://', 2), '/', 1), '^www[.]', ''))
    WHEN split_part(split_part(feed_url, '://', 2), '/', 1) NOT IN ('', 'news.google.com')
      THEN lower(regexp_replace(split_part(split_part(feed_url, '://', 2), '/', 1), '^www[.]', ''))
    ELSE NULL
  END,
  published_date,
  COALESCE(published_date::TIMESTAMPTZ, first_seen, created_at, NOW()),
  first_seen,
  COALESCE(first_seen, created_at, NOW()),
  published_date IS NULL,
  snippet,
  feed_url,
  feed_role,
  feed_region,
  feed_sector,
  tier,
  (
    SELECT deals.cluster_id
    FROM deals
    WHERE deals.url = feed_items.url
    ORDER BY deals.created_at
    LIMIT 1
  ),
  created_at,
  last_seen_at
FROM feed_items
WHERE feed_role IN ('deal_source', 'both')
ON CONFLICT (url) DO NOTHING;

UPDATE deal_items AS items
SET cluster_id = deals.cluster_id
FROM deals
WHERE items.cluster_id IS NULL
  AND items.url = deals.url;

UPDATE deal_items
SET cluster_id = gen_random_uuid()
WHERE cluster_id IS NULL;

ALTER TABLE deal_items
  ALTER COLUMN cluster_id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN cluster_id SET NOT NULL;

COMMIT;
