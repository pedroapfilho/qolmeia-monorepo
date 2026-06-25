-- Schema baseline. Squashed from the original P1–P12 migrations (no
-- production DB existed, so incremental history was collapsed). Schema
-- ONLY — default data lives in 0002_default_data.sql.

CREATE TABLE action (
  id                 TEXT PRIMARY KEY,
  ticket_id          TEXT NOT NULL REFERENCES ticket(id),
  company_id         TEXT NOT NULL REFERENCES company(id),
  action_type        TEXT NOT NULL,
  policy             TEXT NOT NULL,
  proposed           TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'approved', 'rejected',
                                       'changes_requested', 'executed')),
  decided_by_user_id TEXT,
  decided_at         INTEGER,
  feedback           TEXT,
  created_at         INTEGER NOT NULL
);

CREATE TABLE activity_log (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES company(id),
  type       TEXT NOT NULL,
  ref_type   TEXT,
  ref_id     TEXT,
  summary    TEXT NOT NULL,    
  payload    TEXT,
  actor_id   TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE "agent_instance" (
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

CREATE TABLE "asset" (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES company(id),
  kind       TEXT NOT NULL
             CHECK (kind IN ('generated_image', 'knowledge_doc', 'audio', 'brand_asset', 'user_upload')),
  r2_key     TEXT NOT NULL,
  sha256     TEXT NOT NULL,
  mime       TEXT NOT NULL,
  bytes      INTEGER NOT NULL,
  metadata   TEXT,
  created_at INTEGER NOT NULL, visibility TEXT NOT NULL DEFAULT 'customer'
    CHECK (visibility IN ('customer', 'agent')),
  UNIQUE (company_id, sha256)
);

CREATE TABLE company (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  slug       TEXT UNIQUE NOT NULL,
  timezone   TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  locale     TEXT NOT NULL DEFAULT 'pt-BR',
  status     TEXT NOT NULL DEFAULT 'onboarding'
             CHECK (status IN ('onboarding', 'active', 'paused')),
  brief      TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE memory_fact (
  id                TEXT PRIMARY KEY,
  company_id        TEXT NOT NULL REFERENCES company(id),
  agent_instance_id TEXT NOT NULL REFERENCES agent_instance(id),
  kind              TEXT NOT NULL,
  content           TEXT NOT NULL,
  salience          REAL NOT NULL DEFAULT 0.5,
  created_at        INTEGER NOT NULL
);

CREATE TABLE operator_assignment (
  id               TEXT PRIMARY KEY,
  operator_user_id TEXT NOT NULL,
  kind             TEXT NOT NULL CHECK (kind IN ('company', 'discipline')),
  value            TEXT NOT NULL,
  created_at       INTEGER NOT NULL,
  UNIQUE (operator_user_id, kind, value)
);

CREATE TABLE skill (
  id             TEXT PRIMARY KEY,         
  display_name   TEXT NOT NULL,
  description    TEXT NOT NULL,            
  param_hints    TEXT,                     
  default_config TEXT,                     
  enabled        INTEGER NOT NULL DEFAULT 1,
  updated_at     INTEGER NOT NULL
);

CREATE TABLE team (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL UNIQUE REFERENCES company(id),
  confirmed_at INTEGER,
  created_at   INTEGER NOT NULL
);

CREATE TABLE team_member (
  team_id           TEXT NOT NULL REFERENCES team(id),
  agent_instance_id TEXT NOT NULL REFERENCES agent_instance(id),
  can_delegate_to   TEXT NOT NULL DEFAULT '[]', 
  PRIMARY KEY (team_id, agent_instance_id)
);

CREATE TABLE template (
  id               TEXT PRIMARY KEY,
  worker_kind      TEXT NOT NULL,
  display_name     TEXT NOT NULL,
  description      TEXT NOT NULL,
  system_prompt    TEXT NOT NULL,
  model            TEXT NOT NULL,
  skill_ids        TEXT NOT NULL,    
  default_policies TEXT NOT NULL,    
  status           TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'retired')),
  version          INTEGER NOT NULL DEFAULT 1,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
, default_action_type TEXT NOT NULL DEFAULT 'worker_deliverable');

CREATE TABLE ticket (
  id                TEXT PRIMARY KEY,
  company_id        TEXT NOT NULL REFERENCES company(id),
  agent_instance_id TEXT NOT NULL REFERENCES agent_instance(id),
  parent_ticket_id  TEXT REFERENCES ticket(id),
  title             TEXT NOT NULL,
  brief             TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'in_progress', 'awaiting_approval',
                                      'blocked', 'done', 'rejected', 'cancelled')),
  origin            TEXT NOT NULL
                    CHECK (origin IN ('user', 'delegation', 'scheduled')),
  workflow_id       TEXT,
  result            TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE INDEX idx_action_company_status_age
  ON action (company_id, status, created_at);
CREATE INDEX idx_activity_log_company_time
  ON activity_log (company_id, created_at);
CREATE INDEX idx_memory_fact_agent_time
  ON memory_fact (agent_instance_id, created_at);
CREATE INDEX idx_operator_assignment_user ON operator_assignment (operator_user_id);
CREATE INDEX idx_ticket_company_agent_status
  ON ticket (company_id, agent_instance_id, status);
