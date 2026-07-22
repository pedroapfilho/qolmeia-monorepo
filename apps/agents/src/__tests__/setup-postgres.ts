import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://qolmeia:qolmeia123@localhost:5436/qolmeia?schema=agents_test";

const setupPostgres = async (): Promise<void> => {
  await execFileAsync("pnpm", ["--filter=@repo/db", "db:push"], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
};

export default setupPostgres;
