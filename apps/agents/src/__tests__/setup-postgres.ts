import { execFile } from "node:child_process";
import { promisify } from "node:util";

// oxlint-disable-next-line strict-void-return -- execFile returns a ChildProcess while promisify's parameter is typed void-returning; promisify resolves execFile's own promisified form
const execFileAsync = promisify(execFile);
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://qolmeia:qolmeia123@localhost:5436/qolmeia?schema=agents_test";

/**
 * Prisma recreates columns when converting strings to enums. This targets the
 * throwaway `agents_test` schema, which each test run resets and reseeds.
 * Production databases use prisma/migrations/manual instead.
 */
const setupPostgres = async (): Promise<void> => {
  await execFileAsync(
    "pnpm",
    ["--filter=@repo/db", "exec", "prisma", "db", "push", "--accept-data-loss"],
    { env: { ...process.env, DATABASE_URL: databaseUrl } },
  );
};

export default setupPostgres;
