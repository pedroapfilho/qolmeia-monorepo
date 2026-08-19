import type { AgentsApi } from "@repo/worker-api/internal";

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

type SqlFixtureCompat = {
  batch: (statements: ReadonlyArray<FixtureStatement>) => Promise<Array<FixtureResult<unknown>>>;
  prepare: (sql: string) => FixtureStatement;
};

type TestDatabase = AgentsApi & SqlFixtureCompat;

type SqlFixtureConfig = { baseUrl: string; secret: string };
type QueryMode = "all" | "run";
type FixtureRequestBody = {
  bindings: Array<unknown>;
  mode: QueryMode;
  sql: string;
};

const defaultFetch = globalThis.fetch.bind(globalThis);

const requestFixture = async <T>(
  config: SqlFixtureConfig,
  path: string,
  body?: FixtureRequestBody,
): Promise<T> => {
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${config.secret}`,
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const response = await defaultFetch(`${config.baseUrl}${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers,
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`Fixture service failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
};

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

class HttpFixtureStatement implements FixtureStatement {
  readonly #config: SqlFixtureConfig;
  readonly #sql: string;
  #bindings: Array<unknown> = [];

  constructor(config: SqlFixtureConfig, sql: string) {
    this.#config = config;
    this.#sql = toPostgres(sql);
  }

  bind(...values: Array<unknown>): this {
    this.#bindings = values;
    return this;
  }

  all<T = Record<string, unknown>>(): Promise<FixtureResult<T>> {
    return requestFixture<FixtureResult<T>>(this.#config, "/query", {
      bindings: this.#bindings,
      mode: "all" satisfies QueryMode,
      sql: this.#sql,
    });
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const { results } = await this.all<T>();
    return results[0] ?? null;
  }

  run<T = Record<string, unknown>>(): Promise<FixtureResult<T>> {
    return requestFixture<FixtureResult<T>>(this.#config, "/query", {
      bindings: this.#bindings,
      mode: "run" satisfies QueryMode,
      sql: this.#sql,
    });
  }
}

const createSqlFixtureCompat = (config: SqlFixtureConfig): SqlFixtureCompat => {
  const prepare = (sql: string): HttpFixtureStatement => new HttpFixtureStatement(config, sql);
  const batch = async (statements: ReadonlyArray<FixtureStatement>) => {
    const results: Array<FixtureResult<unknown>> = [];
    for (const statement of statements) {
      results.push(await statement.run());
    }
    return results;
  };
  return { batch, prepare };
};

const resetSqlFixture = async (config: SqlFixtureConfig): Promise<void> => {
  await requestFixture(config, "/reset");
};

export { createSqlFixtureCompat, resetSqlFixture };
export type { SqlFixtureConfig, TestDatabase };
