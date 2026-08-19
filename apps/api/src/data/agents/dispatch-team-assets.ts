import type { PrismaClient } from "@repo/db";
import { z } from "zod";

import {
  deleteBrandAsset,
  deleteCustomerAssets,
  getAssetAccess,
  getTextAssetMetadata,
  listAssetReferences,
  listAssets,
  listBrandAssets,
  listCustomerAssets,
  persistAsset,
} from "./assets";
import {
  getCatalogue,
  getDelegationTargets,
  getMemberDetail,
  getTeamRoster,
  listTeamRosters,
} from "./team-read";
import { confirmTeam, hireMember, setMemberStatus, updateMember } from "./team-write";
import { AgentDataError } from "./types";

const companyIdSchema = z.object({ companyId: z.string().min(1) });
const assetKindSchema = z.enum([
  "audio",
  "brand_asset",
  "generated_image",
  "knowledge_doc",
  "user_upload",
]);
const assetVisibilitySchema = z.enum(["agent", "customer"]);

const dispatchAssetOperation = (db: PrismaClient, operation: string, raw: unknown) => {
  switch (operation) {
    case "assets.access": {
      const input = z.object({ assetId: z.string().min(1) }).parse(raw);
      return getAssetAccess(db, input.assetId);
    }
    case "assets.deleteBrand": {
      const input = z
        .object({ assetId: z.string().min(1), companyId: z.string().min(1) })
        .parse(raw);
      return deleteBrandAsset(db, input.companyId, input.assetId);
    }
    case "assets.deleteCustomer": {
      const input = z
        .object({ companyId: z.string().min(1), ids: z.array(z.string().min(1)).max(100) })
        .parse(raw);
      return deleteCustomerAssets(db, input.companyId, input.ids);
    }
    case "assets.list": {
      const input = z
        .object({
          companyId: z.string().min(1),
          kind: assetKindSchema.optional(),
          limit: z.number().int().positive().max(200).optional(),
          visibility: assetVisibilitySchema.optional(),
        })
        .parse(raw);
      return listAssets(db, input);
    }
    case "assets.listBrand": {
      const input = companyIdSchema.parse(raw);
      return listBrandAssets(db, input.companyId);
    }
    case "assets.listCustomer": {
      const input = companyIdSchema
        .extend({ limit: z.number().int().positive().max(200) })
        .parse(raw);
      return listCustomerAssets(db, input.companyId, input.limit);
    }
    case "assets.listReferences": {
      const input = companyIdSchema
        .extend({ limit: z.number().int().positive().max(20) })
        .parse(raw);
      return listAssetReferences(db, input.companyId, input.limit);
    }
    case "assets.persist": {
      const input = z
        .object({
          bytes: z.number().int().nonnegative(),
          companyId: z.string().min(1),
          id: z.string().min(1),
          kind: assetKindSchema,
          metadata: z.record(z.string(), z.json()),
          mime: z.string().min(1),
          r2Key: z.string().min(1),
          sha256: z.string().length(64),
          visibility: assetVisibilitySchema,
        })
        .parse(raw);
      return persistAsset(db, input);
    }
    case "assets.textMetadata": {
      const input = z
        .object({ assetId: z.string().min(1), companyId: z.string().min(1) })
        .parse(raw);
      return getTextAssetMetadata(db, input.companyId, input.assetId);
    }
    default: {
      throw new AgentDataError("unknown_operation", `Unknown operation: ${operation}`, 404);
    }
  }
};

const dispatchTeamOperation = (db: PrismaClient, operation: string, raw: unknown) => {
  switch (operation) {
    case "teams.catalogue": {
      const input = companyIdSchema.parse(raw);
      return getCatalogue(db, input.companyId);
    }
    case "teams.confirm": {
      const input = z
        .object({
          actorId: z.string().min(1),
          companyId: z.string().min(1),
          templateIds: z.array(z.string().min(1)).min(1).max(20),
        })
        .parse(raw);
      return confirmTeam(db, input);
    }
    case "teams.delegationTargets": {
      const input = z.object({ agentInstanceId: z.string().min(1) }).parse(raw);
      return getDelegationTargets(db, input.agentInstanceId);
    }
    case "teams.hire": {
      const input = z
        .object({
          actorId: z.string().nullable(),
          companyId: z.string().min(1),
          displayName: z.string().optional(),
          templateId: z.string().min(1),
        })
        .parse(raw);
      return hireMember(db, input);
    }
    case "teams.memberDetail": {
      const input = z
        .object({ agentInstanceId: z.string().min(1), companyId: z.string().min(1) })
        .parse(raw);
      return getMemberDetail(db, input.companyId, input.agentInstanceId);
    }
    case "teams.roster": {
      const input = companyIdSchema.parse(raw);
      return getTeamRoster(db, input.companyId);
    }
    case "teams.rosters": {
      const input = z.object({ companyIds: z.array(z.string()) }).parse(raw);
      return listTeamRosters(db, input.companyIds);
    }
    case "teams.setStatus": {
      const input = z
        .object({
          actorId: z.string().nullable().optional(),
          agentInstanceId: z.string().min(1),
          companyId: z.string().min(1),
          status: z.enum(["active", "paused"]),
        })
        .parse(raw);
      return setMemberStatus(db, input);
    }
    case "teams.update": {
      const input = z
        .object({
          agentInstanceId: z.string().min(1),
          companyId: z.string().min(1),
          displayName: z.string().optional(),
          editedBy: z.enum(["customer", "operator"]),
          operatorId: z.string().nullable(),
          promptOverride: z.string().nullable().optional(),
        })
        .parse(raw);
      return updateMember(db, input);
    }
    default: {
      throw new AgentDataError("unknown_operation", `Unknown operation: ${operation}`, 404);
    }
  }
};

export { dispatchAssetOperation, dispatchTeamOperation };
