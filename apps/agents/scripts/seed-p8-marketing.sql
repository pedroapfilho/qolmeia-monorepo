-- P8 adds the Marketing Strategist Worker to the demo team, alongside
-- the Designer from P3. The Correspondent's delegation graph grows to
-- include both workers; nothing else changes.
--
-- Idempotent — safe to re-run.
--
--   wrangler d1 execute qolmeia-agents --local  --file scripts/seed-p8-marketing.sql
--   wrangler d1 execute qolmeia-agents --remote --file scripts/seed-p8-marketing.sql

INSERT OR IGNORE INTO agent_instance
  (id, company_id, role, template_id, template_version, display_name,
   model_override, status, created_at, updated_at)
VALUES
  ('worker-tpl-marketing-strategist-cmpg10ke30000147uj4gpeadb',
   'cmpg10ke30000147uj4gpeadb',
   'worker', 'tpl-marketing-strategist', 1, 'Marketing Strategist', NULL, 'active',
   unixepoch() * 1000, unixepoch() * 1000);

INSERT OR IGNORE INTO team_member (team_id, agent_instance_id, can_delegate_to) VALUES
  ('team-cmpg10ke30000147uj4gpeadb',
   'worker-tpl-marketing-strategist-cmpg10ke30000147uj4gpeadb',
   '[]');

-- Extend the Correspondent's delegation graph to include the new worker.
-- (Existing seed-p3-team.sql wrote a row with just the Designer; we
-- replace it to include both workers.)
UPDATE team_member
SET can_delegate_to = '["worker-tpl-designer-cmpg10ke30000147uj4gpeadb","worker-tpl-marketing-strategist-cmpg10ke30000147uj4gpeadb"]'
WHERE team_id = 'team-cmpg10ke30000147uj4gpeadb'
  AND agent_instance_id = 'corr-cmpg10ke30000147uj4gpeadb';
