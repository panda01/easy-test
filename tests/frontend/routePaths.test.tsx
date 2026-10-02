import { describe, it, expect } from "vitest";
import {
  NEW_WEBSITE_PATH,
  WEBSITE_LIST_PATH,
  WEBSITES_API_URL,
  newWebsiteItemPath,
  screenshotRunImageApiUrl,
  screenshotRunsApiUrl,
  websiteApiUrl,
  websiteDetailPath,
  websiteEditPath,
  websiteItemApiUrl,
  websiteItemDetailPath,
  websiteItemEditPath,
  websiteItemsApiUrl,
} from "../../src/utils/routePaths";
import { ACTION_KIND, USE_CASE_KIND } from "../../src/utils/websiteItemKinds";

/** An id containing characters that would change a path's shape if left unescaped. */
const UNSAFE_ID = "a/b c?d#e";
const ENCODED_UNSAFE_ID = "a%2Fb%20c%3Fd%23e";

describe("routePaths: page paths", () => {
  it("exposes the website list and create-form paths", () => {
    expect(WEBSITE_LIST_PATH).toBe("/websites");
    expect(NEW_WEBSITE_PATH).toBe("/websites/new");
  });

  it("builds a website's detail and edit paths", () => {
    expect(websiteDetailPath("website-1")).toBe("/websites/website-1");
    expect(websiteEditPath("website-1")).toBe("/websites/website-1/edit");
  });

  it("encodes the website id in page paths", () => {
    expect(websiteDetailPath(UNSAFE_ID)).toBe(`/websites/${ENCODED_UNSAFE_ID}`);
    expect(websiteEditPath(UNSAFE_ID)).toBe(`/websites/${ENCODED_UNSAFE_ID}/edit`);
  });

  it.each([
    { itemKind: USE_CASE_KIND, segment: "use-cases" },
    { itemKind: ACTION_KIND, segment: "actions" },
  ])("builds the $segment create, detail, and edit paths", ({ itemKind, segment }) => {
    expect(newWebsiteItemPath(itemKind, "website-1")).toBe(`/websites/website-1/${segment}/new`);
    expect(websiteItemDetailPath(itemKind, "website-1", "item-1")).toBe(
      `/websites/website-1/${segment}/item-1`,
    );
    expect(websiteItemEditPath(itemKind, "website-1", "item-1")).toBe(
      `/websites/website-1/${segment}/item-1/edit`,
    );
  });

  it("encodes both the website id and the item id in item page paths", () => {
    expect(newWebsiteItemPath(USE_CASE_KIND, UNSAFE_ID)).toBe(
      `/websites/${ENCODED_UNSAFE_ID}/use-cases/new`,
    );
    expect(websiteItemDetailPath(ACTION_KIND, UNSAFE_ID, UNSAFE_ID)).toBe(
      `/websites/${ENCODED_UNSAFE_ID}/actions/${ENCODED_UNSAFE_ID}`,
    );
    expect(websiteItemEditPath(ACTION_KIND, UNSAFE_ID, UNSAFE_ID)).toBe(
      `/websites/${ENCODED_UNSAFE_ID}/actions/${ENCODED_UNSAFE_ID}/edit`,
    );
  });
});

describe("routePaths: API urls", () => {
  it("exposes the website collection endpoint", () => {
    expect(WEBSITES_API_URL).toBe("/api/websites");
  });

  it("builds one website's API url", () => {
    expect(websiteApiUrl("website-1")).toBe("/api/websites/website-1");
    expect(websiteApiUrl(UNSAFE_ID)).toBe(`/api/websites/${ENCODED_UNSAFE_ID}`);
  });

  it.each([
    { itemKind: USE_CASE_KIND, segment: "use-cases" },
    { itemKind: ACTION_KIND, segment: "actions" },
  ])("builds the $segment collection and item API urls", ({ itemKind, segment }) => {
    expect(websiteItemsApiUrl(itemKind, "website-1")).toBe(`/api/websites/website-1/${segment}`);
    expect(websiteItemApiUrl(itemKind, "website-1", "item-1")).toBe(
      `/api/websites/website-1/${segment}/item-1`,
    );
  });

  it("encodes both ids in item API urls", () => {
    expect(websiteItemsApiUrl(USE_CASE_KIND, UNSAFE_ID)).toBe(
      `/api/websites/${ENCODED_UNSAFE_ID}/use-cases`,
    );
    expect(websiteItemApiUrl(USE_CASE_KIND, UNSAFE_ID, UNSAFE_ID)).toBe(
      `/api/websites/${ENCODED_UNSAFE_ID}/use-cases/${ENCODED_UNSAFE_ID}`,
    );
  });
});

describe("routePaths: screenshot run API urls", () => {
  it("builds a website's screenshot run collection url", () => {
    expect(screenshotRunsApiUrl("website-1")).toBe("/api/websites/website-1/screenshot-runs");
  });

  it("builds one screenshot run's image url", () => {
    expect(screenshotRunImageApiUrl("website-1", "run-1")).toBe(
      "/api/websites/website-1/screenshot-runs/run-1/screenshot",
    );
  });

  it("encodes both ids in screenshot run urls", () => {
    expect(screenshotRunsApiUrl(UNSAFE_ID)).toBe(
      `/api/websites/${ENCODED_UNSAFE_ID}/screenshot-runs`,
    );
    expect(screenshotRunImageApiUrl(UNSAFE_ID, UNSAFE_ID)).toBe(
      `/api/websites/${ENCODED_UNSAFE_ID}/screenshot-runs/${ENCODED_UNSAFE_ID}/screenshot`,
    );
  });
});
