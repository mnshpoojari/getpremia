-- Deal facts cache — buyer, target, size and rationale extracted from a deal article, keyed by article URL hash
-- result is either {"facts": {...}, "final_url": "..."} or {"no_text": true, "final_url": "..."}
-- Rows older than 14 days are deleted on write
-- Run in Supabase SQL editor

CREATE TABLE IF NOT EXISTS deal_facts_cache (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  url_hash TEXT NOT NULL UNIQUE,
  url TEXT NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE deal_facts_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read" ON deal_facts_cache
  FOR SELECT USING (true);

CREATE POLICY "Service role write" ON deal_facts_cache
  FOR ALL USING (auth.role() = 'service_role');
