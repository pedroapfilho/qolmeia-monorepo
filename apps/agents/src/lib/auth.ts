import { parseMeResponse, type Role } from "@/lib/membership";

type ValidatedSession = {
  companyId: string;
  role: Role;
  userId: string;
};

// P2 session gate. The validator hits /api/v1/me — the single shape the
// Worker should depend on — and returns the resolved membership: who is
// this, which company are they currently in, what role do they have. Path-
// level role enforcement (CUSTOMER on agent paths, OWNER/STAFF on backoffice)
// is the caller's job.
//
// The client passes its session token as a `cf_session` query param; the
// Worker forwards it via the Bearer header to Better Auth's bearer plugin.
// Request cookies are forwarded as a fallback for a future shared-domain
// deployment. Caching is a P3+ concern.
const validateSession = async (request: Request, env: Env): Promise<ValidatedSession | null> => {
  const tokenParam = new URL(request.url).searchParams.get("cf_session");
  const cookieHeader = request.headers.get("Cookie");

  const headers: Record<string, string> = {};
  if (tokenParam) {
    headers.Authorization = `Bearer ${tokenParam}`;
  } else if (cookieHeader) {
    headers.Cookie = cookieHeader;
  } else {
    return null;
  }

  let response: Response;
  try {
    response = await fetch(`${env.AUTH_SERVICE_URL}/api/v1/me`, { headers });
  } catch (error) {
    // The auth service being unreachable is an outage, not an invalid
    // session — surface it rather than letting it look like a normal 401.
    // console is the Worker's logging channel (wrangler tail / observability).
    // oxlint-disable-next-line no-console
    console.error("[auth] /api/v1/me request failed", { error });
    return null;
  }
  if (!response.ok) {
    return null;
  }

  const me = parseMeResponse(await response.json());
  if (!me?.currentOrg) {
    return null;
  }
  return {
    companyId: me.currentOrg.id,
    role: me.currentOrg.role,
    userId: me.userId,
  };
};

export { validateSession };
export type { ValidatedSession };
