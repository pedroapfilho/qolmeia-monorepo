import { z } from "zod";

// Better Auth's get-session returns `{ session, user }` for a valid session,
// or JSON `null` otherwise. P1 needs only the user id.
const sessionResponseSchema = z.object({
  user: z.object({ id: z.string() }),
});

type ValidatedSession = { userId: string };

// P1 session gate. The Worker is a different origin than the auth service, so
// the browser will not attach the auth cookie to a cross-origin Worker request
// (cookies in this project use the `qolmeia` prefix and the standard
// same-origin rules). The client passes its session token as a `cf_session`
// query param; the Worker forwards it via the Bearer header to Better Auth's
// bearer plugin, which validates the token against the session table directly.
// Request cookies are also forwarded as a fallback for a future shared-domain
// deployment. Caching, role/membership resolution, and proper handshake are P2.
const validateSession = async (
  request: Request,
  env: Env,
): Promise<ValidatedSession | null> => {
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
    response = await fetch(`${env.AUTH_SERVICE_URL}/api/auth/get-session`, { headers });
  } catch (error) {
    // The auth service being unreachable is an outage, not an invalid
    // session — surface it rather than letting it look like a normal 401.
    // console is the Worker's logging channel (wrangler tail / observability).
    // oxlint-disable-next-line no-console
    console.error("[auth] session validation request failed", { error });
    return null;
  }
  if (!response.ok) {
    return null;
  }

  const parsed = sessionResponseSchema.safeParse(await response.json());
  return parsed.success ? { userId: parsed.data.user.id } : null;
};

export { validateSession };
export type { ValidatedSession };
