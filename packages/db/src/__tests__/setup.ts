import dotenv from "dotenv";
import { vi } from "vitest";

const result = dotenv.config({
  path: new URL("../../.env", import.meta.url).pathname,
});

if (result.parsed?.DATABASE_URL) {
  vi.stubEnv("DATABASE_URL", result.parsed.DATABASE_URL);
}
