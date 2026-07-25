import type { PrismaClient } from "@repo/db/worker";

type FixtureResult<T> = {
  meta?: { changes: number };
  results: Array<T>;
  success: boolean;
};

type FixtureStatement = {
  all: <T = Record<string, unknown>>() => Promise<FixtureResult<T>>;
  bind: (...values: Array<unknown>) => FixtureStatement;
  first: <T = Record<string, unknown>>() => Promise<T | null>;
  run: <T = Record<string, unknown>>() => Promise<FixtureResult<T>>;
};

type TestDatabase = PrismaClient & {
  batch: (statements: ReadonlyArray<FixtureStatement>) => Promise<Array<FixtureResult<unknown>>>;
  prepare: (sql: string) => FixtureStatement;
};

const JSON_COLUMNS = new Set([
  "brief",
  "can_delegate_to",
  "default_config",
  "default_policies",
  "metadata",
  "param_hints",
  "payload",
  "proposed",
  "result",
  "skill_ids",
]);

// oxlint-disable-next-line no-unnecessary-type-parameters -- mirrors D1's PreparedStatement.all<T>(): the row shape is asserted by the caller, as the real binding does
const normalizeRow = <T>(row: Record<string, unknown>): T =>
  Object.fromEntries(
    Object.entries(row).map(([key, value]) => {
      if (value instanceof Date) {
        return [key, value.getTime()];
      }
      if (JSON_COLUMNS.has(key) && value !== null && typeof value !== "string") {
        return [key, JSON.stringify(value)];
      }
      if (typeof value === "bigint") {
        return [key, Number(value)];
      }
      if (typeof value === "boolean") {
        return [key, value ? 1 : 0];
      }
      return [key, value];
    }),
  ) as T;

const primaryKeyFor = (table: string): ReadonlyArray<string> => {
  if (table === "team_member") {
    return ["team_id", "agent_instance_id"];
  }
  if (table === "company_template_entitlement") {
    return ["company_id", "template_id"];
  }
  return ["id"];
};

const transformInsert = (input: string): string => {
  const behavior = /INSERT OR (?<behavior>IGNORE|REPLACE) INTO/iv.exec(input)?.groups?.behavior;
  let sql = input.replace(/INSERT OR (?:IGNORE|REPLACE) INTO/iv, "INSERT INTO").trim();
  const match =
    /INSERT INTO\s+["']?(?<table>[a-z_]+)["']?\s*\((?<columns>[^\)]+)\)\s*VALUES\s*\((?<values>[\s\S]+)\)\s*;?$/iv.exec(
      sql,
    );
  if (!match?.groups) {
    return sql;
  }
  const columns = match.groups.columns.split(",").map((value) => value.trim().replaceAll('"', ""));
  const values = match.groups.values.split(",").map((value) => value.trim());
  const converted = values.map((value, index) =>
    columns[index]?.endsWith("_at") && (value === "?" || /^\d+$/v.test(value))
      ? `to_timestamp(${value} / 1000.0)`
      : value,
  );
  sql = sql.replace(match.groups.values, converted.join(", ")).replace(/;$/v, "");
  if (behavior === "IGNORE") {
    return `${sql} ON CONFLICT DO NOTHING`;
  }
  if (behavior === "REPLACE") {
    const keys = primaryKeyFor(match.groups.table);
    const updates = columns
      .filter((column) => !keys.includes(column))
      .map((column) => `"${column}" = EXCLUDED."${column}"`)
      .join(", ");
    return `${sql} ON CONFLICT (${keys.map((key) => `"${key}"`).join(", ")}) DO UPDATE SET ${updates}`;
  }
  return sql;
};

const transformInsertSelect = (input: string): string => {
  const behavior = /INSERT OR (?<behavior>IGNORE|REPLACE) INTO/iv.exec(input)?.groups?.behavior;
  let sql = input.replace(/INSERT OR (?:IGNORE|REPLACE) INTO/iv, "INSERT INTO").trim();
  const match =
    /INSERT INTO\s+["']?(?<table>[a-z_]+)["']?\s*\((?<columns>[^\)]+)\)\s*SELECT\s+(?<values>[\s\S]+?)\s+FROM\s+/iv.exec(
      sql,
    );
  if (!match?.groups) {
    return sql;
  }
  const columns = match.groups.columns.split(",").map((value) => value.trim().replaceAll('"', ""));
  const values = match.groups.values.split(",").map((value) => value.trim());
  const converted = values.map((value, index) =>
    columns[index]?.endsWith("_at") && (value === "?" || /^\d+$/v.test(value))
      ? `to_timestamp(${value} / 1000.0)`
      : value,
  );
  sql = sql.replace(match.groups.values, converted.join(", ")).replace(/;$/v, "");
  if (behavior === "IGNORE") {
    return `${sql} ON CONFLICT DO NOTHING`;
  }
  return sql;
};

const toPostgres = (input: string): string => {
  let sql = input;
  if (/^\s*INSERT\s+/iv.test(input)) {
    sql = /\)\s*SELECT\s+/iv.test(input) ? transformInsertSelect(input) : transformInsert(input);
  }
  let index = 0;
  sql = sql.replaceAll("?", () => `$${++index}`);
  return sql;
};

class PrismaFixtureStatement implements FixtureStatement {
  readonly #db: PrismaClient;
  readonly #sql: string;
  #bindings: Array<unknown> = [];

  constructor(db: PrismaClient, sql: string) {
    this.#db = db;
    this.#sql = toPostgres(sql);
  }

  bind(...values: Array<unknown>): this {
    this.#bindings = values;
    return this;
  }

  async all<T = Record<string, unknown>>(): Promise<FixtureResult<T>> {
    const rows = await this.#db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      this.#sql,
      ...this.#bindings,
    );
    return { results: rows.map(normalizeRow<T>), success: true };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const { results } = await this.all<T>();
    return results[0] ?? null;
  }

  async run<T = Record<string, unknown>>(): Promise<FixtureResult<T>> {
    const changes = await this.#db.$executeRawUnsafe(this.#sql, ...this.#bindings);
    return { meta: { changes }, results: [], success: true };
  }
}

const createSqlFixtureCompat = (db: PrismaClient): TestDatabase => {
  const prepare = (sql: string): PrismaFixtureStatement => new PrismaFixtureStatement(db, sql);
  const batch = async (statements: ReadonlyArray<FixtureStatement>) => {
    const results: Array<FixtureResult<unknown>> = [];
    for (const statement of statements) {
      // oxlint-disable-next-line no-await-in-loop -- SQL fixture batches preserve statement order.
      results.push(await statement.run());
    }
    return results;
  };
  return Object.assign(db, { batch, prepare });
};

export { createSqlFixtureCompat };
export type { TestDatabase };
