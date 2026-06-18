import { vi } from "vitest";

// Stub required env vars before any module that imports env.ts is loaded.
// Auth-only schema as of P7.2 — see env.ts for the full list.
vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-minimum-32-characters-long");
vi.stubEnv("DATABASE_URL", "postgresql://u:p@localhost:5432/db");
// Tests assume the org-create relay secret is set. Without it the orgs
// route refuses to call the agents Worker (fail-closed) and every happy
// path returns `d1Provisioned: false`.
vi.stubEnv("INTERNAL_SHARED_SECRET", "test-internal-secret-rotate-me");
