import { describe, expect, it } from "vitest";
import { createDatabaseClient } from "./client";
import { ORGANIZATION_ROLES, WORKSPACE_ROLES } from "./models";

describe("database contracts", () => {
  it("fails closed when the database URL is absent", () => {
    expect(() => createDatabaseClient("")).toThrow("DATABASE_URL is required");
  });

  it("keeps approval and editing capabilities distinct", () => {
    expect(WORKSPACE_ROLES).toContain("approver");
    expect(WORKSPACE_ROLES).toContain("editor");
    expect(ORGANIZATION_ROLES).not.toContain("approver");
  });
});
