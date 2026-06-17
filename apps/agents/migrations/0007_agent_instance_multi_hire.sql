-- 0007_agent_instance_multi_hire.sql
-- Removes the UNIQUE(company_id, role, template_id) constraint from
-- agent_instance so that multiple workers of the same template can coexist
-- per company (multi-hire). SQLite doesn't support DROP CONSTRAINT, so we
-- recreate the table without the constraint and copy all existing data.
--
-- agent_instance has INBOUND foreign keys (team_member, ticket, memory_fact all
-- REFERENCE it). `PRAGMA defer_foreign_keys = ON` does NOT survive the
-- DROP TABLE + RENAME of a referenced table: it commits a phantom FOREIGN KEY
-- violation even though the rebuilt rows are clean (PRAGMA foreign_key_check
-- reports nothing). The canonical SQLite table-rebuild guard is
-- `PRAGMA foreign_keys = OFF` around the rebuild, re-enabled after — verified to
-- commit cleanly where the deferred form failed.
PRAGMA foreign_keys = OFF;

CREATE TABLE agent_instance_new (
  id               TEXT PRIMARY KEY,
  company_id       TEXT NOT NULL REFERENCES company(id),
  role             TEXT NOT NULL
                   CHECK (role IN ('planner', 'correspondent', 'worker')),
  template_id      TEXT REFERENCES template(id),
  template_version INTEGER,
  display_name     TEXT NOT NULL,
  model_override   TEXT,
  status           TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'paused')),
  prompt_override  TEXT,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

INSERT INTO agent_instance_new
  SELECT id, company_id, role, template_id, template_version,
         display_name, model_override, status, prompt_override,
         created_at, updated_at
  FROM agent_instance;

DROP TABLE agent_instance;
ALTER TABLE agent_instance_new RENAME TO agent_instance;

PRAGMA foreign_key_check;
PRAGMA foreign_keys = ON;
