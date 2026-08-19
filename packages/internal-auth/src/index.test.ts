import { describe, expect, it } from "vitest";

import { constantTimeEqual, readBearerToken, verifyInternalSecret } from "./index";

describe("constantTimeEqual", () => {
  it("returns true for identical strings", () => {
    expect(constantTimeEqual("super-secret-token", "super-secret-token")).toBe(true);
  });

  it("returns false for different strings of equal length", () => {
    expect(constantTimeEqual("super-secret-token", "super-secret-toben")).toBe(false);
  });

  it("returns false for different lengths (no length-based early return to true)", () => {
    expect(constantTimeEqual("short", "short-and-then-some")).toBe(false);
    expect(constantTimeEqual("", "x")).toBe(false);
  });

  it("returns true for two empty strings", () => {
    expect(constantTimeEqual("", "")).toBe(true);
  });

  it("handles multi-byte UTF-8 content", () => {
    expect(constantTimeEqual("piñata-segredo", "piñata-segredo")).toBe(true);
    expect(constantTimeEqual("piñata-segredo", "pinata-segredo")).toBe(false);
  });
});

describe("readBearerToken", () => {
  it("extracts the token after the Bearer prefix", () => {
    expect(readBearerToken("Bearer abc123")).toBe("abc123");
  });

  it("returns null for a missing header", () => {
    expect(readBearerToken(null)).toBeNull();
    expect(readBearerToken(undefined)).toBeNull();
  });

  it("returns null when the scheme is absent or wrong", () => {
    expect(readBearerToken("abc123")).toBeNull();
    expect(readBearerToken("Basic abc123")).toBeNull();
  });

  it("is case-sensitive on the scheme", () => {
    expect(readBearerToken("bearer abc123")).toBeNull();
  });

  it("returns an empty string for a bare Bearer with no token", () => {
    expect(readBearerToken("Bearer ")).toBe("");
  });
});

describe("verifyInternalSecret", () => {
  it("reports disabled when the expected secret is unset", () => {
    expect(verifyInternalSecret({ expected: undefined, header: "Bearer x" })).toEqual({
      kind: "disabled",
    });
    expect(verifyInternalSecret({ expected: "", header: "Bearer x" })).toEqual({
      kind: "disabled",
    });
  });

  it("reports ok on an exact match", () => {
    expect(verifyInternalSecret({ expected: "s3cret", header: "Bearer s3cret" })).toEqual({
      kind: "ok",
    });
  });

  it("reports forbidden on mismatch, missing header, or wrong scheme", () => {
    expect(verifyInternalSecret({ expected: "s3cret", header: "Bearer nope" })).toEqual({
      kind: "forbidden",
    });
    expect(verifyInternalSecret({ expected: "s3cret", header: null })).toEqual({
      kind: "forbidden",
    });
    expect(verifyInternalSecret({ expected: "s3cret", header: "Basic s3cret" })).toEqual({
      kind: "forbidden",
    });
  });

  it("does not treat an empty bearer token as a match for an unset-looking secret", () => {
    expect(verifyInternalSecret({ expected: "s3cret", header: "Bearer " })).toEqual({
      kind: "forbidden",
    });
  });
});
