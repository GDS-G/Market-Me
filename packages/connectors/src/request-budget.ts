/** Trusted server-derived options, never campaign input/context or browser authority. */
export interface ChannelDispatchOptions {
  /** Absolute UTC epoch milliseconds; a request may start only strictly before it. */
  dispatchDeadlineAt?: number;
  /** Same-process performance.now() bound, conservatively derived from DB time before its read round trip. */
  dispatchMonotonicDeadlineAt?: number;
}

/** No provider request started. This must not be classified as ambiguous delivery. */
export class ChannelDispatchDeadlineExceededError extends Error {
  constructor(readonly reason: "invalid" | "expired") {
    super(reason === "invalid" ? "The channel dispatch deadline is invalid." : "The channel dispatch window has closed before the request started.");
    this.name = "ChannelDispatchDeadlineExceededError";
  }
}

export interface ChannelRequestBudget {
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  /** The same budget covers both response headers and subsequent body consumption. */
  run<T>(operation: () => Promise<T>): Promise<T>;
}

/**
 * Create immediately before request I/O, after payload preparation. Call outside
 * catches that classify started writes as ambiguous. Once started, use this one
 * signal/budget throughout the response; do not recheck the wall-clock deadline
 * and discard an otherwise valid acknowledgement.
 */
export function createChannelRequestBudget(
  standardTimeoutMs: number,
  options: ChannelDispatchOptions = {},
): ChannelRequestBudget {
  if (!Number.isSafeInteger(standardTimeoutMs) || standardTimeoutMs < 1 || standardTimeoutMs > 2_147_483_647) {
    throw new RangeError("Channel request timeout must be a positive bounded integer.");
  }
  let timeoutMs = standardTimeoutMs;
  const remaining = () => Math.min(
    options.dispatchDeadlineAt === undefined ? Infinity : options.dispatchDeadlineAt - Date.now(),
    options.dispatchMonotonicDeadlineAt === undefined ? Infinity : options.dispatchMonotonicDeadlineAt - performance.now(),
  );
  if (options.dispatchMonotonicDeadlineAt !== undefined && (
    !Number.isFinite(options.dispatchMonotonicDeadlineAt) || options.dispatchDeadlineAt === undefined
  )) throw new ChannelDispatchDeadlineExceededError("invalid");
  if (options.dispatchDeadlineAt !== undefined) {
    if (!Number.isFinite(options.dispatchDeadlineAt) || !Number.isFinite(new Date(options.dispatchDeadlineAt).getTime())) {
      throw new ChannelDispatchDeadlineExceededError("invalid");
    }
    const remainingMs = remaining();
    if (remainingMs <= 0) throw new ChannelDispatchDeadlineExceededError("expired");
    // A sub-millisecond remainder gets a zero-delay abort, never a rounded-up extension.
    timeoutMs = Math.floor(Math.min(standardTimeoutMs, remainingMs));
  }
  const signal = AbortSignal.timeout(timeoutMs);
  let started = false;
  return {
    signal,
    timeoutMs,
    run<T>(operation: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        // The caller may stall between constructing the budget and invoking its
        // first request. Recheck only that first I/O, never a later response body.
        if (!started && remaining() <= 0) { reject(new ChannelDispatchDeadlineExceededError("expired")); return; }
        if (signal.aborted) { reject(signal.reason); return; }
        started = true;
        const onAbort = () => reject(signal.reason);
        signal.addEventListener("abort", onAbort, { once: true });
        const cleanup = () => signal.removeEventListener("abort", onAbort);
        try {
          operation().then(
            (value) => { cleanup(); resolve(value); },
            (error: unknown) => { cleanup(); reject(error); },
          );
        } catch (error) { cleanup(); reject(error); }
      });
    },
  };
}
