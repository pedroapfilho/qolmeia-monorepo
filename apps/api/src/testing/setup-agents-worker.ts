import { spawn } from "node:child_process";
import path from "node:path";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://qolmeia:qolmeia123@localhost:5436/qolmeia?schema=agents_test";
const FIXTURE_SECRET = "vitest-fixture-service-secret-value";
const RETRY_DELAY_MS = 100;

const delay = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, RETRY_DELAY_MS);
  });

const waitForService = async (url: string, secret?: string): Promise<void> => {
  const deadline = Date.now() + 20_000;
  const attempt = async (): Promise<void> => {
    try {
      const response = await fetch(url, {
        headers: secret === undefined ? undefined : { Authorization: `Bearer ${secret}` },
      });
      if (response.ok) {
        return;
      }
    } catch (error) {
      if (Date.now() >= deadline) {
        throw error;
      }
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for ${url}`);
    }
    await delay();
    return attempt();
  };
  await attempt();
};

const setupAgentsWorker = async (): Promise<() => void> => {
  const repoRoot = path.resolve(import.meta.dirname, "../../../..");
  const fixture = spawn(
    "pnpm",
    ["--filter=api", "exec", "tsx", "src/testing/agents-fixture-server.ts"],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        AGENTS_FIXTURE_SECRET: FIXTURE_SECRET,
        DATABASE_URL: databaseUrl,
      },
      stdio: "inherit",
    },
  );
  await waitForService("http://127.0.0.1:4011/healthz", FIXTURE_SECRET);
  const api = spawn("pnpm", ["--filter=api", "exec", "tsx", "src/index.ts"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      BETTER_AUTH_SECRET: "test-secret-minimum-32-characters-long",
      CORS_ORIGINS: "http://localhost:3000",
      DATABASE_URL: databaseUrl,
      HOST: "127.0.0.1",
      INTERNAL_SHARED_SECRET: "vitest-internal-shared-secret-value",
      NODE_ENV: "test",
      PORT: "4010",
    },
    stdio: "inherit",
  });
  await waitForService("http://127.0.0.1:4010/healthz");
  return () => {
    api.kill("SIGTERM");
    fixture.kill("SIGTERM");
  };
};

export default setupAgentsWorker;
