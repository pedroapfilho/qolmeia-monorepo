import type { Context } from "hono";
import type { ZodError } from "zod";

type ApiErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "INTERNAL_SERVER_ERROR";

type ApiErrorBody = {
  error: {
    code: ApiErrorCode | (string & Record<never, never>);
    details?: ReadonlyArray<{ field: string; message: string }>;
    issues?: ZodError["issues"];
    message: string;
  };
};

type JsonErrorArgs = {
  c: Context;
  code: ApiErrorCode | (string & Record<never, never>);
  details?: ReadonlyArray<{ field: string; message: string }>;
  issues?: ZodError["issues"];
  message: string;
  status: 400 | 401 | 403 | 404 | 409 | 422 | 500;
};

const jsonError = (args: JsonErrorArgs) => {
  const body: ApiErrorBody = {
    error: {
      code: args.code,
      ...(args.details ? { details: args.details } : {}),
      ...(args.issues ? { issues: args.issues } : {}),
      message: args.message,
    },
  };
  return args.c.json(body, args.status);
};

const notFound = (c: Context, message = "Resource not found") =>
  jsonError({ c, code: "NOT_FOUND", message, status: 404 });

const forbidden = (c: Context, message = "Forbidden") =>
  jsonError({ c, code: "FORBIDDEN", message, status: 403 });

const unauthorized = (c: Context, message = "Authentication required") =>
  jsonError({ c, code: "UNAUTHORIZED", message, status: 401 });

export { forbidden, jsonError, notFound, unauthorized };
