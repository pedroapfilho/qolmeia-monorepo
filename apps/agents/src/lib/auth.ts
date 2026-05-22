import { z } from "zod";

// Better Auth's get-session returns `{ session, user }` for a valid session,
// or JSON `null` otherwise. P1 needs only the user id.
const sessionResponseSchema = z.object({
  user: z.object({ id: z.string() }),
});

type ValidatedSession = { userId: string };

// P1 session gate. The Worker is a different origin than the auth service, so
// the browser will not attach the auth cookie to a cross-origin Worker request.
// The client passes its session token as a `cf_session` query param; the Worker
// forwards it to the auth service's get-session as a cookie. Request cookies are
// also forwarded, so a future shared-domain deployment works without the param.
// Proper validation, caching, and role/membership resolution are P2 (spec §9).
const validateSession = async (
  request: Request,
  env: Env,
): Promise<ValidatedSession | null> => {
  const tokenParam = new URL(request.url).searchParams.get("cf_session");
  const cookie = tokenParam
    ? `${env.SESSION_COOKIE_NAME}=${tokenParam}`
    : request.headers.get("Cookie");
  if (!cookie) {
    return null;
  }

  let response: Response;
  try {
    response = await fetch(`${env.AUTH_SERVICE_URL}/api/auth/get-session`, {
      headers: { Cookie: cookie },
    });
  } catch {
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
