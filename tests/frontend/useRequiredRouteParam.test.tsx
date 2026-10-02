import { type ReactElement, type ReactNode } from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { useRequiredRouteParam } from "../../src/hooks/useRequiredRouteParam";

/** Props renderHook passes to a wrapper component. */
interface HookWrapperProps {
  /** The component that calls the hook under test. */
  children: ReactNode;
}

/**
 * Builds a renderHook wrapper that renders the hook inside a single route, so
 * `useParams` reports exactly the params that route pattern declares.
 * @param routePattern - The route pattern to match, e.g. "/websites/:websiteId"
 * @param currentPath - The url the router starts on
 * @returns A wrapper component for renderHook
 */
function createSingleRouteWrapper(
  routePattern: string,
  currentPath: string,
): (props: HookWrapperProps) => ReactElement {
  /**
   * Renders the hook's test component as the only route's element.
   * @param props - The test component to render
   * @returns The router with the single route
   */
  const SingleRouteWrapper = (props: HookWrapperProps): ReactElement => (
    <MemoryRouter initialEntries={[currentPath]}>
      <Routes>
        <Route path={routePattern} element={props.children} />
      </Routes>
    </MemoryRouter>
  );
  return SingleRouteWrapper;
}

describe("useRequiredRouteParam", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the param when the matched route declares it", () => {
    const { result } = renderHook(() => useRequiredRouteParam("websiteId"), {
      wrapper: createSingleRouteWrapper("/websites/:websiteId", "/websites/website-1"),
    });
    expect(result.current).toBe("website-1");
  });

  it("returns the decoded value of an encoded param", () => {
    const { result } = renderHook(() => useRequiredRouteParam("itemId"), {
      wrapper: createSingleRouteWrapper(
        "/websites/:websiteId/use-cases/:itemId",
        "/websites/website-1/use-cases/a%20b",
      ),
    });
    expect(result.current).toBe("a b");
  });

  it("throws a clear error naming the param when the matched route lacks it", () => {
    // React reports the render error through console.error before rethrowing it.
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() =>
      renderHook(() => useRequiredRouteParam("itemId"), {
        wrapper: createSingleRouteWrapper("/websites/:websiteId", "/websites/website-1"),
      }),
    ).toThrow("The current route does not declare the :itemId parameter");

    consoleErrorSpy.mockRestore();
  });
});
