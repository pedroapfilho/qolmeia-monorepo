import { describe, expect, it } from "vitest";

import { safeRedirectPath } from "./redirect-validation";

describe("safeRedirectPath", () => {
  it("accepts a simple in-app path", () => {
    expect(safeRedirectPath("/tickets")).toBe("/tickets");
  });

  it("accepts the root path", () => {
    expect(safeRedirectPath("/")).toBe("/");
  });

  it("accepts nested paths with query and hash", () => {
    expect(safeRedirectPath("/tickets?status=open#top")).toBe("/tickets?status=open#top");
  });

  it("defaults absent values to /", () => {
    expect(safeRedirectPath(null)).toBe("/");
    expect(safeRedirectPath(undefined)).toBe("/");
  });

  it("rejects empty string", () => {
    expect(safeRedirectPath("")).toBe("/");
  });

  it("rejects protocol-relative URLs", () => {
    expect(safeRedirectPath("//evil.com")).toBe("/");
    expect(safeRedirectPath("//evil.com/phish")).toBe("/");
  });

  it("rejects backslash tricks", () => {
    expect(safeRedirectPath(String.raw`/\evil.com`)).toBe("/");
    expect(safeRedirectPath(String.raw`\/evil.com`)).toBe("/");
    expect(safeRedirectPath(String.raw`/path\..\evil`)).toBe("/");
  });

  it("rejects absolute URLs", () => {
    expect(safeRedirectPath("https://evil.com/phish")).toBe("/");
    expect(safeRedirectPath("http://localhost:3000/tickets")).toBe("/");
  });

  it("rejects scheme-prefixed values", () => {
    expect(safeRedirectPath(["javascript", "alert(1)"].join(":"))).toBe("/");
    expect(safeRedirectPath("data:text/html,<script>1</script>")).toBe("/");
  });

  it("rejects bare hostnames and relative paths without a leading slash", () => {
    expect(safeRedirectPath("evil.com")).toBe("/");
    expect(safeRedirectPath("tickets")).toBe("/");
    expect(safeRedirectPath(" /tickets")).toBe("/");
  });
});
