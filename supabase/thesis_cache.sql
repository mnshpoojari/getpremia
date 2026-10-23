-- Thesis cache — finished written thesis (text, sources list, meta) for the Conviction Validator
-- Cached per normalised thesis text x day; rows older than 7 days are deleted on write
-- Facts-only fallbacks and quota errors are never stored
-- Run in Supabase SQL editor

CREATE TABLE IF NOT EXISTS thesis_cache (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  thesis_key TEXT NOT NULL,
  day DATE NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(thesis_key, day)
);

ALTER TABLE thesis_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read" ON thesis_cache
  FOR SELECT USING (true);

CREATE POLICY "Service role write" ON thesis_cache
  FOR ALL USING (auth.role() = 'service_role');
