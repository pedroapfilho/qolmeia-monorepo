const LOCALHOST_ALLOWED_HOSTS = ["**.localhost", "localhost:*", "127.0.0.1:*"];

// Plain http://localhost:PORT origins won't match allowedHosts patterns.
const LOOPBACK_TRUSTED_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:4000",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
  "http://127.0.0.1:4000",
];

const parseEnvList = (value: string | undefined): Array<string> => {
  if (value === undefined || value === "") {
    return [];
  }
  const result: Array<string> = [];
  for (const entry of value.split(",")) {
    const trimmed = entry.trim();
    if (trimmed.length > 0) {
      result.push(trimmed);
    }
  }
  return result;
};

type EnvAuthConfig = {
  allowedHosts: Array<string>;
  cookieDomain?: string;
  rateLimitEnabled: boolean;
  trustedOrigins: Array<string>;
  useSecureCookies: boolean;
};

/**
 * The env-derived slice of `AuthConfig`, shared by all four qolmeia entry points
 * so `createAuth` itself stays a pure function of its config.
 */
const envAuthConfig = (): EnvAuthConfig => {
  const cookieDomain = process.env.COOKIE_DOMAIN?.trim();
  return {
    allowedHosts: [...LOCALHOST_ALLOWED_HOSTS, ...parseEnvList(process.env.AUTH_ALLOWED_HOSTS)],
    ...(cookieDomain !== undefined && cookieDomain !== "" ? { cookieDomain } : {}),
    rateLimitEnabled:
      process.env.NODE_ENV === "production" &&
      (process.env.CI === undefined || process.env.CI === ""),
    trustedOrigins: [...LOOPBACK_TRUSTED_ORIGINS, ...parseEnvList(process.env.TRUSTED_ORIGINS)],
    useSecureCookies: process.env.WEB_APP_URL?.startsWith("https://") === true,
  };
};

export { envAuthConfig, parseEnvList };
export type { EnvAuthConfig };
