const ORG_ROLES = ["OWNER", "STAFF", "CUSTOMER"] as const;

type OrgRole = (typeof ORG_ROLES)[number];

type MeOrg = {
  id: string;
  name: string;
  role: OrgRole;
  slug: string;
};

type MeUser = {
  displayName: string | null;
  email: string;
  emailVerified: boolean;
  id: string;
  image: string | null;
  name: string;
  username: string | null;
};

type MeResponse = {
  currentOrg: MeOrg | null;
  orgs: ReadonlyArray<MeOrg>;
  role: OrgRole | null;
  user: MeUser;
};

export { ORG_ROLES };
export type { MeOrg, MeResponse, MeUser, OrgRole };
