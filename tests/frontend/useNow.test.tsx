import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useNow } from "../../src/hooks/useNow";

const START = new Date("2026-10-13T14:30:00.000Z");

describe("useNow", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(START);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts at the current time", () => {
    const { result } = renderHook(() => useNow(false));

    expect(result.current).toEqual(START);
  });

  it("moves with the clock every second while ticking", () => {
    const { result } = renderHook(() => useNow(true));

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(result.current).toEqual(new Date(START.getTime() + 3000));
  });

  it("follows a custom tick interval", () => {
    const { result } = renderHook(() => useNow(true, 5000));

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(result.current).toEqual(START);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toEqual(new Date(START.getTime() + 5000));
  });

  it("stays still while not ticking, and stops when ticking stops", () => {
    const { result, rerender } = renderHook(({ isTicking }) => useNow(isTicking), {
      initialProps: { isTicking: true },
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    const timeWhenStopped = result.current;

    rerender({ isTicking: false });
    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(result.current).toEqual(timeWhenStopped);
  });
});
