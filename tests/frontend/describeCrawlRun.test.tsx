import { describe, it, expect } from "vitest";
import {
  CRAWL_TIME_LIMIT_MS,
  crawlRunHistorySeverity,
  crawlRunLoginFailed,
  crawlRunLoginSeverity,
  crawlRunSeverity,
  describeCrawlRunHistoryLabel,
  describeCrawlRunLogin,
  describeCrawlRunProgress,
  describeCrawlRunStatus,
  describeRedirectFact,
  describeSiteMapNote,
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
    ).toBe("12 of up to 50 pages · 30 waiting");
  });

  it("writes one waiting link the same short way", () => {
    expect(
      describeCrawlRunProgress({
        status: "running",
        visitedPageCount: 1,
        pageLimit: 50,
        waitingUrlCount: 1,
      }),
    ).toBe("1 of up to 50 pages · 1 waiting");
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
      text: "Logged out",
      severity: "info",
    },
    {
      label: "a crawl that logged in",
      run: { status: "finished", isLoggedIn: true, credential: adminCredential },
      text: "Logged in as “Admin”",
      severity: "success",
    },
    {
      label: "a running crawl that has logged in",
      run: { status: "running", isLoggedIn: true, credential: adminCredential },
      text: "Logged in as “Admin”",
      severity: "success",
    },
    {
      label: "a running crawl still logging in",
      run: { status: "running", isLoggedIn: false, credential: adminCredential },
      text: "Logging in as “Admin”…",
      severity: "info",
    },
    {
      label: "a crawl whose login failed",
      run: { status: "failed", isLoggedIn: false, credential: adminCredential },
      text: "Not logged in — login as “Admin” failed",
      severity: "error",
    },
    {
      label: "a crawl interrupted while logging in",
      run: { status: "interrupted", isLoggedIn: false, credential: adminCredential },
      text: "Not logged in — login as “Admin” failed",
      severity: "error",
    },
  ])("words and colours $label", ({ run, text, severity }) => {
    expect(describeCrawlRunLogin(run)).toBe(text);
    expect(crawlRunLoginSeverity(run)).toBe(severity);
    expect(crawlRunLoginFailed(run)).toBe(severity === "error");
  });
});

describe("describeCrawlRunHistoryLabel / crawlRunHistorySeverity", () => {
  const adminCredential = { name: "Admin" };

  it("words and colours a crawl by how it went when its login did not fail", () => {
    const run = {
      status: "stoppedAtPageLimit",
      visitedPageCount: 50,
      pageLimit: 50,
      isLoggedIn: true,
      credential: adminCredential,
    };

    expect(describeCrawlRunHistoryLabel(run)).toBe("Stopped at the 50-page limit · 50 pages");
    expect(crawlRunHistorySeverity(run)).toBe("warning");
  });

  it("words and colours a crawl whose login failed by the failed login", () => {
    const run = {
      status: "failed",
      visitedPageCount: 0,
      pageLimit: 50,
      isLoggedIn: false,
      credential: adminCredential,
    };

    expect(describeCrawlRunHistoryLabel(run)).toBe("Not logged in — login as “Admin” failed");
    expect(crawlRunHistorySeverity(run)).toBe("error");
  });

  it("colours a logged-out finished crawl as a success", () => {
    const run = { status: "finished", visitedPageCount: 46, pageLimit: 50, isLoggedIn: false, credential: null };

    expect(describeCrawlRunHistoryLabel(run)).toBe("Finished · 46 pages");
    expect(crawlRunHistorySeverity(run)).toBe("success");
  });
});

describe("CRAWL_TIME_LIMIT_MS", () => {
  it("is the server's 10-minute crawl limit", () => {
    expect(CRAWL_TIME_LIMIT_MS).toBe(10 * 60 * 1000);
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

/** The outcome fields of a page that loaded, for `describeSiteMapNote`. */
const loadedPageOutcome = { succeeded: true, httpStatus: 200, foundByButtonText: null };

describe("describeRedirectFact / describeSiteMapNote", () => {
  it.each([
    {
      label: "a page that was not redirected",
      page: {
        url: "https://example.com/schools",
        requestedUrl: "https://example.com/schools?tab=all",
        finalUrl: "https://example.com/schools?tab=all",
        wasRedirected: false,
      },
      fact: null,
      note: "",
    },
    {
      label: "a page recorded where its redirect landed",
      page: {
        url: "https://example.com/calendar",
        requestedUrl: "https://example.com/",
        finalUrl: "https://example.com/calendar",
        wasRedirected: true,
      },
      fact: "Redirected from /",
      note: "from /",
    },
    {
      label: "a page that redirected onto a page already in the crawl",
      page: {
        url: "https://example.com/old-account",
        requestedUrl: "https://example.com/old-account",
        finalUrl: "https://example.com/account",
        wasRedirected: true,
      },
      fact: "Redirected to /account",
      note: "→ /account",
    },
    {
      label: "a page that was redirected off the site",
      page: {
        url: "https://accounts.example.org/login",
        requestedUrl: "https://example.com/dashboard",
        finalUrl: "https://accounts.example.org/login?next=%2Fdashboard",
        wasRedirected: true,
      },
      fact: "Redirected from https://example.com/dashboard",
      note: "from https://example.com/dashboard",
    },
    {
      label: "an already-recorded landing page on another site",
      page: {
        url: "https://example.com/sso",
        requestedUrl: "https://example.com/sso",
        finalUrl: "https://accounts.example.org/login",
        wasRedirected: true,
      },
      fact: "Redirected to https://accounts.example.org/login",
      note: "→ https://accounts.example.org/login",
    },
    {
      label: "a redirected page whose URLs do not parse",
      page: {
        url: "not a url",
        requestedUrl: "also not a url",
        finalUrl: "not a url",
        wasRedirected: true,
      },
      fact: "Redirected from also not a url",
      note: "from also not a url",
    },
  ])("words the redirect of $label", ({ page, fact, note }) => {
    expect(describeRedirectFact(page)).toBe(fact);
    expect(describeSiteMapNote({ ...page, ...loadedPageOutcome })).toBe(note);
  });

  const plainPage = {
    url: "https://example.com/sessions/open-yoga",
    requestedUrl: "https://example.com/sessions/open-yoga",
    finalUrl: "https://example.com/sessions/open-yoga",
    wasRedirected: false,
  };

  it("notes the button that led to a page", () => {
    expect(describeSiteMapNote({ ...plainPage, ...loadedPageOutcome, foundByButtonText: "Open Yoga" })).toBe(
      "via “Open Yoga”",
    );
  });

  it("notes a failed page's HTTP status before anything else", () => {
    expect(
      describeSiteMapNote({ ...plainPage, succeeded: false, httpStatus: 404, foundByButtonText: "Open Yoga" }),
    ).toBe("HTTP 404");
  });

  it("notes a failed page that never answered", () => {
    expect(describeSiteMapNote({ ...plainPage, succeeded: false, httpStatus: null, foundByButtonText: null })).toBe(
      "No response",
    );
  });
});
