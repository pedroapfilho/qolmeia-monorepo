import dotenv from "dotenv";
import { vi } from "vitest";

// Load DATABASE_URL and other secrets from the auth app's .env so
// integration tests can reach the local Postgres instance.
const result = dotenv.config({
  path: new URL("../../../../apps/auth/.env", import.meta.url).pathname,
});

if (result.parsed?.DATABASE_URL) {
  vi.stubEnv("DATABASE_URL", result.parsed.DATABASE_URL);
}
