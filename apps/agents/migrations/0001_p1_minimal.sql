-- 0001_p1_minimal.sql
-- P1 walking-skeleton slice of the §5.1 schema (spec
-- docs/superpowers/specs/2026-05-22-cloudflare-agent-platform-design.md).
-- Three tables only. The catalog, team, ticket, action, and connector tables
-- arrive in later phases.

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

CREATE TABLE conversation (
  id                 TEXT PRIMARY KEY,
  company_id         TEXT NOT NULL REFERENCES company(id),
  external_thread_id TEXT NOT NULL,
  user_id            TEXT,
  created_at         INTEGER NOT NULL,
  UNIQUE (company_id, external_thread_id)
);

CREATE TABLE message (
  id                TEXT PRIMARY KEY,
  company_id        TEXT NOT NULL REFERENCES company(id),
  conversation_id   TEXT NOT NULL REFERENCES conversation(id),
  agent_instance_id TEXT,
  role              TEXT NOT NULL CHECK (role IN ('user', 'agent', 'system')),
  content           TEXT NOT NULL,
  attachments       TEXT,
  created_at        INTEGER NOT NULL
);

CREATE INDEX idx_message_conversation ON message (conversation_id, created_at);
