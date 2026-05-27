-- P3 materializes the demo team for the seeded dev company.
-- Equivalent to `materializeTeam(db, { companyId, templateIds: ['tpl-designer'] })`
-- but issued as SQL so the seed is self-contained.
--
--   wrangler d1 execute worker-bees --local  --file scripts/seed-p3-team.sql
--   wrangler d1 execute worker-bees --remote --file scripts/seed-p3-team.sql

INSERT OR IGNORE INTO team (id, company_id, confirmed_at, created_at) VALUES
  ('team-cmpg10ke30000147uj4gpeadb', 'cmpg10ke30000147uj4gpeadb',
   unixepoch() * 1000, unixepoch() * 1000);

INSERT OR IGNORE INTO agent_instance
  (id, company_id, role, template_id, template_version, display_name,
   model_override, status, created_at, updated_at)
VALUES
  ('worker-tpl-designer-cmpg10ke30000147uj4gpeadb', 'cmpg10ke30000147uj4gpeadb',
   'worker', 'tpl-designer', 1, 'Designer', NULL, 'active',
   unixepoch() * 1000, unixepoch() * 1000);

INSERT OR IGNORE INTO team_member (team_id, agent_instance_id, can_delegate_to) VALUES
  ('team-cmpg10ke30000147uj4gpeadb',
   'corr-cmpg10ke30000147uj4gpeadb',
   '["worker-tpl-designer-cmpg10ke30000147uj4gpeadb"]'),
  ('team-cmpg10ke30000147uj4gpeadb',
   'worker-tpl-designer-cmpg10ke30000147uj4gpeadb',
   '[]');
