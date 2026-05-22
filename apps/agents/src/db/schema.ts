// Typed row shapes + query helpers for the P1 D1 slice. No ORM — plain
// parameterized statements. D1's generic `first<T>()` / `all<T>()` give the
// snake_case row type; mapping functions convert to the camelCase domain shape.

type CompanyStatus = "onboarding" | "active" | "paused";
type MessageRole = "user" | "agent" | "system";

type Company = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  locale: string;
  status: CompanyStatus;
  brief: string | null;
  createdAt: number;
  updatedAt: number;
};

type Conversation = {
  id: string;
  companyId: string;
  externalThreadId: string;
  userId: string | null;
  createdAt: number;
};

type Message = {
  id: string;
  companyId: string;
  conversationId: string;
  agentInstanceId: string | null;
  role: MessageRole;
  content: string;
  attachments: string | null;
  createdAt: number;
};

type CompanyRow = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  locale: string;
  status: string;
  brief: string | null;
  created_at: number;
  updated_at: number;
};

type ConversationRow = {
  id: string;
  company_id: string;
  external_thread_id: string;
  user_id: string | null;
  created_at: number;
};

type MessageRow = {
  id: string;
  company_id: string;
  conversation_id: string;
  agent_instance_id: string | null;
  role: string;
  content: string;
  attachments: string | null;
  created_at: number;
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
  id: row.id,
  name: row.name,
  slug: row.slug,
  timezone: row.timezone,
  locale: row.locale,
  status: toCompanyStatus(row.status),
  brief: row.brief,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapConversation = (row: ConversationRow): Conversation => ({
  id: row.id,
  companyId: row.company_id,
  externalThreadId: row.external_thread_id,
  userId: row.user_id,
  createdAt: row.created_at,
});

const mapMessage = (row: MessageRow): Message => ({
  id: row.id,
  companyId: row.company_id,
  conversationId: row.conversation_id,
  agentInstanceId: row.agent_instance_id,
  role: toMessageRole(row.role),
  content: row.content,
  attachments: row.attachments,
  createdAt: row.created_at,
});

const getCompany = async (db: D1Database, id: string): Promise<Company | null> => {
  const row = await db.prepare("SELECT * FROM company WHERE id = ?").bind(id).first<CompanyRow>();
  return row ? mapCompany(row) : null;
};

type UpsertConversationInput = {
  id: string;
  companyId: string;
  externalThreadId: string;
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
  id: string;
  companyId: string;
  conversationId: string;
  agentInstanceId?: string | null;
  role: MessageRole;
  content: string;
  attachments?: string | null;
};

const insertMessage = async (db: D1Database, input: InsertMessageInput): Promise<void> => {
  await db
    .prepare(
      `INSERT INTO message
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

export { getCompany, insertMessage, listMessages, upsertConversation };
export type { Company, Conversation, Message, MessageRole };
