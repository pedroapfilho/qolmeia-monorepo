import { vi } from "vitest";

vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-minimum-32-characters-long");
vi.stubEnv("DATABASE_URL", "postgresql://u:p@localhost:5432/db");
vi.stubEnv("INTERNAL_SHARED_SECRET", "test-internal-shared-secret-minimum-32-chars");
