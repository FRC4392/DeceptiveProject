import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { useConvexAuth, useMutation } from "convex/react";
import { StoreCurrentUser } from "./App";

vi.mock("convex/react", () => ({
  useConvexAuth: vi.fn(),
  useMutation: vi.fn(),
  Authenticated: () => null,
  AuthLoading: () => null,
  Unauthenticated: () => null,
}));

/** A `storeCurrentUser` that fails `failures` times, then succeeds. */
function storeThatFails(failures: number) {
  let calls = 0;
  const store = vi.fn(() => {
    calls += 1;
    return calls <= failures
      ? Promise.reject(new Error("network blip"))
      : Promise.resolve(null);
  });
  vi.mocked(useMutation).mockReturnValue(
    store as unknown as ReturnType<typeof useMutation>,
  );
  return store;
}

/** Let the rejected promise settle, then run the retry timer it set. */
async function nextAttempt(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("saving the signed-in user", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(useConvexAuth).mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      isRefreshing: false,
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // One failed write used to mean no row for as long as the tab stayed open.
  it("tries again after a failed write", async () => {
    const store = storeThatFails(2);
    render(<StoreCurrentUser />);
    expect(store).toHaveBeenCalledTimes(1);

    await nextAttempt(1_000);
    expect(store).toHaveBeenCalledTimes(2);
    await nextAttempt(2_000);
    expect(store).toHaveBeenCalledTimes(3);

    // It went through; nothing left to retry.
    await nextAttempt(60_000);
    expect(store).toHaveBeenCalledTimes(3);
  });

  it("gives up rather than retrying forever", async () => {
    const store = storeThatFails(Infinity);
    render(<StoreCurrentUser />);
    await nextAttempt(5 * 60_000);
    // The first try plus one per backoff step.
    expect(store).toHaveBeenCalledTimes(6);
    expect(console.error).toHaveBeenCalledOnce();
  });

  it("stops retrying once it's gone", async () => {
    const store = storeThatFails(Infinity);
    const { unmount } = render(<StoreCurrentUser />);
    await nextAttempt(0);
    unmount();
    await nextAttempt(5 * 60_000);
    expect(store).toHaveBeenCalledTimes(1);
  });

  it("does nothing before anyone has signed in", () => {
    vi.mocked(useConvexAuth).mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
      isRefreshing: false,
    });
    const store = storeThatFails(0);
    render(<StoreCurrentUser />);
    expect(store).not.toHaveBeenCalled();
  });
});
