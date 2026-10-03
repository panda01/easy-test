import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useCredential, useCredentials } from "../../src/hooks/useCredentials";
import { buildCredentialRecord, stubFetchRoutes } from "./support/frontendTestHelpers";

const CREDENTIALS_API_URL = "/api/websites/website-1/credentials";
const CREDENTIAL_API_URL = `${CREDENTIALS_API_URL}/credential-1`;

describe("useCredentials", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("GETs the website's credentials and returns them in the server's order", async () => {
    const newer = buildCredentialRecord({ id: "credential-2", name: "Viewer" });
    const older = buildCredentialRecord({ id: "credential-1" });
    const fetchStub = stubFetchRoutes({
      [`GET ${CREDENTIALS_API_URL}`]: { status: 200, body: [newer, older] },
    });

    const { result } = renderHook(() => useCredentials("website-1"));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current).toEqual({ data: [newer, older], isLoading: false, errorMessage: null });
    expect(fetchStub).toHaveBeenCalledWith(CREDENTIALS_API_URL);
  });

  it("reports the server's reason when the list cannot be fetched", async () => {
    stubFetchRoutes({
      [`GET ${CREDENTIALS_API_URL}`]: { status: 404, body: { error: "Website not found" } },
    });

    const { result } = renderHook(() => useCredentials("website-1"));

    await waitFor(() => {
      expect(result.current.errorMessage).toBe("Website not found");
    });
    expect(result.current.data).toBeNull();
  });
});

describe("useCredential", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("GETs one credential", async () => {
    const credential = buildCredentialRecord();
    const fetchStub = stubFetchRoutes({
      [`GET ${CREDENTIAL_API_URL}`]: { status: 200, body: credential },
    });

    const { result } = renderHook(() => useCredential("website-1", "credential-1"));

    await waitFor(() => {
      expect(result.current.data).toEqual(credential);
    });
    expect(fetchStub).toHaveBeenCalledWith(CREDENTIAL_API_URL);
  });

  it("reports the server's not-found reason for a deleted credential", async () => {
    stubFetchRoutes({
      [`GET ${CREDENTIAL_API_URL}`]: { status: 404, body: { error: "Credential not found" } },
    });

    const { result } = renderHook(() => useCredential("website-1", "credential-1"));

    await waitFor(() => {
      expect(result.current.errorMessage).toBe("Credential not found");
    });
  });
});
