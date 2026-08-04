import { z } from "zod";

const ROLES = ["OWNER", "STAFF", "CUSTOMER"] as const;
type Role = (typeof ROLES)[number];

const orgSchema = z.object({
  id: z.string(),
  role: z.enum(ROLES),
});

const namedOrgSchema = orgSchema.extend({ name: z.string() });

const meResponseSchema = z.object({
  currentOrg: orgSchema.nullable(),
  orgs: z.array(namedOrgSchema).default([]),
  user: z.object({ id: z.string() }),
});

type OrgSummary = { id: string; name: string; role: Role };

type MeResponse = {
  currentOrg: { id: string; role: Role } | null;
  orgs: ReadonlyArray<OrgSummary>;
  userId: string;
};

const parseMeResponse = (data: unknown): MeResponse | null => {
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
export type { MeResponse, OrgSummary, Role };
