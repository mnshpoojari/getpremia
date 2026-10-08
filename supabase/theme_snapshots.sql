BEGIN;

CREATE OR REPLACE VIEW market_coverage AS
WITH deal_rows AS (
  SELECT id::TEXT AS item_id, publisher_domain, countries
  FROM deal_items
  WHERE published_at >= NOW() - INTERVAL '90 days'
),
tagged_items AS (
  SELECT item_id, publisher_domain, country_code
  FROM deal_rows
  CROSS JOIN LATERAL unnest(countries) AS tags(country_code)
  WHERE country_code ~ '^([A-Z]{2}|GCC|MENA|ASEAN|AFRICA|LATAM|EASTERN_EUROPE|CENTRAL_ASIA)$'
  UNION ALL
  SELECT item_id, publisher_domain, 'AFRICA'
  FROM deal_rows
  WHERE countries && ARRAY['AO','BF','BI','BJ','BW','CD','CF','CG','CI','CM','CV','DJ','DZ','EG','ER','ET','GA','GH','GM','GN','GQ','GW','KE','KM','LR','LS','LY','MA','MG','ML','MR','MU','MW','MZ','NA','NE','NG','RW','SC','SD','SN','SO','SS','ST','SZ','TD','TG','TN','TZ','UG','ZA','ZM','ZW']::TEXT[]
  UNION ALL
  SELECT item_id, publisher_domain, 'LATAM'
  FROM deal_rows
  WHERE countries && ARRAY['AR','BO','BR','CL','CO','CR','CU','DO','EC','GT','HN','MX','NI','PA','PE','PY','SV','UY','VE']::TEXT[]
  UNION ALL
  SELECT item_id, publisher_domain, 'EASTERN_EUROPE'
  FROM deal_rows
  WHERE countries && ARRAY['BG','BY','CZ','EE','HR','HU','LT','LV','MD','ME','MK','PL','RO','RS','RU','SI','SK','UA']::TEXT[]
  UNION ALL
  SELECT item_id, publisher_domain, 'CENTRAL_ASIA'
  FROM deal_rows
  WHERE countries && ARRAY['AM','AZ','GE','KG','KZ','TJ','TM','UZ']::TEXT[]
)
SELECT
  country_code,
  COUNT(DISTINCT item_id) AS deal_item_count,
  COUNT(DISTINCT NULLIF(lower(regexp_replace(publisher_domain, '^www[.]', '')), '')) AS publisher_domain_count,
  CASE
    WHEN COUNT(DISTINCT NULLIF(lower(regexp_replace(publisher_domain, '^www[.]', '')), '')) < 3 THEN 'low'
    WHEN COUNT(DISTINCT NULLIF(lower(regexp_replace(publisher_domain, '^www[.]', '')), '')) < 10 THEN 'medium'
    ELSE 'high'
  END AS coverage_level
FROM tagged_items
GROUP BY country_code;

CREATE TABLE IF NOT EXISTS theme_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  as_of DATE NOT NULL,
  sector TEXT NOT NULL,
  country TEXT,
  country_key TEXT GENERATED ALWAYS AS (COALESCE(country, '')) STORED,
  deals_90d INTEGER NOT NULL,
  deals_prior_90d INTEGER NOT NULL,
  mentions_90d INTEGER NOT NULL,
  publishers_90d INTEGER NOT NULL,
  country_coverage_items INTEGER NOT NULL,
  country_coverage_publishers INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (as_of, sector, country_key)
);

CREATE INDEX IF NOT EXISTS idx_theme_snapshots_latest
  ON theme_snapshots(as_of DESC, country, sector);

COMMIT;
