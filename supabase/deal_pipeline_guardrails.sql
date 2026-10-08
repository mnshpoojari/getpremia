-- Review this migration before applying it in Supabase. This file is not run by
-- the ingestion pipeline or application.
BEGIN;

ALTER TABLE feed_items
  ADD COLUMN IF NOT EXISTS publisher_domain TEXT,
  ADD COLUMN IF NOT EXISTS is_deal BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reject_reason TEXT;

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS publisher_domain TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'feed_items_reject_reason_check'
      AND conrelid = 'feed_items'::regclass
  ) THEN
    ALTER TABLE feed_items
      ADD CONSTRAINT feed_items_reject_reason_check
      CHECK (
        reject_reason IS NULL
        OR reject_reason IN ('listicle', 'market_report', 'opinion', 'not_a_transaction')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_feed_items_is_deal_published_date
  ON feed_items(is_deal, published_date DESC);

COMMIT;
