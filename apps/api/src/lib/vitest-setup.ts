import { vi } from "vitest";

// Stub required env vars before any module that imports env.ts is loaded.
// This prevents the fail-fast throw in env.ts during unit tests.
vi.stubEnv("DATABASE_URL", "postgresql://u:p@localhost:5432/db");
vi.stubEnv("REDIS_URL", "redis://localhost:6379");
vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:abc");
vi.stubEnv("TELEGRAM_BOT_USERNAME", "qolmeia_bot");
vi.stubEnv("TELEGRAM_WEBHOOK_SECRET_TOKEN", "secret");
