-- Extend asset.kind to include 'user_upload' for customer-uploaded chat
-- attachments. SQLite has no ALTER TABLE … MODIFY CHECK, so we rebuild the
-- table preserving the FK to company(id) and the (company_id, sha256) UNIQUE.

CREATE TABLE asset__new (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES company(id),
  kind       TEXT NOT NULL
             CHECK (kind IN ('generated_image', 'knowledge_doc', 'audio', 'brand_asset', 'user_upload')),
  r2_key     TEXT NOT NULL,
  sha256     TEXT NOT NULL,
  mime       TEXT NOT NULL,
  bytes      INTEGER NOT NULL,
  metadata   TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (company_id, sha256)
);

INSERT INTO asset__new (id, company_id, kind, r2_key, sha256, mime, bytes, metadata, created_at)
  SELECT id, company_id, kind, r2_key, sha256, mime, bytes, metadata, created_at FROM asset;

DROP TABLE asset;
ALTER TABLE asset__new RENAME TO asset;
