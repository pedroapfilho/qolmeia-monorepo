import { ORG_ROLES, type MeOrg, type MeResponse } from "@repo/worker-api/contracts";
import { z } from "zod";

const orgSchema = z.object({
  id: z.string(),
  role: z.enum(ORG_ROLES),
});

const namedOrgSchema = orgSchema.extend({ name: z.string() });

const meResponseSchema = z.object({
  currentOrg: orgSchema.nullable(),
  orgs: z.array(namedOrgSchema).default([]),
  user: z.object({ id: z.string() }),
});

type OrgSummary = Pick<MeOrg, "id" | "name" | "role">;

type MeSessionClaims = {
  currentOrg: Pick<NonNullable<MeResponse["currentOrg"]>, "id" | "role"> | null;
  orgs: ReadonlyArray<OrgSummary>;
  userId: MeResponse["user"]["id"];
};

const parseMeResponse = (data: unknown): MeSessionClaims | null => {
  const parsed = meResponseSchema.safeParse(data);
  if (!parsed.success) {
    return null;
  }
  return {
    currentOrg: parsed.data.currentOrg,
    orgs: parsed.data.orgs,
    userId: parsed.data.user.id,
  };
};

export { parseMeResponse };
export type { MeSessionClaims, OrgSummary };
