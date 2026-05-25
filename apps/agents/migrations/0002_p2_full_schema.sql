-- 0002_p2_full_schema.sql
-- Lands every §5.1 table not already in 0001. Catalog (template, skill),
-- ticket, action, asset, activity_log, team, agent_instance, team_member,
-- connector, webhook_event are *defined* here for forward-compat with
-- P3-P6; they sit empty until each phase populates them. memory_fact is
-- P2's active table — written by rememberFact, read by recallMemory.

-- ── Catalog ────────────────────────────────────────────────────
CREATE TABLE template (
  id               TEXT PRIMARY KEY,
  worker_kind      TEXT NOT NULL,
  display_name     TEXT NOT NULL,
  description      TEXT NOT NULL,
  system_prompt    TEXT NOT NULL,
  model            TEXT NOT NULL,
  skill_ids        TEXT NOT NULL,    -- JSON array of skill ids
  default_policies TEXT NOT NULL,    -- JSON { actionType: policy }
  status           TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'retired')),
  version          INTEGER NOT NULL DEFAULT 1,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE TABLE skill (
  id             TEXT PRIMARY KEY,         -- matches the code-registry skill id
  display_name   TEXT NOT NULL,
  description    TEXT NOT NULL,            -- LLM-facing
  param_hints    TEXT,                     -- JSON
  default_config TEXT,                     -- JSON
  enabled        INTEGER NOT NULL DEFAULT 1,
  updated_at     INTEGER NOT NULL
);

-- ── Team + agents ──────────────────────────────────────────────
CREATE TABLE team (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL UNIQUE REFERENCES company(id),
  confirmed_at INTEGER,
  created_at   INTEGER NOT NULL
);

CREATE TABLE agent_instance (
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
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  UNIQUE (company_id, role, template_id)
);

CREATE TABLE team_member (
  team_id           TEXT NOT NULL REFERENCES team(id),
  agent_instance_id TEXT NOT NULL REFERENCES agent_instance(id),
  can_delegate_to   TEXT NOT NULL DEFAULT '[]', -- JSON array of agent_instance ids
  PRIMARY KEY (team_id, agent_instance_id)
);

-- ── Connectors (defined here; populated in P6) ────────────────
CREATE TABLE connector (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL REFERENCES company(id),
  type         TEXT NOT NULL
               CHECK (type IN ('web', 'telegram', 'whatsapp', 'slack', 'discord')),
  display_name TEXT NOT NULL,
  config_ref   TEXT NOT NULL,           -- reference into Worker Secrets / secret store
  inbound      INTEGER NOT NULL DEFAULT 1,
  outbound     INTEGER NOT NULL DEFAULT 1,
  status       TEXT NOT NULL DEFAULT 'active'
               CHECK (status IN ('active', 'disabled')),
  created_at   INTEGER NOT NULL,
  UNIQUE (company_id, type)
);

CREATE TABLE webhook_event (
  provider    TEXT NOT NULL,
  external_id TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  PRIMARY KEY (provider, external_id)
);

-- ── Work ───────────────────────────────────────────────────────
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

CREATE TABLE asset (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES company(id),
  kind       TEXT NOT NULL
             CHECK (kind IN ('generated_image', 'knowledge_doc', 'audio', 'brand_asset')),
  r2_key     TEXT NOT NULL,
  sha256     TEXT NOT NULL,
  mime       TEXT NOT NULL,
  bytes      INTEGER NOT NULL,
  metadata   TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (company_id, sha256)
);

-- ── Memory (P2's active table) ────────────────────────────────
CREATE TABLE memory_fact (
  id                TEXT PRIMARY KEY,
  company_id        TEXT NOT NULL REFERENCES company(id),
  agent_instance_id TEXT NOT NULL REFERENCES agent_instance(id),
  kind              TEXT NOT NULL,
  content           TEXT NOT NULL,
  salience          REAL NOT NULL DEFAULT 0.5,
  created_at        INTEGER NOT NULL
);

-- ── Activity log ──────────────────────────────────────────────
CREATE TABLE activity_log (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES company(id),
  type       TEXT NOT NULL,
  ref_type   TEXT,
  ref_id     TEXT,
  summary    TEXT NOT NULL,    -- pt-BR
  payload    TEXT,
  actor_id   TEXT,
  created_at INTEGER NOT NULL
);

-- ── Indexes (per spec §5.1) ───────────────────────────────────
CREATE INDEX idx_ticket_company_agent_status
  ON ticket (company_id, agent_instance_id, status);
CREATE INDEX idx_action_company_status_age
  ON action (company_id, status, created_at);
CREATE INDEX idx_activity_log_company_time
  ON activity_log (company_id, created_at);
CREATE INDEX idx_memory_fact_agent_time
  ON memory_fact (agent_instance_id, created_at);
