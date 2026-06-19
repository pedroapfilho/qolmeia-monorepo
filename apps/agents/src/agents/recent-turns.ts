import type { AIChatAgent } from "@cloudflare/ai-chat";

// The recent-turns buffer is the *model-context window* — what the agent
// always sees regardless of vector recall. It lives in the DO's own SQLite
// (`this.sql`), separate from the SDK's `messages` list (which is the
// *client-history window* for reconnect / mount). Mixing those two is the
// dual-storage trap; keep them as distinct concepts.

type RecentTurn = {
  content: string;
  createdAt: number;
  role: "agent" | "user";
};

type TurnRow = { content: string; created_at: number; role: string };

// `agent.sql` returns the query result; for write statements we discard it
// with `void` so oxlint's no-unused-expressions rule sees the intent.
const ensureTable = (agent: AIChatAgent<Env>): void => {
  void agent.sql`CREATE TABLE IF NOT EXISTS recent_turns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`;
};

const appendTurn = (agent: AIChatAgent<Env>, role: RecentTurn["role"], content: string): void => {
  ensureTable(agent);
  const now = Date.now();
  void agent.sql`INSERT INTO recent_turns (role, content, created_at) VALUES (${role}, ${content}, ${now})`;
};

// Returns turns oldest-first so the array is consumable as a chat history.
const getRecentTurns = (agent: AIChatAgent<Env>, limit = 12): Array<RecentTurn> => {
  ensureTable(agent);
  const rows = agent.sql<TurnRow>`SELECT role, content, created_at FROM recent_turns ORDER BY id DESC LIMIT ${limit}`;
  return rows.toReversed().map((row) => ({
    content: row.content,
    createdAt: row.created_at,
    role: row.role === "user" ? "user" : "agent",
  }));
};

const pruneOldTurns = (agent: AIChatAgent<Env>, keep = 100): void => {
  ensureTable(agent);
  void agent.sql`DELETE FROM recent_turns WHERE id NOT IN (SELECT id FROM recent_turns ORDER BY id DESC LIMIT ${keep})`;
};

// Empties the model-context window — used by "start over" so the next turn
// begins with no recollection of the prior chat. The SDK message store, D1
// audit, and long-term memory are separate and untouched here.
const clearRecentTurns = (agent: AIChatAgent<Env>): void => {
  ensureTable(agent);
  void agent.sql`DELETE FROM recent_turns`;
};

export { appendTurn, clearRecentTurns, getRecentTurns, pruneOldTurns };
export type { RecentTurn };
