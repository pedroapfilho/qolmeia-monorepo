import { Prisma } from "@repo/db";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

vi.mock("@/lib/env", () => ({
  env: { NODE_ENV: "development" },
}));

import { env } from "@/lib/env";

import { errorHandler, notFound } from "./error-handler";

const mockLogger = { error: vi.fn(), info: vi.fn() };

const createMockContext = (headers: Record<string, string> = {}) => {
  return {
    get: vi.fn((key: string) => (key === "log" ? mockLogger : undefined)),
    json: vi.fn((body: unknown, status?: number) => ({ body, status })),
    req: {
      header: vi.fn((name: string) => headers[name]),
      method: "GET",
      url: "http://localhost/test",
    },
  } as unknown as Context & { json: ReturnType<typeof vi.fn> };
};

const prismaKnownError = (code: string, message: string) =>
  new Prisma.PrismaClientKnownRequestError(message, { clientVersion: "7.0.0", code });

describe("errorHandler", () => {
  it("should handle HTTPException", () => {
    const c = createMockContext();
    const err = new HTTPException(403, { message: "Forbidden" });

    errorHandler(err, c);

    expect(c.json).toHaveBeenCalledWith(
      { error: { code: "HTTP_EXCEPTION", message: "Forbidden" } },
      403,
    );
  });

  it("should handle ZodError with field details", () => {
    const c = createMockContext();
    const err = new ZodError([
      {
        code: "too_small",
        inclusive: true,
        message: "Required",
        minimum: 1,
        origin: "string",
        path: ["name"],
      },
    ]);

    errorHandler(err, c);

    expect(c.json).toHaveBeenCalledWith(
      {
        error: {
          code: "VALIDATION_ERROR",
          details: [{ field: "name", message: "Required" }],
          message: "Validation failed",
        },
      },
      400,
    );
  });

  it("should handle P2002 as 409 DUPLICATE_ENTRY", () => {
    const c = createMockContext();
    const err = prismaKnownError("P2002", "Unique constraint failed");

    errorHandler(err, c);

    expect(c.json).toHaveBeenCalledWith(
      { error: { code: "DUPLICATE_ENTRY", message: "A record with this value already exists" } },
      409,
    );
  });

  it("should handle P2025 as 404 NOT_FOUND", () => {
    const c = createMockContext();
    const err = prismaKnownError("P2025", "Record not found");

    errorHandler(err, c);

    expect(c.json).toHaveBeenCalledWith(
      { error: { code: "NOT_FOUND", message: "Record not found" } },
      404,
    );
  });

  it("should include error message and stack in development", () => {
    const c = createMockContext();
    const err = new Error("dev error");

    errorHandler(err, c);

    const call = c.json.mock.calls[0];
    expect(call?.[0]?.error?.message).toBe("dev error");
    expect(call?.[0]?.error?.stack).toBeDefined();
    expect(call?.[1]).toBe(500);
  });

  it("should hide error message in production", () => {
    const mutableEnv = env as { NODE_ENV: string };
    mutableEnv.NODE_ENV = "production";

    const c = createMockContext();
    const err = new Error("secret detail");

    errorHandler(err, c);

    const call = c.json.mock.calls[0];
    expect(call?.[0]?.error?.message).toBe("An unexpected error occurred");
    expect(call?.[0]?.error?.stack).toBeUndefined();

    mutableEnv.NODE_ENV = "development";
  });
});

describe("notFound", () => {
  it("should return 404 with NOT_FOUND code", () => {
    const c = createMockContext();

    notFound(c);

    expect(c.json).toHaveBeenCalledWith(
      { error: { code: "NOT_FOUND", message: "Resource not found" } },
      404,
    );
  });
});
