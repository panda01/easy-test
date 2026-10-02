import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "../../src/App";

describe("App", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: "ok", uptime: 42.7 }),
    } as unknown as Response);
    window.history.pushState({}, "", "/");
  });

  it("routes / to the homepage", async () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Hello World" })).toBeInTheDocument();
    expect(await screen.findByText("ok")).toBeInTheDocument();
  });

  it("requests the health endpoint through the relative /api path", async () => {
    render(<App />);
    await screen.findByText("ok");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/health");
  });
});
