import { describe, it, expect } from "vitest";
import {
  crawlRunLoginSeverity,
  crawlRunSeverity,
  describeCrawlButtonMode,
  describeCrawlRunLogin,
  describeCrawlRunProgress,
  describeCrawlRunStatus,
  describeCrawledPagePath,
  formatCrawlButtonModeSuffix,
  formatCrawledPagePath,
  identifyCrawledUrl,
} from "../../src/utils/describeCrawlRun";

describe("describeCrawlRunStatus", () => {
  it.each([
    { status: "running", visitedPageCount: 12, expected: "Running · 12 pages so far" },
    { status: "running", visitedPageCount: 1, expected: "Running · 1 page so far" },
    { status: "finished", visitedPageCount: 34, expected: "Finished · 34 pages" },
    {
      status: "stoppedAtPageLimit",
      visitedPageCount: 50,
      expected: "Stopped at the 50-page limit · 50 pages",
    },
    { status: "stoppedAtTimeLimit", visitedPageCount: 20, expected: "Stopped at the time limit · 20 pages" },
    { status: "failed", visitedPageCount: 0, expected: "Failed · 0 pages" },
    {
      status: "interrupted",
      visitedPageCount: 7,
      expected: "Interrupted (the server restarted or the browser closed) · 7 pages",
    },
    { status: "somethingNew", visitedPageCount: 2, expected: "somethingNew · 2 pages" },
  ])("words a $status crawl of $visitedPageCount page(s) as '$expected'", ({ status, visitedPageCount, expected }) => {
    expect(describeCrawlRunStatus({ status, visitedPageCount, pageLimit: 50 })).toBe(expected);
  });
});

describe("describeCrawlRunProgress", () => {
  it("names the visited pages, the limit, and the waiting links", () => {
    expect(
      describeCrawlRunProgress({
        status: "running",
        visitedPageCount: 12,
        pageLimit: 50,
        waitingUrlCount: 30,
      }),
    ).toBe("Visited 12 of up to 50 pages · 30 links waiting");
  });

  it("uses the singular for one waiting link", () => {
    expect(
      describeCrawlRunProgress({
        status: "running",
        visitedPageCount: 1,
        pageLimit: 50,
        waitingUrlCount: 1,
      }),
    ).toBe("Visited 1 of up to 50 pages · 1 link waiting");
  });
});

describe("crawlRunSeverity", () => {
  it.each([
    { status: "running", severity: "info" },
    { status: "finished", severity: "success" },
    { status: "stoppedAtPageLimit", severity: "warning" },
    { status: "stoppedAtTimeLimit", severity: "warning" },
    { status: "failed", severity: "error" },
    { status: "interrupted", severity: "error" },
  ])("colours a $status crawl as $severity", ({ status, severity }) => {
    expect(crawlRunSeverity(status)).toBe(severity);
  });
});

describe("describeCrawlButtonMode / formatCrawlButtonModeSuffix", () => {
  it.each([
    { buttonMode: "linksOnly", text: "links only", suffix: "" },
    {
      buttonMode: "allButRisky",
      text: "clicked buttons except risky ones",
      suffix: " · clicked buttons except risky ones",
    },
    {
      buttonMode: "openOnly",
      text: "clicked only “Open” buttons",
      suffix: " · clicked only “Open” buttons",
    },
    { buttonMode: "somethingNew", text: "somethingNew", suffix: " · somethingNew" },
  ])("words the $buttonMode mode as '$text'", ({ buttonMode, text, suffix }) => {
    expect(describeCrawlButtonMode(buttonMode)).toBe(text);
    expect(formatCrawlButtonModeSuffix(buttonMode)).toBe(suffix);
  });
});

describe("formatCrawledPagePath", () => {
  it("shows a page's path", () => {
    expect(formatCrawledPagePath("https://example.com/websites/abc")).toBe("/websites/abc");
    expect(formatCrawledPagePath("https://example.com/")).toBe("/");
  });

  it("shows a URL that does not parse as it is", () => {
    expect(formatCrawledPagePath("not a url")).toBe("not a url");
  });
});

describe("describeCrawlRunLogin / crawlRunLoginSeverity", () => {
  const adminCredential = { name: "Admin" };

  it.each([
    {
      label: "a crawl without a credential",
      run: { status: "finished", isLoggedIn: false, credential: null },
      text: "Crawled logged out (no credential)",
      severity: "info",
    },
    {
      label: "a crawl that logged in",
      run: { status: "finished", isLoggedIn: true, credential: adminCredential },
      text: 'Logged in as "Admin"',
      severity: "success",
    },
    {
      label: "a running crawl that has logged in",
      run: { status: "running", isLoggedIn: true, credential: adminCredential },
      text: 'Logged in as "Admin"',
      severity: "success",
    },
    {
      label: "a running crawl still logging in",
      run: { status: "running", isLoggedIn: false, credential: adminCredential },
      text: 'Logging in as "Admin"…',
      severity: "info",
    },
    {
      label: "a crawl whose login failed",
      run: { status: "failed", isLoggedIn: false, credential: adminCredential },
      text: 'Not logged in - the login as "Admin" did not succeed',
      severity: "error",
    },
    {
      label: "a crawl interrupted while logging in",
      run: { status: "interrupted", isLoggedIn: false, credential: adminCredential },
      text: 'Not logged in - the login as "Admin" did not succeed',
      severity: "error",
    },
  ])("words and colours $label", ({ run, text, severity }) => {
    expect(describeCrawlRunLogin(run)).toBe(text);
    expect(crawlRunLoginSeverity(run)).toBe(severity);
  });
});

describe("identifyCrawledUrl", () => {
  it("keeps only the origin and path, like the crawler's page identity", () => {
    expect(identifyCrawledUrl("https://example.com/search?q=shoes#results")).toBe(
      "https://example.com/search",
    );
    expect(identifyCrawledUrl("HTTPS://Example.com")).toBe("https://example.com/");
  });

  it("returns a URL that does not parse as it is", () => {
    expect(identifyCrawledUrl("not a url")).toBe("not a url");
  });
});

describe("describeCrawledPagePath", () => {
  it.each([
    {
      label: "a page that was not redirected",
      page: {
        url: "https://example.com/schools",
        requestedUrl: "https://example.com/schools?tab=all",
        finalUrl: "https://example.com/schools?tab=all",
        wasRedirected: false,
      },
      expected: "/schools",
    },
    {
      label: "a page recorded where its redirect landed",
      page: {
        url: "https://example.com/calendar",
        requestedUrl: "https://example.com/",
        finalUrl: "https://example.com/calendar",
        wasRedirected: true,
      },
      expected: "/calendar (from /)",
    },
    {
      label: "a page that redirected onto a page already in the crawl",
      page: {
        url: "https://example.com/old-account",
        requestedUrl: "https://example.com/old-account",
        finalUrl: "https://example.com/account",
        wasRedirected: true,
      },
      expected: "/old-account → /account",
    },
    {
      label: "a page that was redirected off the site",
      page: {
        url: "https://accounts.example.org/login",
        requestedUrl: "https://example.com/dashboard",
        finalUrl: "https://accounts.example.org/login?next=%2Fdashboard",
        wasRedirected: true,
      },
      expected: "https://accounts.example.org/login (from https://example.com/dashboard)",
    },
    {
      label: "an already-recorded landing page on another site",
      page: {
        url: "https://example.com/sso",
        requestedUrl: "https://example.com/sso",
        finalUrl: "https://accounts.example.org/login",
        wasRedirected: true,
      },
      expected: "/sso → https://accounts.example.org/login",
    },
    {
      label: "a redirected page whose URLs do not parse",
      page: {
        url: "not a url",
        requestedUrl: "also not a url",
        finalUrl: "not a url",
        wasRedirected: true,
      },
      expected: "not a url (from also not a url)",
    },
  ])("labels $label", ({ page, expected }) => {
    expect(describeCrawledPagePath(page)).toBe(expected);
  });
});
