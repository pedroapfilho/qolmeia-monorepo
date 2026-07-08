CREATE TABLE IF NOT EXISTS company_template_entitlement (
  company_id  TEXT NOT NULL REFERENCES company(id),
  template_id TEXT NOT NULL REFERENCES template(id),
  enabled     INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (company_id, template_id)
);

CREATE INDEX IF NOT EXISTS idx_company_template_entitlement_company
  ON company_template_entitlement (company_id, enabled);
