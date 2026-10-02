import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import HomePage from "../../src/pages/HomePage";

/**
 * Builds a fetch stub that resolves only when the returned `resolve` is called.
 * Lets a test observe the in-flight state, and lets it land a response AFTER
 * unmount to exercise the hook's `cancelled` guards.
 *
 * @param {unknown} body - What `response.json()` should resolve to
 * @returns {{ resolve: () => void; settled: Promise<unknown> }} Controls for the pending request
 */
function createDeferredFetch(body: unknown): { resolve: () => void; settled: Promise<unknown> } {
  let release: () => void = () => undefined;
  const pending = new Promise<Response>((resolveOuter) => {
    release = () =>
      resolveOuter({ ok: true, status: 200, json: async () => body } as unknown as Response);
  });
  globalThis.fetch = vi.fn().mockReturnValue(pending);
  return { resolve: release, settled: pending };
}

describe("HomePage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("always renders the Hello World heading", () => {
    createDeferredFetch({ status: "ok", uptime: 1 });
    render(<HomePage />);
    expect(screen.getByRole("heading", { name: "Hello World" })).toBeInTheDocument();
  });

  it("shows a spinner while the health request is in flight", () => {
    createDeferredFetch({ status: "ok", uptime: 1 });
    render(<HomePage />);
    expect(screen.getByLabelText("Checking API health")).toBeInTheDocument();
  });

  it("renders the status and rounded uptime on success", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: "ok", uptime: 42.7 }),
    } as unknown as Response);

    render(<HomePage />);
    expect(await screen.findByText("ok")).toBeInTheDocument();
    expect(screen.getByText("up 43s")).toBeInTheDocument();
  });

  it("renders an error alert on a non-2xx response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    } as unknown as Response);

    render(<HomePage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Server responded with 503");
  });

  it("renders an error alert when the request rejects", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Failed to fetch"));
    render(<HomePage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to fetch");
  });

  it("stringifies a non-Error rejection", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue("socket hang up");
    render(<HomePage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("socket hang up");
  });

  it("ignores a response that lands after unmount", async () => {
    const deferred = createDeferredFetch({ status: "ok", uptime: 1 });

    const { unmount } = render(<HomePage />);
    unmount();
    deferred.resolve();
    await deferred.settled;
    await Promise.resolve();

    expect(document.body.textContent).not.toContain("up 1s");
  });

  it("ignores a rejection that lands after unmount", async () => {
    let reject: (reason: unknown) => void = () => undefined;
    const pending = new Promise<Response>((_resolve, rejectOuter) => {
      reject = rejectOuter;
    });
    globalThis.fetch = vi.fn().mockReturnValue(pending);

    const { unmount } = render(<HomePage />);
    unmount();
    reject(new Error("late failure"));
    await pending.catch(() => undefined);
    await Promise.resolve();

    expect(document.body.textContent).not.toContain("late failure");
  });
});
