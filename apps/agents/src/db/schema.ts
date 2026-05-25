// Typed row shapes + query helpers for the P1 D1 slice. No ORM — plain
// parameterized statements. D1's generic `first<T>()` / `all<T>()` give the
// snake_case row type; mapping functions convert to the camelCase domain shape.

type CompanyStatus = "onboarding" | "active" | "paused";
type MessageRole = "user" | "agent" | "system";

type Company = {
  brief: string | null;
  createdAt: number;
  id: string;
  locale: string;
  name: string;
  slug: string;
  status: CompanyStatus;
  timezone: string;
  updatedAt: number;
};

type Conversation = {
  companyId: string;
  createdAt: number;
  externalThreadId: string;
  id: string;
  userId: string | null;
};

type Message = {
  agentInstanceId: string | null;
  attachments: string | null;
  companyId: string;
  content: string;
  conversationId: string;
  createdAt: number;
  id: string;
  role: MessageRole;
};

type CompanyRow = {
  brief: string | null;
  created_at: number;
  id: string;
  locale: string;
  name: string;
  slug: string;
  status: string;
  timezone: string;
  updated_at: number;
};

type ConversationRow = {
  company_id: string;
  created_at: number;
  external_thread_id: string;
  id: string;
  user_id: string | null;
};

type MessageRow = {
  agent_instance_id: string | null;
  attachments: string | null;
  company_id: string;
  content: string;
  conversation_id: string;
  created_at: number;
  id: string;
  role: string;
};

const COMPANY_STATUSES: ReadonlyArray<CompanyStatus> = ["onboarding", "active", "paused"];
const MESSAGE_ROLES: ReadonlyArray<MessageRole> = ["user", "agent", "system"];

// The DB CHECK constraint already guarantees these; the guards keep the
// mapping total without a type assertion.
const toCompanyStatus = (value: string): CompanyStatus =>
  COMPANY_STATUSES.find((status) => status === value) ?? "onboarding";

const toMessageRole = (value: string): MessageRole =>
  MESSAGE_ROLES.find((role) => role === value) ?? "system";

const mapCompany = (row: CompanyRow): Company => ({
  brief: row.brief,
  createdAt: row.created_at,
  id: row.id,
  locale: row.locale,
  name: row.name,
  slug: row.slug,
  status: toCompanyStatus(row.status),
  timezone: row.timezone,
  updatedAt: row.updated_at,
});

const mapConversation = (row: ConversationRow): Conversation => ({
  companyId: row.company_id,
  createdAt: row.created_at,
  externalThreadId: row.external_thread_id,
  id: row.id,
  userId: row.user_id,
});

const mapMessage = (row: MessageRow): Message => ({
  agentInstanceId: row.agent_instance_id,
  attachments: row.attachments,
  companyId: row.company_id,
  content: row.content,
  conversationId: row.conversation_id,
  createdAt: row.created_at,
  id: row.id,
  role: toMessageRole(row.role),
});

const getCompany = async (db: D1Database, id: string): Promise<Company | null> => {
  const row = await db.prepare("SELECT * FROM company WHERE id = ?").bind(id).first<CompanyRow>();
  return row ? mapCompany(row) : null;
};

type UpsertConversationInput = {
  companyId: string;
  externalThreadId: string;
  id: string;
  userId?: string | null;
};

// Idempotent on (company_id, external_thread_id): a repeat call returns the
// existing row rather than creating a duplicate conversation.
const upsertConversation = async (
  db: D1Database,
  input: UpsertConversationInput,
): Promise<Conversation> => {
  await db
    .prepare(
      `INSERT INTO conversation (id, company_id, external_thread_id, user_id, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (company_id, external_thread_id) DO NOTHING`,
    )
    .bind(input.id, input.companyId, input.externalThreadId, input.userId ?? null, Date.now())
    .run();

  const row = await db
    .prepare("SELECT * FROM conversation WHERE company_id = ? AND external_thread_id = ?")
    .bind(input.companyId, input.externalThreadId)
    .first<ConversationRow>();

  if (!row) {
    throw new Error(`upsertConversation: row missing after insert for ${input.externalThreadId}`);
  }
  return mapConversation(row);
};

type InsertMessageInput = {
  agentInstanceId?: string | null;
  attachments?: string | null;
  companyId: string;
  content: string;
  conversationId: string;
  id: string;
  role: MessageRole;
};

// `INSERT OR IGNORE` keeps persistence idempotent on the message id — a
// re-delivered chat turn never duplicates a row.
const insertMessage = async (db: D1Database, input: InsertMessageInput): Promise<void> => {
  await db
    .prepare(
      `INSERT OR IGNORE INTO message
         (id, company_id, conversation_id, agent_instance_id, role, content, attachments, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.companyId,
      input.conversationId,
      input.agentInstanceId ?? null,
      input.role,
      input.content,
      input.attachments ?? null,
      Date.now(),
    )
    .run();
};

const listMessages = async (
  db: D1Database,
  conversationId: string,
  limit = 100,
): Promise<ReadonlyArray<Message>> => {
  const { results } = await db
    .prepare("SELECT * FROM message WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ?")
    .bind(conversationId, limit)
    .all<MessageRow>();
  return results.map(mapMessage);
};

// ── memory_fact (P2 active table) ─────────────────────────────

type MemoryFact = {
  agentInstanceId: string;
  companyId: string;
  content: string;
  createdAt: number;
  id: string;
  kind: string;
  salience: number;
};

type MemoryFactRow = {
  agent_instance_id: string;
  company_id: string;
  content: string;
  created_at: number;
  id: string;
  kind: string;
  salience: number;
};

const mapMemoryFact = (row: MemoryFactRow): MemoryFact => ({
  agentInstanceId: row.agent_instance_id,
  companyId: row.company_id,
  content: row.content,
  createdAt: row.created_at,
  id: row.id,
  kind: row.kind,
  salience: row.salience,
});

type InsertMemoryFactInput = {
  agentInstanceId: string;
  companyId: string;
  content: string;
  id: string;
  kind: string;
  salience?: number;
};

const insertMemoryFact = async (db: D1Database, input: InsertMemoryFactInput): Promise<void> => {
  await db
    .prepare(
      `INSERT OR IGNORE INTO memory_fact
         (id, company_id, agent_instance_id, kind, content, salience, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.companyId,
      input.agentInstanceId,
      input.kind,
      input.content,
      input.salience ?? 0.5,
      Date.now(),
    )
    .run();
};

const listMemoryFacts = async (
  db: D1Database,
  agentInstanceId: string,
  limit = 100,
): Promise<ReadonlyArray<MemoryFact>> => {
  const { results } = await db
    .prepare(
      "SELECT * FROM memory_fact WHERE agent_instance_id = ? ORDER BY created_at DESC LIMIT ?",
    )
    .bind(agentInstanceId, limit)
    .all<MemoryFactRow>();
  return results.map(mapMemoryFact);
};

export {
  getCompany,
  insertMemoryFact,
  insertMessage,
  listMemoryFacts,
  listMessages,
  upsertConversation,
};
export type { Company, Conversation, MemoryFact, Message, MessageRole };
