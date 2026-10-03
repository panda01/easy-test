import { describe, it, expect, beforeEach, vi } from "vitest";
import { type ReactElement, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useWebsiteItemDeletion } from "../../src/hooks/useWebsiteItemDeletion";
import { ACTION_KIND } from "../../src/utils/websiteItemKinds";
import { createDeferred, buildJsonResponse, stubFetchRoutes } from "./support/frontendTestHelpers";

const ITEM_API_URL = "/api/websites/website-1/actions/item-1";

/**
 * Wraps the hook in a router, which its return navigation needs.
 * @param props - The hook's rendered children
 * @param props.children - What to render inside the router
 * @returns The children inside a MemoryRouter on the action's page
 */
function RouterWrapper(props: { children: ReactNode }): ReactElement {
  return (
    <MemoryRouter initialEntries={["/websites/website-1/actions/item-1"]}>
      {props.children}
    </MemoryRouter>
  );
}

describe("useWebsiteItemDeletion", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("opens and closes the dialog without sending anything", () => {
    const fetchStub = stubFetchRoutes({});
    const { result } = renderHook(() => useWebsiteItemDeletion(ACTION_KIND, "website-1", "item-1"), {
      wrapper: RouterWrapper,
    });

    act(() => {
      result.current.openDeleteDialog();
    });
    expect(result.current.deleteDialogIsOpen).toBe(true);
    act(() => {
      result.current.closeDeleteDialog();
    });

    expect(result.current.deleteDialogIsOpen).toBe(false);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("reports the delete in flight, then closes the dialog when it succeeds", async () => {
    const pendingDelete = createDeferred<Response>();
    const fetchStub = stubFetchRoutes({ [`DELETE ${ITEM_API_URL}`]: () => pendingDelete.promise });
    const { result } = renderHook(() => useWebsiteItemDeletion(ACTION_KIND, "website-1", "item-1"), {
      wrapper: RouterWrapper,
    });
    act(() => {
      result.current.openDeleteDialog();
    });

    act(() => {
      result.current.confirmDelete();
    });
    expect(result.current.isDeleting).toBe(true);
    await act(async () => {
      pendingDelete.resolve(buildJsonResponse(204));
      await pendingDelete.promise;
    });

    await waitFor(() => {
      expect(result.current.deleteDialogIsOpen).toBe(false);
    });
    expect(fetchStub).toHaveBeenCalledWith(ITEM_API_URL, { method: "DELETE" });
  });

  it("keeps the dialog open with the server's reason when the delete fails", async () => {
    stubFetchRoutes({ [`DELETE ${ITEM_API_URL}`]: { status: 404, body: { error: "Action not found" } } });
    const { result } = renderHook(() => useWebsiteItemDeletion(ACTION_KIND, "website-1", "item-1"), {
      wrapper: RouterWrapper,
    });
    act(() => {
      result.current.openDeleteDialog();
    });

    act(() => {
      result.current.confirmDelete();
    });

    await waitFor(() => {
      expect(result.current.deleteErrorMessage).toBe("Action not found");
    });
    expect(result.current.deleteDialogIsOpen).toBe(true);
  });
});
