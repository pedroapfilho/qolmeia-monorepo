import type { Context } from "hono";
import { describe, expect, it, vi } from "vitest";

import { forbidden, jsonError, notFound, unauthorized } from "./api-response";

type JsonBody =
  | boolean
  | number
  | string
  | null
  | ReadonlyArray<JsonBody>
  | { readonly [key: string]: JsonBody | undefined };

const buildContext = () => {
  const json = vi.fn((body: JsonBody, status?: number) => ({ body, status }));
  return { c: { json } as unknown as Context, json };
};

describe("jsonError", () => {
  it("returns the canonical error shape", () => {
    const { c, json } = buildContext();
    jsonError({ c, code: "BAD_REQUEST", message: "x", status: 400 });
    expect(json).toHaveBeenCalledWith({ error: { code: "BAD_REQUEST", message: "x" } }, 400);
  });

  it("includes details when provided", () => {
    const { c, json } = buildContext();
    jsonError({
      c,
      code: "VALIDATION_ERROR",
      details: [{ field: "name", message: "required" }],
      message: "y",
      status: 422,
    });
    expect(json).toHaveBeenCalledWith(
      {
        error: {
          code: "VALIDATION_ERROR",
          details: [{ field: "name", message: "required" }],
          message: "y",
        },
      },
      422,
    );
  });

  it("includes zod issues when provided", () => {
    const { c, json } = buildContext();
    const issues = [
      {
        code: "invalid_type" as const,
        expected: "string" as const,
        message: "bad",
        path: ["slug"],
      },
    ];
    jsonError({ c, code: "INVALID_BODY", issues, message: "Invalid body", status: 400 });
    expect(json).toHaveBeenCalledWith(
      { error: { code: "INVALID_BODY", issues, message: "Invalid body" } },
      400,
    );
  });
});

describe("convenience helpers", () => {
  it("notFound → 404", () => {
    const { c, json } = buildContext();
    notFound(c);
    expect(json).toHaveBeenCalledWith(
      { error: { code: "NOT_FOUND", message: "Resource not found" } },
      404,
    );
  });

  it("forbidden → 403", () => {
    const { c, json } = buildContext();
    forbidden(c, "no");
    expect(json).toHaveBeenCalledWith({ error: { code: "FORBIDDEN", message: "no" } }, 403);
  });

  it("unauthorized → 401", () => {
    const { c, json } = buildContext();
    unauthorized(c);
    expect(json).toHaveBeenCalledWith(
      { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
      401,
    );
  });

  it("unauthorized takes a custom message", () => {
    const { c, json } = buildContext();
    unauthorized(c, "Sign in first");
    expect(json).toHaveBeenCalledWith(
      { error: { code: "UNAUTHORIZED", message: "Sign in first" } },
      401,
    );
  });
});
