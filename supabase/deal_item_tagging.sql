BEGIN;

ALTER TABLE deal_items
  ADD COLUMN IF NOT EXISTS countries TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS sub_themes TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_deal_items_published_at
  ON deal_items(published_at);
CREATE INDEX IF NOT EXISTS idx_deal_items_countries
  ON deal_items USING GIN(countries);
CREATE INDEX IF NOT EXISTS idx_deal_items_sub_themes
  ON deal_items USING GIN(sub_themes);

CREATE OR REPLACE VIEW market_coverage AS
SELECT
  country_code,
  COUNT(*) AS deal_item_count,
  COUNT(DISTINCT NULLIF(publisher_domain, '')) AS publisher_domain_count
FROM deal_items
CROSS JOIN LATERAL unnest(deal_items.countries) AS tags(country_code)
WHERE published_at >= NOW() - INTERVAL '90 days'
  AND country_code ~ '^[A-Z]{2}$'
GROUP BY country_code;

COMMIT;
