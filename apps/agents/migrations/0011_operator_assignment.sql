-- 0011_operator_assignment.sql
-- ADR 0005: operators are cross-tenant Qolmeia staff. An operator may declare
-- the companies and disciplines they cover; the approval queue then narrows to
-- that coverage. No rows for an operator means no filter — they see every
-- company and every discipline (the default).
--
-- A "discipline" is a template worker_kind (designer, redator, …). The Action
-- already carries its producing agent's worker_kind, so routing falls out of
-- the data with no separate tagging surface. One row per (operator, kind,
-- value) keeps companies and disciplines in a single, easy-to-manage shape.

CREATE TABLE operator_assignment (
  id               TEXT PRIMARY KEY,
  operator_user_id TEXT NOT NULL,
  kind             TEXT NOT NULL CHECK (kind IN ('company', 'discipline')),
  value            TEXT NOT NULL,
  created_at       INTEGER NOT NULL,
  UNIQUE (operator_user_id, kind, value)
);

CREATE INDEX idx_operator_assignment_user ON operator_assignment (operator_user_id);
