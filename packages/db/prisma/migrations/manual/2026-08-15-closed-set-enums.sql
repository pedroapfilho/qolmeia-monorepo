-- Converts the closed-set String columns to Postgres enums and the two
-- Int-as-boolean columns to boolean, in place and without data loss.
--
-- `prisma db push` would drop and recreate these columns instead. Run this
-- against any database holding real rows BEFORE pushing the schema, then push
-- to pick up the remaining (non-destructive) changes.
--
--   psql "$DATABASE_URL" -f 2026-08-15-closed-set-enums.sql
--
-- action.policy values are rewritten from hyphens to underscores because a
-- Postgres enum label cannot contain a hyphen; the application now uses the
-- underscore form end to end.

BEGIN;

CREATE TYPE "CompanyStatus" AS ENUM ('onboarding', 'active', 'paused');
CREATE TYPE "TemplateStatus" AS ENUM ('active', 'retired');
CREATE TYPE "AgentRole" AS ENUM ('correspondent', 'planner', 'worker');
CREATE TYPE "AgentInstanceStatus" AS ENUM ('active', 'paused');
CREATE TYPE "TicketStatus" AS ENUM (
  'open', 'in_progress', 'awaiting_approval', 'blocked', 'done', 'cancelled', 'rejected'
);
CREATE TYPE "ActionStatus" AS ENUM (
  'pending', 'approved', 'changes_requested', 'rejected', 'executed'
);
CREATE TYPE "ActionPolicy" AS ENUM ('auto_execute', 'notify_only', 'require_approval');
CREATE TYPE "AssetKind" AS ENUM (
  'audio', 'brand_asset', 'generated_image', 'knowledge_doc', 'user_upload'
);
CREATE TYPE "AssetVisibility" AS ENUM ('agent', 'customer');
CREATE TYPE "OperatorAssignmentKind" AS ENUM ('company', 'discipline');

-- Normalise the hyphenated policy values before the cast.
UPDATE "action" SET "policy" = replace("policy", '-', '_');
-- Action types are operator-defined keys and must remain byte-for-byte stable.
UPDATE "template" AS template_row
SET "default_policies" = (
  SELECT jsonb_object_agg(
    policy.key,
    CASE policy.value
      WHEN to_jsonb('auto-execute'::text) THEN to_jsonb('auto_execute'::text)
      WHEN to_jsonb('notify-only'::text) THEN to_jsonb('notify_only'::text)
      WHEN to_jsonb('require-approval'::text) THEN to_jsonb('require_approval'::text)
      ELSE policy.value
    END
  )
  FROM jsonb_each(template_row."default_policies") AS policy
)
WHERE jsonb_typeof(template_row."default_policies") = 'object'
  AND EXISTS (
    SELECT 1
    FROM jsonb_each(template_row."default_policies") AS policy
    WHERE policy.value IN (
      to_jsonb('auto-execute'::text),
      to_jsonb('notify-only'::text),
      to_jsonb('require-approval'::text)
    )
  );

ALTER TABLE "company" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "company" ALTER COLUMN "status" TYPE "CompanyStatus" USING "status"::"CompanyStatus";
ALTER TABLE "company" ALTER COLUMN "status" SET DEFAULT 'onboarding';

ALTER TABLE "template" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "template" ALTER COLUMN "status" TYPE "TemplateStatus" USING "status"::"TemplateStatus";
ALTER TABLE "template" ALTER COLUMN "status" SET DEFAULT 'active';

ALTER TABLE "agent_instance" ALTER COLUMN "role" TYPE "AgentRole" USING "role"::"AgentRole";
ALTER TABLE "agent_instance" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "agent_instance"
  ALTER COLUMN "status" TYPE "AgentInstanceStatus" USING "status"::"AgentInstanceStatus";
ALTER TABLE "agent_instance" ALTER COLUMN "status" SET DEFAULT 'active';

ALTER TABLE "ticket" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "ticket" ALTER COLUMN "status" TYPE "TicketStatus" USING "status"::"TicketStatus";
ALTER TABLE "ticket" ALTER COLUMN "status" SET DEFAULT 'open';

ALTER TABLE "action" ALTER COLUMN "policy" TYPE "ActionPolicy" USING "policy"::"ActionPolicy";
ALTER TABLE "action" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "action" ALTER COLUMN "status" TYPE "ActionStatus" USING "status"::"ActionStatus";
ALTER TABLE "action" ALTER COLUMN "status" SET DEFAULT 'pending';

ALTER TABLE "asset" ALTER COLUMN "kind" TYPE "AssetKind" USING "kind"::"AssetKind";
ALTER TABLE "asset" ALTER COLUMN "visibility" DROP DEFAULT;
ALTER TABLE "asset"
  ALTER COLUMN "visibility" TYPE "AssetVisibility" USING "visibility"::"AssetVisibility";
ALTER TABLE "asset" ALTER COLUMN "visibility" SET DEFAULT 'customer';

ALTER TABLE "operator_assignment"
  ALTER COLUMN "kind" TYPE "OperatorAssignmentKind" USING "kind"::"OperatorAssignmentKind";

ALTER TABLE "skill" ALTER COLUMN "enabled" DROP DEFAULT;
ALTER TABLE "skill" ALTER COLUMN "enabled" TYPE boolean USING ("enabled" <> 0);
ALTER TABLE "skill" ALTER COLUMN "enabled" SET DEFAULT true;

ALTER TABLE "company_template_entitlement" ALTER COLUMN "enabled" DROP DEFAULT;
ALTER TABLE "company_template_entitlement"
  ALTER COLUMN "enabled" TYPE boolean USING ("enabled" <> 0);
ALTER TABLE "company_template_entitlement" ALTER COLUMN "enabled" SET DEFAULT true;

COMMIT;
