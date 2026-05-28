-- 0006_agent_instance_prompt_override.sql
-- Adds a per-instance system prompt override. NULL means "use the
-- template's system_prompt"; non-NULL replaces it. Mirrors the existing
-- model_override column pattern. No backfill required.

ALTER TABLE agent_instance ADD COLUMN prompt_override TEXT;
