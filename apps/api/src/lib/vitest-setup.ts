import { vi } from "vitest";

// Stub required env vars before any module that imports env.ts is loaded.
// This prevents the fail-fast throw in env.ts during unit tests.
vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-minimum-32-characters-long");
vi.stubEnv("DATABASE_URL", "postgresql://u:p@localhost:5432/db");
vi.stubEnv("R2_ACCESS_KEY_ID", "test-r2-key");
vi.stubEnv("R2_ACCOUNT_ID", "test-account");
vi.stubEnv("R2_BUCKET", "test-bucket");
vi.stubEnv("R2_ENDPOINT", "https://test.r2.cloudflarestorage.com");
vi.stubEnv("R2_REGION", "auto");
vi.stubEnv("R2_SECRET_ACCESS_KEY", "test-r2-secret");
vi.stubEnv("REDIS_URL", "redis://localhost:6379");
vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:abc");
vi.stubEnv("TELEGRAM_BOT_USERNAME", "qolmeia_bot");
vi.stubEnv("TELEGRAM_WEBHOOK_SECRET_TOKEN", "secret");
