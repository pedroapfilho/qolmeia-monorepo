import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { getCompany } from "#/db/schema";

const COMPANY_ID = "test-co";

beforeEach(async () => {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO company
       (id, name, slug, timezone, locale, status, brief, created_at, updated_at)
     VALUES (?, 'Test Co', 'test-co', 'America/Sao_Paulo', 'pt-BR', 'active', NULL, 0, 0)`,
  )
    .bind(COMPANY_ID)
    .run();
});

describe("getCompany", () => {
  it("returns a seeded company", async () => {
    const company = await getCompany(env.DB, COMPANY_ID);
    expect(company?.name).toBe("Test Co");
    expect(company?.status).toBe("active");
  });

  it("returns null for an unknown id", async () => {
    expect(await getCompany(env.DB, "missing")).toBeNull();
  });
});
