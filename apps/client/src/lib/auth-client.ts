"use client";

import { createBetterAuthClient } from "@repo/auth/client";

// Same-origin by default: next.config.ts rewrites /api/auth/* to the auth
// service, so every auth call (and its session cookie) stays first-party on
// this app's origin. Browsers treat `.localhost` as a public suffix, so a
// cross-origin auth service under portless could never set a cookie this app
// can read — same-origin is the only shape that works everywhere.
//
// With an empty baseURL, Better Auth's client resolves the browser's own
// origin + /api/auth at request time (and SSR never fetches — all call sites
// are "use client"). NEXT_PUBLIC_AUTH_URL stays as an OVERRIDE for a
// genuinely cross-origin deployment (e.g. prod auth on a sibling subdomain
// that shares a registrable domain for cookies). Better Auth validates
// non-empty baseURLs as absolute URLs, so the override appends /api/auth to
// an absolute origin.
const authUrl = process.env.NEXT_PUBLIC_AUTH_URL;

export const authClient = createBetterAuthClient(authUrl ? `${authUrl}/api/auth` : "");
