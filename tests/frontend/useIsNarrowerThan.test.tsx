import { describe, it, expect, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useIsNarrowerThan } from "../../src/hooks/useIsNarrowerThan";
import { stubWindowWidth } from "./support/frontendTestHelpers";

describe("useIsNarrowerThan", () => {
  let removeWidthStub: (() => void) | null = null;

  afterEach(() => {
    removeWidthStub?.();
    removeWidthStub = null;
  });

  it("is true for a phone-width window below the md (900 px) breakpoint", () => {
    removeWidthStub = stubWindowWidth(390);

    const { result } = renderHook(() => useIsNarrowerThan("md"));

    expect(result.current).toBe(true);
  });

  it("is false for a desktop-width window", () => {
    removeWidthStub = stubWindowWidth(1280);

    const { result } = renderHook(() => useIsNarrowerThan("md"));

    expect(result.current).toBe(false);
  });

  it("compares with the breakpoint asked for: 1000 px is narrower than lg but not md", () => {
    removeWidthStub = stubWindowWidth(1000);

    expect(renderHook(() => useIsNarrowerThan("lg")).result.current).toBe(true);
    expect(renderHook(() => useIsNarrowerThan("md")).result.current).toBe(false);
  });

  it("reports the desktop layout where matchMedia does not exist", () => {
    const { result } = renderHook(() => useIsNarrowerThan("md"));

    expect(result.current).toBe(false);
  });
});
