import type { Context, Next } from "hono";
import { rateLimiter } from "hono-rate-limiter";
import { secureHeaders } from "hono/secure-headers";

const firstNonEmpty = (...candidates: Array<string | undefined>): string | undefined =>
  candidates.find((value) => value !== undefined && value !== "");

const getClientIp = (c: Context): string => {
  const env: unknown = c.env;
  const remoteAddr =
    typeof env === "object" &&
    env !== null &&
    "remoteAddr" in env &&
    typeof env.remoteAddr === "string"
      ? env.remoteAddr
      : undefined;
  return (
    firstNonEmpty(c.req.header("x-forwarded-for"), c.req.header("x-real-ip"), remoteAddr) ??
    "unknown"
  );
};

export const securityHeaders = secureHeaders({
  contentSecurityPolicy: {
    connectSrc: ["'self'"],
    defaultSrc: ["'self'"],
    fontSrc: ["'self'"],
    frameSrc: ["'none'"],
    imgSrc: ["'self'", "data:", "https:"],
    mediaSrc: ["'self'"],
    objectSrc: ["'none'"],
    scriptSrc: ["'self'", "'unsafe-inline'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
  },
  crossOriginEmbedderPolicy: "require-corp",
  crossOriginOpenerPolicy: "same-origin",
  crossOriginResourcePolicy: "cross-origin",
  originAgentCluster: "?1",
  referrerPolicy: "no-referrer-when-downgrade",
  strictTransportSecurity: "max-age=63072000; includeSubDomains; preload",
  xContentTypeOptions: "nosniff",
  xDnsPrefetchControl: "off",
  xDownloadOptions: "noopen",
  xFrameOptions: "DENY",
  xPermittedCrossDomainPolicies: "none",
  xXssProtection: "1; mode=block",
});

export const standardRateLimit = rateLimiter({
  handler: (c: Context) => {
    c.res = c.json(
      {
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          message: "Too many requests, please try again later",
        },
      },
      429,
    );
  },
  keyGenerator: (c: Context) => getClientIp(c),
  limit: 100,
  standardHeaders: "draft-6",
  windowMs: 15 * 60 * 1000, // 15 minutes
});

export const apiRateLimit = rateLimiter({
  handler: (c: Context) => {
    c.res = c.json(
      {
        error: {
          code: "API_RATE_LIMIT_EXCEEDED",
          message: "API rate limit exceeded, please slow down",
        },
      },
      429,
    );
  },
  keyGenerator: (c: Context) => `ip:${getClientIp(c)}`,
  limit: 30,
  standardHeaders: "draft-6",
  windowMs: 1 * 60 * 1000, // 1 minute
});

export const requestSizeLimit = (maxSize: number = 10 * 1024 * 1024) => {
  return async (c: Context, next: Next) => {
    const contentLength = c.req.header("content-length");

    if (
      contentLength !== undefined &&
      contentLength !== "" &&
      Math.trunc(Number(contentLength)) > maxSize
    ) {
      return c.json(
        {
          error: {
            code: "PAYLOAD_TOO_LARGE",
            message: "Request entity too large",
          },
        },
        413,
      );
    }

    // oxlint-disable-next-line callback-return -- Hono middleware: the size guard returns early; nothing runs after next()
    await next();
    return undefined;
  };
};

export const requestId = (c: Context, next: Next) => {
  const id = firstNonEmpty(c.req.header("x-request-id")) ?? crypto.randomUUID();
  c.set("requestId", id);
  c.header("x-request-id", id);
  return next();
};
