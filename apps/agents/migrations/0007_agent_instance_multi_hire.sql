-- 0007_agent_instance_multi_hire.sql
-- Removes the UNIQUE(company_id, role, template_id) constraint from
-- agent_instance so that multiple workers of the same template can coexist
-- per company (multi-hire). SQLite doesn't support DROP CONSTRAINT, so we
-- recreate the table without the constraint and copy all existing data.

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

PRAGMA foreign_keys = ON;
