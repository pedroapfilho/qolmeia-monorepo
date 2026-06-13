import type { Context } from "hono";
import type { ZodError } from "zod";

// Canonical error/list response shapes for /api/v1/*. Keeping every list
// route on `{ items, nextCursor }` and every error on `{ error: { code, message } }`
// means the backoffice client can share one fetch wrapper across all
// endpoints.

type ApiErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "INTERNAL_SERVER_ERROR";

type ApiErrorBody = {
  error: {
    code: ApiErrorCode | string;
    details?: ReadonlyArray<{ field: string; message: string }>;
    message: string;
  };
};

type ApiListBody<T> = {
  items: ReadonlyArray<T>;
  nextCursor: string | null;
};

// Inline use sites read more clearly than buildJsonError(c, ...) — exported
// as functions so the call sites stay consistent and the response shape is
// changed in one place if we ever extend it.
type JsonErrorArgs = {
  c: Context;
  code: ApiErrorCode | string;
  details?: ReadonlyArray<{ field: string; message: string }>;
  message: string;
  status: 400 | 401 | 403 | 404 | 422 | 500;
};

const jsonError = (args: JsonErrorArgs) => {
  const body: ApiErrorBody = {
    error: {
      code: args.code,
      ...(args.details ? { details: args.details } : {}),
      message: args.message,
    },
  };
  return args.c.json(body, args.status);
};

const notFound = (c: Context, message = "Resource not found") =>
  jsonError({ c, code: "NOT_FOUND", message, status: 404 });

const forbidden = (c: Context, message = "Forbidden") =>
  jsonError({ c, code: "FORBIDDEN", message, status: 403 });

const badRequest = (c: Context, message: string) =>
  jsonError({ c, code: "BAD_REQUEST", message, status: 400 });

// Maps a ZodError into the 422 validation response shape. Picking 422
// (Unprocessable Entity) over 400 matches REST norms and lets the backoffice
// distinguish "you sent us valid JSON but the body's wrong" from "the URL
// or method is wrong".
const validationError = (c: Context, error: ZodError) => {
  const details = error.issues.map((issue) => ({
    field: issue.path.map(String).join(".") || "(root)",
    message: issue.message,
  }));
  return jsonError({
    c,
    code: "VALIDATION_ERROR",
    details,
    message: "Validation failed",
    status: 422,
  });
};

// Encodes a Date as an opaque base64 cursor. The backoffice should treat
// the value as a black-box — we control both ends. Tests rely on the
// concrete encoding so leaving this stable for now.
const encodeCursor = (date: Date): string =>
  Buffer.from(date.toISOString(), "utf8").toString("base64url");

const decodeCursor = (cursor: string): Date | null => {
  try {
    const iso = Buffer.from(cursor, "base64url").toString("utf8");
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return date;
  } catch {
    return null;
  }
};

// Default pagination knobs. List endpoints can override `defaultLimit` and
// `maxLimit` when their workloads warrant it (the activity log allows up to
// 200; everything else stays at 50).
type ParsePaginationArgs = {
  cursor?: string | null | undefined;
  defaultLimit?: number;
  limit?: string | null | undefined;
  maxLimit?: number;
};

type ParsedPagination = {
  cursorDate: Date | null;
  limit: number;
};

const parsePagination = (args: ParsePaginationArgs): ParsedPagination => {
  const defaultLimit = args.defaultLimit ?? 20;
  const maxLimit = args.maxLimit ?? 100;
  let limit = defaultLimit;
  if (typeof args.limit === "string" && args.limit.length > 0) {
    const parsed = Number.parseInt(args.limit, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      limit = Math.min(parsed, maxLimit);
    }
  }
  const cursorDate = args.cursor ? decodeCursor(args.cursor) : null;
  return { cursorDate, limit };
};

// Wraps a Prisma-ish result (with one extra row peeked to detect the next
// page) into the `{ items, nextCursor }` shape. Pass `nextCursorOf` to
// extract the cursor key (default: row.createdAt).
const buildListResponse = <T extends { createdAt: Date }>(
  rows: ReadonlyArray<T>,
  limit: number,
  nextCursorOf?: (row: T) => Date,
): ApiListBody<T> => {
  if (rows.length <= limit) {
    return { items: rows, nextCursor: null };
  }
  const items = rows.slice(0, limit);
  const lastIncluded = items.at(-1);
  if (!lastIncluded) {
    return { items, nextCursor: null };
  }
  const cursorDate = nextCursorOf ? nextCursorOf(lastIncluded) : lastIncluded.createdAt;
  return { items, nextCursor: encodeCursor(cursorDate) };
};

export {
  badRequest,
  buildListResponse,
  decodeCursor,
  encodeCursor,
  forbidden,
  jsonError,
  notFound,
  parsePagination,
  validationError,
};
export type { ApiListBody, ParsedPagination };
