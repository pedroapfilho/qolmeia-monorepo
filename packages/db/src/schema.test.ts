import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { orgMembership, organization, user } from "./schema";

describe("schema parity", () => {
  it("User table has required auth columns", () => {
    const config = getTableConfig(user);
    const columnNames = config.columns.map((c) => c.name);
    expect(columnNames).toContain("id");
    expect(columnNames).toContain("email");
    expect(columnNames).toContain("emailVerified");
    expect(columnNames).toContain("name");
    expect(columnNames).toContain("createdAt");
    expect(columnNames).toContain("updatedAt");
  });

  it("Organization table has required columns", () => {
    const config = getTableConfig(organization);
    const columnNames = config.columns.map((c) => c.name);
    expect(columnNames).toContain("id");
    expect(columnNames).toContain("name");
    expect(columnNames).toContain("slug");
    expect(columnNames).toContain("timezone");
    expect(columnNames).toContain("currency");
  });

  it("OrgMembership table has required columns", () => {
    const config = getTableConfig(orgMembership);
    const columnNames = config.columns.map((c) => c.name);
    expect(columnNames).toContain("id");
    expect(columnNames).toContain("userId");
    expect(columnNames).toContain("orgId");
    expect(columnNames).toContain("role");
  });
});
