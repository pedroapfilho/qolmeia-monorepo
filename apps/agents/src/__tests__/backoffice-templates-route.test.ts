import { exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalFetch = globalThis.fetch;

const meStaff = {
  currentOrg: { id: "co_tpl_test", role: "STAFF" },
  user: { id: "staff-tpl" },
};

const validBody = {
  defaultActionType: "worker_deliverable",
  defaultPolicies: { worker_deliverable: "require-approval" },
  description: "Especialista em SEO técnico.",
  displayName: "Auditor SEO",
  model: "openai/gpt-4o-mini",
  skillIds: ["webSearch", "fetchUrl"],
  systemPrompt: "Você audita SEO técnico de sites em pt-BR.",
  workerKind: "seo-auditor",
};

type Template = {
  defaultActionType: string;
  id: string;
  skillIds: ReadonlyArray<string>;
  status: "active" | "retired";
  version: number;
};

const post = (body: unknown) =>
  exports.default.fetch("https://agents.test/api/backoffice/templates?cf_session=tok", {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

const patch = (path: string, body: unknown) =>
  exports.default.fetch(`https://agents.test/api/backoffice${path}?cf_session=tok`, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "PATCH",
  });

beforeEach(() => {
  globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meStaff)));
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("backoffice skill catalog", () => {
  it("returns the full 13-skill code registry with id + label", async () => {
    const res = await exports.default.fetch(
      "https://agents.test/api/backoffice/skills?cf_session=tok",
    );
    expect(res.status).toBe(200);
    const body = await res.json<{
      items: Array<{ description: string; displayName: string; id: string }>;
    }>();
    expect(body.items.length).toBe(13);
    const webSearch = body.items.find((s) => s.id === "webSearch");
    expect(webSearch?.displayName).toBeTruthy();
    expect(webSearch?.description).toBeTruthy();
  });
});

describe("backoffice template CRUD", () => {
  it("creates a template (happy path), then lists it", async () => {
    const created = await post(validBody);
    expect(created.status).toBe(201);
    const createdBody = await created.json<{ template: Template }>();
    expect(createdBody.template.id).toMatch(/^tpl-/v);
    expect(createdBody.template.version).toBe(1);
    expect(createdBody.template.status).toBe("active");
    expect([...createdBody.template.skillIds]).toEqual(["webSearch", "fetchUrl"]);

    const list = await exports.default.fetch(
      "https://agents.test/api/backoffice/templates?cf_session=tok",
    );
    expect(list.status).toBe(200);
    const listBody = await list.json<{ items: Array<Template> }>();
    expect(listBody.items.find((t) => t.id === createdBody.template.id)).toBeTruthy();
  });

  it("rejects an unknown skill id with 400", async () => {
    const res = await post({ ...validBody, skillIds: ["webSearch", "doesNotExist"] });
    expect(res.status).toBe(400);
  });

  it("rejects an empty display name with 400", async () => {
    const res = await post({ ...validBody, displayName: "" });
    expect(res.status).toBe(400);
  });

  it("updates a template and bumps the version", async () => {
    const created = await post(validBody);
    const { template } = await created.json<{ template: Template }>();

    const updated = await patch(`/templates/${template.id}`, {
      ...validBody,
      displayName: "Auditor SEO v2",
      skillIds: ["webSearch"],
    });
    expect(updated.status).toBe(200);
    const updatedBody = await updated.json<{ template: Template }>();
    expect(updatedBody.template.version).toBe(2);
    expect([...updatedBody.template.skillIds]).toEqual(["webSearch"]);
  });

  it("returns 404 when updating a missing template", async () => {
    const res = await patch("/templates/tpl-missing", validBody);
    expect(res.status).toBe(404);
  });

  it("retires then restores a template (soft, never hard-deletes)", async () => {
    const created = await post(validBody);
    const { template } = await created.json<{ template: Template }>();

    const retired = await patch(`/templates/${template.id}/status`, { status: "retired" });
    expect(retired.status).toBe(200);
    const retiredBody = await retired.json<{ template: Template }>();
    expect(retiredBody.template.status).toBe("retired");

    const list = await exports.default.fetch(
      "https://agents.test/api/backoffice/templates?cf_session=tok",
    );
    const listBody = await list.json<{ items: Array<Template> }>();
    expect(listBody.items.find((t) => t.id === template.id)?.status).toBe("retired");

    const restored = await patch(`/templates/${template.id}/status`, { status: "active" });
    expect(restored.status).toBe(200);
    const restoredBody = await restored.json<{ template: Template }>();
    expect(restoredBody.template.status).toBe("active");
  });

  it("rejects an invalid status with 400", async () => {
    const created = await post(validBody);
    const { template } = await created.json<{ template: Template }>();
    const res = await patch(`/templates/${template.id}/status`, { status: "deleted" });
    expect(res.status).toBe(400);
  });
});
