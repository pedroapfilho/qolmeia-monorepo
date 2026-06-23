import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { listCompanyAssets, persistTextAsset, readAssetText } from "#/lib/asset-store";

const COMPANY_ID = "co_asset_store_test";

beforeEach(async () => {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO company (id, name, slug, timezone, locale, status, brief, created_at, updated_at)
     VALUES (?, 'AS', 'as', 'America/Sao_Paulo', 'pt-BR', 'active', NULL, 0, 0)`,
  )
    .bind(COMPANY_ID)
    .run();
});

describe("asset-store", () => {
  it("persists a text deliverable, lists it, and reads it back", async () => {
    const { assetId } = await persistTextAsset(env as Env, {
      companyId: COMPANY_ID,
      name: "Plano semanal",
      text: "# Plano\n\nSegunda: post de lançamento.",
    });
    expect(assetId).toBeTruthy();

    const assets = await listCompanyAssets(env.DB, COMPANY_ID, { kind: "knowledge_doc" });
    const found = assets.find((a) => a.id === assetId);
    expect(found?.kind).toBe("knowledge_doc");
    expect(found?.name).toBe("Plano semanal");

    const read = await readAssetText(env as Env, COMPANY_ID, assetId);
    expect(read?.content).toContain("post de lançamento");
    expect(read?.name).toBe("Plano semanal");
  });

  it("dedups identical content on (company, sha256)", async () => {
    const first = await persistTextAsset(env as Env, {
      companyId: COMPANY_ID,
      name: "Nota",
      text: "conteúdo idêntico para dedup",
    });
    const second = await persistTextAsset(env as Env, {
      companyId: COMPANY_ID,
      name: "Nota (de novo)",
      text: "conteúdo idêntico para dedup",
    });
    expect(second.assetId).toBe(first.assetId);
  });

  it("is tenant-scoped: another company cannot read the asset", async () => {
    const { assetId } = await persistTextAsset(env as Env, {
      companyId: COMPANY_ID,
      name: "Privado",
      text: "segredo da empresa A que B não deve ler",
    });
    const read = await readAssetText(env as Env, "co_other_tenant", assetId);
    expect(read).toBeNull();
  });

  it("defaults to the customer folder; honors the agent folder (ADR 0007)", async () => {
    const customer = await persistTextAsset(env as Env, {
      companyId: COMPANY_ID,
      name: "Entrega",
      text: "documento de entrega para o cliente",
    });
    const agentScratch = await persistTextAsset(env as Env, {
      companyId: COMPANY_ID,
      name: "Recorte",
      text: "rascunho interno do agente",
      visibility: "agent",
    });

    const customerOnly = await listCompanyAssets(env.DB, COMPANY_ID, { visibility: "customer" });
    expect(customerOnly.find((a) => a.id === customer.assetId)?.visibility).toBe("customer");
    expect(customerOnly.find((a) => a.id === agentScratch.assetId)).toBeUndefined();

    const agentOnly = await listCompanyAssets(env.DB, COMPANY_ID, { visibility: "agent" });
    expect(agentOnly.find((a) => a.id === agentScratch.assetId)?.visibility).toBe("agent");
    expect(agentOnly.find((a) => a.id === customer.assetId)).toBeUndefined();

    // No visibility filter = the agent sees both folders.
    const both = await listCompanyAssets(env.DB, COMPANY_ID);
    expect(both.find((a) => a.id === customer.assetId)).toBeTruthy();
    expect(both.find((a) => a.id === agentScratch.assetId)).toBeTruthy();
  });
});
