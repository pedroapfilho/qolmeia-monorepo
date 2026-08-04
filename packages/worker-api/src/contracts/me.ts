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

// currentOrg and role are null when the account belongs to more than one org
// and the request named none; orgs is answered either way, so an ambiguous
// caller can learn its options before it is able to choose.
type MeResponse = {
  currentOrg: MeOrg | null;
  orgs: ReadonlyArray<MeOrg>;
  role: OrgRole | null;
  user: MeUser;
};

export { ORG_ROLES };
export type { MeOrg, MeResponse, MeUser, OrgRole };
