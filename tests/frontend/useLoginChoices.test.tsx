import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { findLoginActionOption, useLoginChoices } from "../../src/hooks/useLoginChoices";
import {
  buildCredentialRecord,
  buildJsonResponse,
  buildLoginActionItemRecord,
  buildWebsiteItemRecord,
  countRequests,
  createDeferred,
  stubFetchRoutes,
} from "./support/frontendTestHelpers";

const CREDENTIALS_API_URL = "/api/websites/website-1/credentials";
const ACTIONS_API_URL = "/api/websites/website-1/actions";
const WEBSITE_LOGIN_URL = "https://example.com/login";

/** The website's two credentials, newest first. */
const WEBSITE_CREDENTIALS = [
  buildCredentialRecord({ id: "credential-2", name: "Viewer" }),
  buildCredentialRecord({ id: "credential-1", name: "Admin" }),
];

/** The website's actions, newest first: its Login action among ordinary ones. */
const WEBSITE_ACTIONS = [
  buildWebsiteItemRecord({ id: "item-3", title: "Book a class", userActionKind: "create" }),
  buildLoginActionItemRecord({ id: "login-action-1", title: "Sign in" }),
  buildWebsiteItemRecord({ id: "item-4", title: "Search", userActionKind: null }),
];

describe("findLoginActionOption", () => {
  it("picks the website's Login action, as id and title", () => {
    expect(findLoginActionOption(WEBSITE_ACTIONS, null)).toEqual({ id: "login-action-1", title: "Sign in" });
  });

  it("names the Login action while another action is being edited", () => {
    expect(findLoginActionOption(WEBSITE_ACTIONS, "item-3")).toEqual({ id: "login-action-1", title: "Sign in" });
  });

  it("does not count the Login action itself while it is the action being edited", () => {
    expect(findLoginActionOption(WEBSITE_ACTIONS, "login-action-1")).toBeNull();
  });

  it("finds nothing for a website without a Login action", () => {
    expect(findLoginActionOption([buildWebsiteItemRecord()], null)).toBeNull();
    expect(findLoginActionOption([], null)).toBeNull();
  });
});

describe("useLoginChoices", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("GETs the credentials and the actions, then offers the credentials, the Login action, and the website's login page", async () => {
    const fetchStub = stubFetchRoutes({
      [`GET ${CREDENTIALS_API_URL}`]: { status: 200, body: WEBSITE_CREDENTIALS },
      [`GET ${ACTIONS_API_URL}`]: { status: 200, body: WEBSITE_ACTIONS },
    });

    const { result } = renderHook(() => useLoginChoices("website-1", true, WEBSITE_LOGIN_URL, null));

    expect(result.current).toEqual({ loginChoices: null, isLoading: true, errorMessage: null });
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current).toEqual({
      loginChoices: {
        credentials: [
          { id: "credential-2", name: "Viewer" },
          { id: "credential-1", name: "Admin" },
        ],
        loginAction: { id: "login-action-1", title: "Sign in" },
        websiteLoginUrl: WEBSITE_LOGIN_URL,
      },
      isLoading: false,
      errorMessage: null,
    });
    expect(countRequests(fetchStub, "GET", CREDENTIALS_API_URL)).toBe(1);
    expect(countRequests(fetchStub, "GET", ACTIONS_API_URL)).toBe(1);
  });

  it("does not name the edited Login action as the website's Login action, and passes a missing login page on as null", async () => {
    stubFetchRoutes({
      [`GET ${CREDENTIALS_API_URL}`]: { status: 200, body: WEBSITE_CREDENTIALS },
      [`GET ${ACTIONS_API_URL}`]: { status: 200, body: WEBSITE_ACTIONS },
    });

    const { result } = renderHook(() => useLoginChoices("website-1", true, null, "login-action-1"));

    await waitFor(() => {
      expect(result.current.loginChoices).not.toBeNull();
    });
    expect(result.current.loginChoices?.loginAction).toBeNull();
    expect(result.current.loginChoices?.websiteLoginUrl).toBeNull();
  });

  it("offers nothing until both lists have loaded", async () => {
    const pendingActions = createDeferred<Response>();
    const fetchStub = stubFetchRoutes({
      [`GET ${CREDENTIALS_API_URL}`]: { status: 200, body: WEBSITE_CREDENTIALS },
      [`GET ${ACTIONS_API_URL}`]: () => pendingActions.promise,
    });

    const { result } = renderHook(() => useLoginChoices("website-1", true, WEBSITE_LOGIN_URL, null));

    // Let the credential list arrive; the choices still wait for the actions.
    await waitFor(() => {
      expect(countRequests(fetchStub, "GET", CREDENTIALS_API_URL)).toBe(1);
    });
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });
    expect(result.current.loginChoices).toBeNull();
    expect(result.current.isLoading).toBe(true);

    await act(async () => {
      pendingActions.resolve(buildJsonResponse(200, WEBSITE_ACTIONS));
      await pendingActions.promise;
    });

    await waitFor(() => {
      expect(result.current.loginChoices).not.toBeNull();
    });
    expect(result.current.isLoading).toBe(false);
  });

  it("fetches nothing and stays idle while not needed (use cases)", () => {
    const fetchStub = stubFetchRoutes({});

    const { result } = renderHook(() => useLoginChoices("website-1", false, WEBSITE_LOGIN_URL, null));

    expect(result.current).toEqual({ loginChoices: null, isLoading: false, errorMessage: null });
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("reports why the credentials could not be loaded", async () => {
    stubFetchRoutes({
      [`GET ${CREDENTIALS_API_URL}`]: { status: 500, body: { error: "Database unavailable" } },
      [`GET ${ACTIONS_API_URL}`]: { status: 200, body: WEBSITE_ACTIONS },
    });

    const { result } = renderHook(() => useLoginChoices("website-1", true, WEBSITE_LOGIN_URL, null));

    await waitFor(() => {
      expect(result.current.errorMessage).toBe("Database unavailable");
    });
    expect(result.current.loginChoices).toBeNull();
  });

  it("reports why the actions could not be loaded", async () => {
    stubFetchRoutes({
      [`GET ${CREDENTIALS_API_URL}`]: { status: 200, body: WEBSITE_CREDENTIALS },
      [`GET ${ACTIONS_API_URL}`]: { status: 500, body: { error: "Actions are unavailable" } },
    });

    const { result } = renderHook(() => useLoginChoices("website-1", true, WEBSITE_LOGIN_URL, null));

    await waitFor(() => {
      expect(result.current.errorMessage).toBe("Actions are unavailable");
    });
    expect(result.current.loginChoices).toBeNull();
  });
});
