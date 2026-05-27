import dotenv from "dotenv";
import { vi } from "vitest";

// Integration tests need a real DATABASE_URL to reach local Postgres.
// We read it from this package's own `.env` (copied from `.env.example`)
// so the test setup doesn't reach across into a sibling app's env file.
const result = dotenv.config({
  path: new URL("../../.env", import.meta.url).pathname,
});

if (result.parsed?.DATABASE_URL) {
  vi.stubEnv("DATABASE_URL", result.parsed.DATABASE_URL);
}
