import type { Context } from "hono";
import { describe, expect, it, vi } from "vitest";
import { z, ZodError } from "zod";

import {
  badRequest,
  buildListResponse,
  decodeCursor,
  encodeCursor,
  forbidden,
  jsonError,
  notFound,
  parsePagination,
  validationError,
} from "./api-response";

const buildContext = () => {
  const json = vi.fn((body: unknown, status?: number) => ({ body, status }));
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

  it("badRequest → 400", () => {
    const { c, json } = buildContext();
    badRequest(c, "missing");
    expect(json).toHaveBeenCalledWith({ error: { code: "BAD_REQUEST", message: "missing" } }, 400);
  });
});

describe("validationError", () => {
  it("maps a ZodError into the 422 response with field details", () => {
    const { c, json } = buildContext();
    let zerr: ZodError | null = null;
    try {
      z.object({ name: z.string() }).parse({});
    } catch (error) {
      if (error instanceof ZodError) {
        zerr = error;
      }
    }
    validationError(c, zerr!);
    const arg = json.mock.calls[0][0] as {
      error: { code: string; details: ReadonlyArray<{ field: string; message: string }> };
    };
    expect(json.mock.calls[0][1]).toBe(422);
    expect(arg.error.code).toBe("VALIDATION_ERROR");
    expect(arg.error.details[0].field).toBe("name");
  });

  it("falls back to '(root)' when path is empty", () => {
    const { c, json } = buildContext();
    let zerr: ZodError | null = null;
    try {
      z.string().parse(123);
    } catch (error) {
      if (error instanceof ZodError) {
        zerr = error;
      }
    }
    validationError(c, zerr!);
    const arg = json.mock.calls[0][0] as {
      error: { details: ReadonlyArray<{ field: string }> };
    };
    expect(arg.error.details[0].field).toBe("(root)");
  });
});

describe("cursor helpers", () => {
  it("encode/decode round-trips an ISO date", () => {
    const d = new Date("2026-01-02T03:04:05.000Z");
    const encoded = encodeCursor(d);
    const decoded = decodeCursor(encoded);
    expect(decoded?.toISOString()).toBe(d.toISOString());
  });

  it("decodeCursor returns null for garbage input", () => {
    expect(decodeCursor("!!!not-base64!!!")).toBeNull();
  });
});

describe("parsePagination", () => {
  it("uses defaults when no params are passed", () => {
    expect(parsePagination({})).toEqual({ cursorDate: null, limit: 20 });
  });

  it("honours a valid limit up to maxLimit", () => {
    expect(parsePagination({ limit: "50", maxLimit: 100 })).toEqual({
      cursorDate: null,
      limit: 50,
    });
  });

  it("clamps an oversized limit to maxLimit", () => {
    expect(parsePagination({ limit: "9999", maxLimit: 200 })).toEqual({
      cursorDate: null,
      limit: 200,
    });
  });

  it("falls back to defaultLimit on garbage limit", () => {
    expect(parsePagination({ defaultLimit: 7, limit: "abc" })).toEqual({
      cursorDate: null,
      limit: 7,
    });
  });

  it("decodes a cursor when present", () => {
    const cursor = encodeCursor(new Date("2026-01-01T00:00:00.000Z"));
    const result = parsePagination({ cursor });
    expect(result.cursorDate?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});

const date = (offset: number) =>
  new Date(`2026-01-${String(offset).padStart(2, "0")}T00:00:00.000Z`);

describe("buildListResponse", () => {
  it("returns nextCursor=null when there are no extra rows", () => {
    const items = [{ createdAt: date(1) }, { createdAt: date(2) }];
    expect(buildListResponse(items, 5)).toEqual({ items, nextCursor: null });
  });

  it("trims the peek row and emits a cursor when there's a next page", () => {
    const items = [{ createdAt: date(1) }, { createdAt: date(2) }, { createdAt: date(3) }];
    const result = buildListResponse(items, 2);
    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).toBe(encodeCursor(date(2)));
  });

  it("uses nextCursorOf when provided", () => {
    type Row = { createdAt: Date; updatedAt: Date };
    const items: ReadonlyArray<Row> = [
      { createdAt: date(1), updatedAt: date(5) },
      { createdAt: date(2), updatedAt: date(6) },
      { createdAt: date(3), updatedAt: date(7) },
    ];
    const result = buildListResponse<Row>(items, 2, (r) => r.updatedAt);
    expect(result.nextCursor).toBe(encodeCursor(date(6)));
  });
});
