import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useRecordListWithAdditions } from "../../src/hooks/useRecordListWithAdditions";
import { countRequests, createDeferred, stubFetchRoutes } from "./support/frontendTestHelpers";

/** A minimal record: an id plus the owner the list filter checks. */
interface OwnedRecord {
  id: string;
  ownerId: string;
}

const LIST_URL = "/api/owners/owner-1/records";

/**
 * Keeps records that belong to owner-1.
 * @param record - A record added on this visit
 * @returns True when it belongs to owner-1
 */
const belongsToOwnerOne = (record: OwnedRecord): boolean => record.ownerId === "owner-1";

describe("useRecordListWithAdditions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the fetched records once the list arrives", async () => {
    stubFetchRoutes({
      [`GET ${LIST_URL}`]: { status: 200, body: [{ id: "b", ownerId: "owner-1" }] },
    });

    const { result } = renderHook(() =>
      useRecordListWithAdditions<OwnedRecord>(LIST_URL, belongsToOwnerOne),
    );

    expect(result.current.isLoading).toBe(true);
    expect(result.current.records).toEqual([]);
    await waitFor(() => {
      expect(result.current.records).toEqual([{ id: "b", ownerId: "owner-1" }]);
    });
    expect(result.current.errorMessage).toBeNull();
  });

  it("puts added records first, newest first, without refetching", async () => {
    const fetchStub = stubFetchRoutes({
      [`GET ${LIST_URL}`]: { status: 200, body: [{ id: "a", ownerId: "owner-1" }] },
    });
    const { result } = renderHook(() =>
      useRecordListWithAdditions<OwnedRecord>(LIST_URL, belongsToOwnerOne),
    );
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    act(() => {
      result.current.addRecord({ id: "b", ownerId: "owner-1" });
    });
    act(() => {
      result.current.addRecord({ id: "c", ownerId: "owner-1" });
    });

    expect(result.current.records.map((record) => record.id)).toEqual(["c", "b", "a"]);
    expect(countRequests(fetchStub, "GET", LIST_URL)).toBe(1);
  });

  it("never lists a record twice when the fetch also returns an added record", async () => {
    const pendingList = createDeferred<Response>();
    stubFetchRoutes({ [`GET ${LIST_URL}`]: () => pendingList.promise });
    const { result } = renderHook(() =>
      useRecordListWithAdditions<OwnedRecord>(LIST_URL, belongsToOwnerOne),
    );

    act(() => {
      result.current.addRecord({ id: "a", ownerId: "owner-1" });
    });
    await act(async () => {
      pendingList.resolve(
        new Response(JSON.stringify([{ id: "a", ownerId: "owner-1" }]), { status: 200 }),
      );
      await pendingList.promise;
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.records.map((record) => record.id)).toEqual(["a"]);
  });

  it("drops added records that belong to another list", async () => {
    stubFetchRoutes({ [`GET ${LIST_URL}`]: { status: 200, body: [] } });
    const { result } = renderHook(() =>
      useRecordListWithAdditions<OwnedRecord>(LIST_URL, belongsToOwnerOne),
    );

    act(() => {
      result.current.addRecord({ id: "late", ownerId: "owner-2" });
    });

    expect(result.current.records).toEqual([]);
  });

  it("stays idle for a null url, still showing records added for this list", () => {
    const fetchStub = stubFetchRoutes({});
    const { result } = renderHook(() =>
      useRecordListWithAdditions<OwnedRecord>(null, belongsToOwnerOne),
    );

    expect(result.current.isLoading).toBe(false);
    act(() => {
      result.current.addRecord({ id: "a", ownerId: "owner-1" });
    });

    expect(result.current.records.map((record) => record.id)).toEqual(["a"]);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("passes a failed fetch's reason through with an empty list", async () => {
    stubFetchRoutes({ [`GET ${LIST_URL}`]: { status: 500, body: { error: "Database unavailable" } } });

    const { result } = renderHook(() =>
      useRecordListWithAdditions<OwnedRecord>(LIST_URL, belongsToOwnerOne),
    );

    await waitFor(() => {
      expect(result.current.errorMessage).toBe("Database unavailable");
    });
    expect(result.current.records).toEqual([]);
  });
});
