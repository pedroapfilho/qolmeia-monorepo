-- P2 seeds the demo company aligned with the auth Organization row, plus the
-- Correspondent agent_instance that memory_fact's FK requires. The
-- Organization.id is shared between Postgres (auth) and D1 (platform); no
-- onboarding flow yet — P5 makes this dynamic.
--
-- Idempotent — safe to re-run.
--
--   wrangler d1 execute worker-bees --local  --file scripts/seed-p2.sql
--   wrangler d1 execute worker-bees --remote --file scripts/seed-p2.sql

INSERT OR IGNORE INTO company
  (id, name, slug, timezone, locale, status, brief, created_at, updated_at)
VALUES
  ('cmpg10ke30000147uj4gpeadb', 'Qolmeia Dev', 'qolmeia-dev',
   'America/Sao_Paulo', 'pt-BR', 'active', NULL,
   unixepoch() * 1000, unixepoch() * 1000);

INSERT OR IGNORE INTO agent_instance
  (id, company_id, role, template_id, template_version, display_name,
   model_override, status, created_at, updated_at)
VALUES
  ('corr-cmpg10ke30000147uj4gpeadb', 'cmpg10ke30000147uj4gpeadb',
   'correspondent', NULL, NULL, 'Correspondente Qolmeia',
   NULL, 'active',
   unixepoch() * 1000, unixepoch() * 1000);

INSERT OR IGNORE INTO company_template_entitlement
  (company_id, template_id, enabled, created_at, updated_at)
SELECT 'cmpg10ke30000147uj4gpeadb', id, 1, unixepoch() * 1000, unixepoch() * 1000
  FROM template
 WHERE status = 'active';
