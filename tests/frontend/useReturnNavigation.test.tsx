import { type ReactElement, type ReactNode } from "react";
import { describe, it, expect } from "vitest";
import { act, renderHook, screen, type RenderHookResult } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter, type InitialEntry } from "react-router-dom";
import { useReturnNavigation, useReturnToHereState } from "../../src/hooks/useReturnNavigation";
import { LocationProbe, readProbeAfterLanding } from "./support/frontendTestHelpers";

const LIST_PATH = "/websites";
const DETAIL_PATH = "/websites/website-1";
const EDIT_PATH = "/websites/website-1/edit";

/** Props renderHook passes to a wrapper component. */
interface HookWrapperProps {
  /** The component that calls the hook under test. */
  children: ReactNode;
}

/**
 * Builds a renderHook wrapper: a `MemoryRouter` starting on the given history
 * stack, with a `LocationProbe` beside the hook so the test can read where
 * navigation landed and press Back.
 * @param initialEntries - The history stack, oldest first
 * @param initialIndex - Which entry is current
 * @returns A wrapper component for renderHook
 */
function createHistoryWrapper(
  initialEntries: InitialEntry[],
  initialIndex: number,
): (props: HookWrapperProps) => ReactElement {
  /**
   * Renders the hook's test component and the probe inside the router.
   * @param props - The test component to render
   * @returns The router with the test component and the probe
   */
  const HistoryWrapper = (props: HookWrapperProps): ReactElement => (
    <MemoryRouter initialEntries={initialEntries} initialIndex={initialIndex}>
      {props.children}
      <LocationProbe />
    </MemoryRouter>
  );
  return HistoryWrapper;
}

/**
 * Renders `useReturnNavigation` on the given history stack.
 * @param initialEntries - The history stack, oldest first
 * @param initialIndex - Which entry is current
 * @returns The renderHook result holding `returnTo` and `replaceKeepingReturnState`
 */
function renderReturnNavigation(
  initialEntries: InitialEntry[],
  initialIndex: number,
): RenderHookResult<ReturnType<typeof useReturnNavigation>, unknown> {
  return renderHook(() => useReturnNavigation(), {
    wrapper: createHistoryWrapper(initialEntries, initialIndex),
  });
}

describe("useReturnToHereState", () => {
  it("returns the current pathname as returnTo", () => {
    const { result } = renderHook(() => useReturnToHereState(), {
      wrapper: createHistoryWrapper([DETAIL_PATH], 0),
    });
    expect(result.current).toEqual({ returnTo: DETAIL_PATH });
  });

  it("uses only the pathname, without the query string", () => {
    const { result } = renderHook(() => useReturnToHereState(), {
      wrapper: createHistoryWrapper([`${LIST_PATH}?page=2`], 0),
    });
    expect(result.current).toEqual({ returnTo: LIST_PATH });
  });
});

describe("useReturnNavigation: returnTo", () => {
  it("goes back one entry when returnTo in the state is the target", async () => {
    const user = userEvent.setup();
    const { result } = renderReturnNavigation(
      [LIST_PATH, DETAIL_PATH, { pathname: EDIT_PATH, state: { returnTo: DETAIL_PATH } }],
      2,
    );

    act(() => {
      result.current.returnTo(DETAIL_PATH);
    });

    const landing = await readProbeAfterLanding(DETAIL_PATH);
    expect(landing.navigationType).toBe("POP");

    // The detail entry was not duplicated: one more Back reaches the list.
    await user.click(screen.getByRole("button", { name: "Probe: go back" }));
    await readProbeAfterLanding(LIST_PATH);
  });

  it("replaces the current entry when there is no state (deep link or reload)", async () => {
    const user = userEvent.setup();
    const { result } = renderReturnNavigation([LIST_PATH, EDIT_PATH], 1);

    act(() => {
      result.current.returnTo(DETAIL_PATH);
    });

    const landing = await readProbeAfterLanding(DETAIL_PATH);
    expect(landing.navigationType).toBe("REPLACE");

    // The form's entry is gone: Back goes straight to the entry underneath it.
    await user.click(screen.getByRole("button", { name: "Probe: go back" }));
    await readProbeAfterLanding(LIST_PATH);
  });

  it("replaces the current entry when returnTo names a different page than the target", async () => {
    const { result } = renderReturnNavigation(
      [LIST_PATH, { pathname: EDIT_PATH, state: { returnTo: LIST_PATH } }],
      1,
    );

    act(() => {
      result.current.returnTo(DETAIL_PATH);
    });

    const landing = await readProbeAfterLanding(DETAIL_PATH);
    expect(landing.navigationType).toBe("REPLACE");
  });

  it.each([
    { description: "a string", locationState: "returnTo" },
    { description: "an object without returnTo", locationState: { from: DETAIL_PATH } },
    { description: "a non-string returnTo", locationState: { returnTo: 42 } },
  ])("replaces the current entry when the state is $description", async ({ locationState }) => {
    const { result } = renderReturnNavigation(
      [DETAIL_PATH, { pathname: EDIT_PATH, state: locationState }],
      1,
    );

    act(() => {
      result.current.returnTo(DETAIL_PATH);
    });

    const landing = await readProbeAfterLanding(DETAIL_PATH);
    expect(landing.navigationType).toBe("REPLACE");
  });
});

describe("useReturnNavigation: replaceKeepingReturnState", () => {
  it("replaces the current entry and carries its returnTo state over", async () => {
    const user = userEvent.setup();
    const { result } = renderReturnNavigation(
      [LIST_PATH, { pathname: "/websites/new", state: { returnTo: LIST_PATH } }],
      1,
    );

    act(() => {
      result.current.replaceKeepingReturnState(DETAIL_PATH);
    });

    const landing = await readProbeAfterLanding(DETAIL_PATH);
    expect(landing.navigationType).toBe("REPLACE");
    expect(landing.state).toBe(JSON.stringify({ returnTo: LIST_PATH }));

    // The form's entry was replaced, so Back skips it.
    await user.click(screen.getByRole("button", { name: "Probe: go back" }));
    await readProbeAfterLanding(LIST_PATH);
  });

  it("replaces the current entry with no state when the form had none", async () => {
    const { result } = renderReturnNavigation(["/websites/new"], 0);

    act(() => {
      result.current.replaceKeepingReturnState(DETAIL_PATH);
    });

    const landing = await readProbeAfterLanding(DETAIL_PATH);
    expect(landing.navigationType).toBe("REPLACE");
    expect(landing.state).toBe("null");
  });

  it("lets a later returnTo go back once the carried state names the entry underneath", async () => {
    const { result } = renderReturnNavigation(
      [LIST_PATH, { pathname: "/websites/new", state: { returnTo: LIST_PATH } }],
      1,
    );

    act(() => {
      result.current.replaceKeepingReturnState(DETAIL_PATH);
    });
    await readProbeAfterLanding(DETAIL_PATH);

    act(() => {
      result.current.returnTo(LIST_PATH);
    });
    const landing = await readProbeAfterLanding(LIST_PATH);
    expect(landing.navigationType).toBe("POP");
  });
});
