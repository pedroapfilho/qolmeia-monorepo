-- P1 hard-coded demo company. P1 has no onboarding yet (Planner arrives in P5),
-- so the single tenant is seeded directly. Idempotent — safe to re-run.
--
--   wrangler d1 execute qolmeia-agents --local  --file scripts/seed-p1.sql
--   wrangler d1 execute qolmeia-agents --remote --file scripts/seed-p1.sql

INSERT OR IGNORE INTO company
  (id, name, slug, timezone, locale, status, brief, created_at, updated_at)
VALUES
  ('p1-demo-company', 'Qolmeia Demo', 'demo', 'America/Sao_Paulo', 'pt-BR',
   'active', NULL, unixepoch() * 1000, unixepoch() * 1000);
