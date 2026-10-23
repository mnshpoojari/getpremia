-- Evidence cache — sector research (regulators, acquirers, recent transactions) for the thesis writer
-- Cached per sector x geography x day; rows older than 7 days are deleted on write
-- Run in Supabase SQL editor

CREATE TABLE IF NOT EXISTS evidence_cache (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  sector TEXT NOT NULL,
  geography TEXT NOT NULL,
  day DATE NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(sector, geography, day)
);

ALTER TABLE evidence_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read" ON evidence_cache
  FOR SELECT USING (true);

CREATE POLICY "Service role write" ON evidence_cache
  FOR ALL USING (auth.role() = 'service_role');
