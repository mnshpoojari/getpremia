BEGIN;

CREATE TABLE IF NOT EXISTS mentions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  normalized_title TEXT NOT NULL,
  publisher_domain TEXT,
  published_at TIMESTAMPTZ,
  countries TEXT[] NOT NULL DEFAULT '{}',
  sectors TEXT[] NOT NULL DEFAULT '{}',
  sub_themes TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mentions_published_at ON mentions(published_at);
CREATE INDEX IF NOT EXISTS idx_mentions_countries ON mentions USING GIN(countries);
CREATE INDEX IF NOT EXISTS idx_mentions_sectors ON mentions USING GIN(sectors);
CREATE INDEX IF NOT EXISTS idx_mentions_sub_themes ON mentions USING GIN(sub_themes);
CREATE INDEX IF NOT EXISTS idx_mentions_normalized_title ON mentions(normalized_title);

CREATE OR REPLACE VIEW market_coverage AS
WITH market_items AS (
  SELECT publisher_domain, countries, published_at
  FROM deal_items
  WHERE published_at >= NOW() - INTERVAL '90 days'
  UNION ALL
  SELECT publisher_domain, countries, published_at
  FROM mentions
  WHERE published_at >= NOW() - INTERVAL '90 days'
)
SELECT
  country_code,
  COUNT(*) AS deal_item_count,
  COUNT(DISTINCT NULLIF(lower(regexp_replace(publisher_domain, '^www[.]', '')), '')) AS publisher_domain_count,
  CASE
    WHEN COUNT(DISTINCT NULLIF(lower(regexp_replace(publisher_domain, '^www[.]', '')), '')) < 3 THEN 'low'
    WHEN COUNT(DISTINCT NULLIF(lower(regexp_replace(publisher_domain, '^www[.]', '')), '')) < 10 THEN 'medium'
    ELSE 'high'
  END AS coverage_level
FROM market_items
CROSS JOIN LATERAL unnest(market_items.countries) AS tags(country_code)
WHERE country_code ~ '^([A-Z]{2}|GCC|MENA|ASEAN)$'
GROUP BY country_code;

CREATE OR REPLACE FUNCTION mentions_90d(p_sector TEXT, p_country TEXT)
RETURNS TABLE (
  mentions_90d BIGINT,
  publishers_90d BIGINT,
  country_coverage_level TEXT,
  country_coverage_articles BIGINT,
  country_coverage_publishers BIGINT
)
LANGUAGE SQL
STABLE
AS $$
  SELECT
    COUNT(DISTINCT mention.normalized_title) AS mentions_90d,
    COUNT(DISTINCT NULLIF(lower(regexp_replace(mention.publisher_domain, '^www[.]', '')), '')) AS publishers_90d,
    COALESCE(coverage.coverage_level, 'low') AS country_coverage_level,
    COALESCE(coverage.deal_item_count, 0)::BIGINT AS country_coverage_articles,
    COALESCE(coverage.publisher_domain_count, 0)::BIGINT AS country_coverage_publishers
  FROM mentions AS mention
  LEFT JOIN market_coverage AS coverage
    ON coverage.country_code = upper(p_country)
  WHERE mention.published_at >= NOW() - INTERVAL '90 days'
    AND upper(p_country) = ANY(mention.countries)
    AND p_sector = ANY(mention.sectors)
  GROUP BY coverage.coverage_level, coverage.deal_item_count, coverage.publisher_domain_count
  UNION ALL
  SELECT 0, 0, COALESCE(coverage.coverage_level, 'low'),
         COALESCE(coverage.deal_item_count, 0)::BIGINT,
         COALESCE(coverage.publisher_domain_count, 0)::BIGINT
  FROM (SELECT 1) AS empty_result
  LEFT JOIN market_coverage AS coverage
    ON coverage.country_code = upper(p_country)
  WHERE NOT EXISTS (
    SELECT 1
    FROM mentions AS mention
    WHERE mention.published_at >= NOW() - INTERVAL '90 days'
      AND upper(p_country) = ANY(mention.countries)
      AND p_sector = ANY(mention.sectors)
  );
$$;

COMMIT;
