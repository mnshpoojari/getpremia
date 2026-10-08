BEGIN;

ALTER TABLE deal_items
  ADD COLUMN IF NOT EXISTS is_deal BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS deal_classification_reason TEXT;

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS is_deal BOOLEAN NOT NULL DEFAULT TRUE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'deal_items_classification_reason_check'
      AND conrelid = 'deal_items'::regclass
  ) THEN
    ALTER TABLE deal_items
      ADD CONSTRAINT deal_items_classification_reason_check
      CHECK (
        deal_classification_reason IS NULL
        OR deal_classification_reason IN (
          'listicle', 'market_report', 'opinion', 'not_a_transaction'
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_deal_items_is_deal_published_at
  ON deal_items(is_deal, published_at DESC);

COMMIT;
