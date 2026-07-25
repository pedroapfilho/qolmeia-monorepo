import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const COMPANY_ID = "co_brandassets_test";
const originalFetch = globalThis.fetch;

const meCustomer = {
  currentOrg: { id: COMPANY_ID, role: "CUSTOMER" },
  user: { id: "user-1" },
};
const meStaff = {
  currentOrg: { id: COMPANY_ID, role: "STAFF" },
  user: { id: "staff-1" },
};

const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2]);

const uploadForm = (category: string): FormData => {
  const form = new FormData();
  form.append("file", new File([pngBytes], "logo.png", { type: "image/png" }));
  form.append("category", category);
  return form;
};

beforeEach(async () => {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO company (id, name, slug, timezone, locale, status, brief, created_at, updated_at)
     VALUES (?, 'BA', 'ba', 'America/Sao_Paulo', 'pt-BR', 'active', NULL, 0, 0)`,
  )
    .bind(COMPANY_ID)
    .run();
  await env.DB.prepare("DELETE FROM asset WHERE company_id = ?").bind(COMPANY_ID).run();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("POST /api/me/brand-assets", () => {
  it("stores a brand asset with its category for CUSTOMER", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meCustomer)));
    const res = await exports.default.fetch(
      "https://agents.test/api/me/brand-assets?cf_session=tok",
      {
        body: uploadForm("logo"),
        method: "POST",
      },
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ assetId: string; category: string }>();
    expect(body.category).toBe("logo");
    expect(body.assetId).toBeTruthy();
  });

  it("falls back to 'other' for an unknown category", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meCustomer)));
    const res = await exports.default.fetch(
      "https://agents.test/api/me/brand-assets?cf_session=tok",
      {
        body: uploadForm("bogus"),
        method: "POST",
      },
    );
    const body = await res.json<{ category: string }>();
    expect(body.category).toBe("other");
  });

  it("403 when STAFF tries to upload", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meStaff)));
    const res = await exports.default.fetch(
      "https://agents.test/api/me/brand-assets?cf_session=tok",
      {
        body: uploadForm("logo"),
        method: "POST",
      },
    );
    expect(res.status).toBe(403);
  });
});

describe("GET + DELETE /api/me/brand-assets", () => {
  it("lists then deletes a brand asset", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meCustomer)));
    const created = await exports.default.fetch(
      "https://agents.test/api/me/brand-assets?cf_session=tok",
      {
        body: uploadForm("post"),
        method: "POST",
      },
    );
    const { assetId } = await created.json<{ assetId: string }>();

    const listRes = await exports.default.fetch(
      "https://agents.test/api/me/brand-assets?cf_session=tok",
    );
    const list = await listRes.json<{ items: Array<{ category: string; id: string }> }>();
    expect(list.items.some((a) => a.id === assetId && a.category === "post")).toBe(true);

    const delRes = await exports.default.fetch(
      `https://agents.test/api/me/brand-assets/${assetId}?cf_session=tok`,
      { method: "DELETE" },
    );
    expect(delRes.status).toBe(200);

    const afterRes = await exports.default.fetch(
      "https://agents.test/api/me/brand-assets?cf_session=tok",
    );
    const after = await afterRes.json<{ items: Array<{ id: string }> }>();
    expect(after.items.some((a) => a.id === assetId)).toBe(false);
  });
});
