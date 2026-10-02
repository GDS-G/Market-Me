import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { WorkspaceExecutionControlError } from "@market-me/database";
import { apiError } from "./api-response";
afterEach(() => vi.restoreAllMocks());
describe("execution admission public errors", () => {
  it.each([["execution_paused", 409, "execution_paused"], ["control_unavailable", 503, "execution_control_unavailable"]] as const)(
    "returns a fixed private %s response without leaking or logging internals", async (code, status, publicCode) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const response = apiError(new WorkspaceExecutionControlError(code, "private SQL and credential detail"));
      expect(response.status).toBe(status); expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("vary")).toBe("Cookie"); expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.has("set-cookie")).toBe(false);
      const body = await response.json(); expect(body.error.code).toBe(publicCode);
      expect(JSON.stringify(body)).not.toContain("private SQL"); expect(log).not.toHaveBeenCalled();
    },
  );
});
