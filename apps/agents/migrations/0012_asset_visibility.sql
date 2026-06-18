-- 0012_asset_visibility.sql
-- ADR 0007: the asset library splits into two folders per company. The
-- `customer` folder is visible to the customer and the agents (finished
-- deliverables + the customer's own uploads, incl. brand identity); the
-- `agent` folder is agent-only working material (scrapes, drafts).
--
-- A single ADD COLUMN (no FK rebuild, so the migration runner applies it
-- normally). Existing rows are customer-visible — that's what /assets and the
-- brand cards already showed. R2 keys gain a folder prefix on new writes
-- (org_<id>/customer/… vs org_<id>/agent/…); old keys stay valid since the row
-- stores the full key.

ALTER TABLE asset
  ADD COLUMN visibility TEXT NOT NULL DEFAULT 'customer'
    CHECK (visibility IN ('customer', 'agent'));
