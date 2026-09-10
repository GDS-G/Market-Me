import { describe, expect, it } from "vitest";
import { workspaceInvitationSchema } from "./auth-schema";

describe("workspace invitation schema", () => {
  it("accepts a bounded non-owner invitation", () => {
    expect(workspaceInvitationSchema.parse({ email: " person@example.test ", role: "editor" })).toEqual({
      email: "person@example.test",
      role: "editor",
      expiresInDays: 7,
    });
  });

  it("rejects owner grants, unknown fields, and excessive lifetime", () => {
    expect(() => workspaceInvitationSchema.parse({ email: "person@example.test", role: "owner" })).toThrow();
    expect(() => workspaceInvitationSchema.parse({ email: "person@example.test", role: "viewer", extra: true })).toThrow();
    expect(() => workspaceInvitationSchema.parse({ email: "person@example.test", role: "viewer", expiresInDays: 31 })).toThrow();
  });
});
