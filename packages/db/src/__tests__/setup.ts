import dotenv from "dotenv";
import { vi } from "vitest";

const result = dotenv.config({
  path: new URL("../../.env", import.meta.url).pathname,
});

const parsedDatabaseUrl = result.parsed?.DATABASE_URL;
if (parsedDatabaseUrl !== undefined && parsedDatabaseUrl !== "") {
  vi.stubEnv("DATABASE_URL", parsedDatabaseUrl);
}
