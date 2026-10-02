import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useWebsiteItem, useWebsiteItems } from "../../src/hooks/useWebsiteItems";
import {
  ITEM_KIND_TEST_CASES,
  buildWebsiteItemRecord,
  stubFetchRoutes,
} from "./support/frontendTestHelpers";

describe.each(ITEM_KIND_TEST_CASES)("useWebsiteItems ($segment)", ({ itemKind, segment }) => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it(`GETs /api/websites/:websiteId/${segment} and returns the item list`, async () => {
    const items = [buildWebsiteItemRecord(), buildWebsiteItemRecord({ id: "item-2" })];
    const fetchStub = stubFetchRoutes({
      [`GET /api/websites/website-1/${segment}`]: { status: 200, body: items },
    });

    const { result } = renderHook(() => useWebsiteItems(itemKind, "website-1"));

    await waitFor(() => {
      expect(result.current.data).toEqual(items);
    });
    expect(fetchStub).toHaveBeenCalledWith(`/api/websites/website-1/${segment}`);
  });
});

describe.each(ITEM_KIND_TEST_CASES)(
  "useWebsiteItem ($segment)",
  ({ itemKind, segment, notFoundText }) => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it(`GETs /api/websites/:websiteId/${segment}/:itemId with both ids encoded`, async () => {
      const item = buildWebsiteItemRecord({ id: "i d" });
      const fetchStub = stubFetchRoutes({
        [`GET /api/websites/w%2F1/${segment}/i%20d`]: { status: 200, body: item },
      });

      const { result } = renderHook(() => useWebsiteItem(itemKind, "w/1", "i d"));

      await waitFor(() => {
        expect(result.current.data).toEqual(item);
      });
      expect(fetchStub).toHaveBeenCalledWith(`/api/websites/w%2F1/${segment}/i%20d`);
    });

    it("reports the server's not-found text for an unknown item", async () => {
      stubFetchRoutes({
        [`GET /api/websites/website-1/${segment}/missing`]: {
          status: 404,
          body: { error: notFoundText },
        },
      });

      const { result } = renderHook(() => useWebsiteItem(itemKind, "website-1", "missing"));

      await waitFor(() => {
        expect(result.current.errorMessage).toBe(notFoundText);
      });
    });
  },
);
