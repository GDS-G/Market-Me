import { afterEach, describe, expect, it, vi } from "vitest";
import { ChannelDispatchDeadlineExceededError, createChannelRequestBudget } from "./request-budget";

afterEach(() => vi.restoreAllMocks());

describe("channel request budget", () => {
  it.each([NaN, Infinity, -Infinity, 1e100, -1e100, "2000", null])("rejects invalid deadline %s without creating a request signal", (deadline) => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    expect(() => createChannelRequestBudget(5_000, { dispatchDeadlineAt: deadline as number })).toThrow(ChannelDispatchDeadlineExceededError);
    expect(timeout).not.toHaveBeenCalled();
  });

  it.each([999, 1_000])("excludes a deadline at or before the request-start instant (%s)", (deadline) => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    expect(() => createChannelRequestBudget(5_000, { dispatchDeadlineAt: deadline })).toThrow(expect.objectContaining({ reason: "expired" }));
  });

  it("caps the standard timeout without rounding up the remaining interval", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const timeout = vi.spyOn(AbortSignal, "timeout");
    expect(createChannelRequestBudget(5_000).timeoutMs).toBe(5_000);
    expect(createChannelRequestBudget(5_000, { dispatchDeadlineAt: 1_250 }).timeoutMs).toBe(250);
    expect(createChannelRequestBudget(5_000, { dispatchDeadlineAt: 20_000 }).timeoutMs).toBe(5_000);
    expect(createChannelRequestBudget(5_000, { dispatchDeadlineAt: 1_000.5 }).timeoutMs).toBe(0);
    expect(timeout.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([5_000, 250, 5_000, 0]);
  });

  it("bounds subsequent body waits with the original signal, even for an uncooperative adapter", async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    const budget = createChannelRequestBudget(5_000);
    await expect(budget.run(async () => "headers")).resolves.toBe("headers");
    const body = budget.run(() => new Promise<string>(() => undefined));
    const outcome = expect(body).rejects.toThrow("body timed out");
    controller.abort(new Error("body timed out"));
    await outcome;
  });

  it("cleans up abort listeners and does not recheck wall time after successful I/O", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const budget = createChannelRequestBudget(5_000, { dispatchDeadlineAt: 1_200 });
    await expect(budget.run(async () => { clock.mockReturnValue(1_201); return "accepted"; })).resolves.toBe("accepted");
    expect(remove).toHaveBeenCalledExactlyOnceWith("abort", expect.any(Function));
    expect(clock).toHaveBeenCalledTimes(2);
  });

  it("rechecks the first actual I/O after a synchronous scheduling stall", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const budget = createChannelRequestBudget(5_000, { dispatchDeadlineAt: 1_200 });
    clock.mockReturnValue(1_200);
    const request = vi.fn();
    await expect(budget.run(request)).rejects.toMatchObject({ reason: "expired" });
    expect(request).not.toHaveBeenCalled();
  });

  it("uses the conservative monotonic bound despite a slow or backwards-moving worker wall clock", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const monotonic = vi.spyOn(performance, "now").mockReturnValue(100);
    const budget = createChannelRequestBudget(5_000, { dispatchDeadlineAt: 99_000, dispatchMonotonicDeadlineAt: 125.9 });
    expect(budget.timeoutMs).toBe(25);
    monotonic.mockReturnValue(125.9);
    const request = vi.fn();
    await expect(budget.run(request)).rejects.toMatchObject({ reason: "expired" });
    expect(request).not.toHaveBeenCalled();
  });

  it.each([NaN, Infinity, "2000", null])("rejects invalid monotonic budget %s", (value) => {
    expect(() => createChannelRequestBudget(5_000, { dispatchDeadlineAt: 99999, dispatchMonotonicDeadlineAt: value as number }))
      .toThrow(expect.objectContaining({ reason: "invalid" }));
  });

  it("does not accept a monotonic budget without the stored UTC deadline", () => {
    expect(() => createChannelRequestBudget(5_000, { dispatchMonotonicDeadlineAt: 200 }))
      .toThrow(expect.objectContaining({ reason: "invalid" }));
  });

  it("does not invoke another body operation after the budget aborts", async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    const budget = createChannelRequestBudget(5_000);
    controller.abort(new Error("aborted"));
    const operation = vi.fn();
    await expect(budget.run(operation)).rejects.toThrow("aborted");
    expect(operation).not.toHaveBeenCalled();
  });
});
