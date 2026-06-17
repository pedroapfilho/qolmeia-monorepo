import { z } from "zod";

// Mirrors the three roles the auth service issues via OrgMembership. The
// Worker treats them as a closed enum: anything else is "no membership".
const ROLES = ["OWNER", "STAFF", "CUSTOMER"] as const;
type Role = (typeof ROLES)[number];

// Strict subset of /api/me — we only parse what the Worker needs. The
// auth service may add fields; ignoring them keeps the contract narrow.
const meResponseSchema = z.object({
  currentOrg: z
    .object({
      id: z.string(),
      role: z.enum(ROLES),
    })
    .nullable(),
  user: z.object({ id: z.string() }),
});

type MeResponse = {
  currentOrg: { id: string; role: Role } | null;
  userId: string;
};

const parseMeResponse = (data: unknown): MeResponse | null => {
  const parsed = meResponseSchema.safeParse(data);
  if (!parsed.success) {
    return null;
  }
  return {
    currentOrg: parsed.data.currentOrg,
    userId: parsed.data.user.id,
  };
};

export { parseMeResponse };
export type { MeResponse, Role };
