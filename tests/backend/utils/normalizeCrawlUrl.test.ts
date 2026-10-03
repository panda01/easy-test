import { describe, it, expect } from "vitest";
import {
  MAX_CRAWL_URL_LENGTH,
  isSameOriginUrl,
  normalizeCrawlUrl,
} from "../../../server/utils/normalizeCrawlUrl.js";

const PAGE_URL = "https://example.com/docs/guide";

describe("normalizeCrawlUrl", () => {
  it("resolves a relative link against the base URL", () => {
    expect(normalizeCrawlUrl("intro", PAGE_URL)).toEqual({
      identityUrl: "https://example.com/docs/intro",
      loadUrl: "https://example.com/docs/intro",
    });
    expect(normalizeCrawlUrl("/about", PAGE_URL)).toEqual({
      identityUrl: "https://example.com/about",
      loadUrl: "https://example.com/about",
    });
  });

  it("drops the query string from the identity but keeps it in the load URL; drops the hash from both", () => {
    expect(normalizeCrawlUrl("/search?q=shoes#results", PAGE_URL)).toEqual({
      identityUrl: "https://example.com/search",
      loadUrl: "https://example.com/search?q=shoes",
    });
  });

  it("gives a same-page hash link the page's own identity", () => {
    expect(normalizeCrawlUrl("#top", PAGE_URL)).toEqual({
      identityUrl: PAGE_URL,
      loadUrl: PAGE_URL,
    });
  });

  it("keeps a trailing slash, so /a and /a/ are different pages", () => {
    expect(normalizeCrawlUrl("/a", PAGE_URL)?.identityUrl).toBe("https://example.com/a");
    expect(normalizeCrawlUrl("/a/", PAGE_URL)?.identityUrl).toBe("https://example.com/a/");
  });

  it("trims whitespace around the href, as a browser does", () => {
    expect(normalizeCrawlUrl("  /about \n", PAGE_URL)?.loadUrl).toBe("https://example.com/about");
  });

  it("keeps an absolute link to another origin, so the caller can decide", () => {
    expect(normalizeCrawlUrl("http://other.example:8080/x", PAGE_URL)).toEqual({
      identityUrl: "http://other.example:8080/x",
      loadUrl: "http://other.example:8080/x",
    });
  });

  it.each([
    { description: "an empty href", rawHref: "" },
    { description: "a blank href", rawHref: "   " },
    { description: "a mailto link", rawHref: "mailto:hello@example.com" },
    { description: "a tel link", rawHref: "tel:+15555550100" },
    { description: "a javascript link", rawHref: "javascript:void(0)" },
    { description: "an ftp link", rawHref: "ftp://example.com/file" },
    { description: "a link that does not parse", rawHref: "http://[broken" },
  ])("returns null for $description", ({ rawHref }) => {
    expect(normalizeCrawlUrl(rawHref, PAGE_URL)).toBeNull();
  });

  it("returns null when the base URL itself does not parse and the link is relative", () => {
    expect(normalizeCrawlUrl("/about", "not a url")).toBeNull();
  });

  it(`returns null for a URL longer than ${String(MAX_CRAWL_URL_LENGTH)} characters, and keeps one at the limit`, () => {
    const origin = "https://example.com/";
    const pathAtLimit = "a".repeat(MAX_CRAWL_URL_LENGTH - origin.length);
    expect(normalizeCrawlUrl(`${origin}${pathAtLimit}`, PAGE_URL)?.loadUrl).toHaveLength(
      MAX_CRAWL_URL_LENGTH,
    );
    expect(normalizeCrawlUrl(`${origin}${pathAtLimit}b`, PAGE_URL)).toBeNull();
  });
});

describe("isSameOriginUrl", () => {
  it("is true when the scheme, host, and port all match", () => {
    expect(isSameOriginUrl("https://example.com/a?b=1", "https://example.com")).toBe(true);
  });

  it.each([
    { description: "another scheme", url: "http://example.com/a" },
    { description: "another host", url: "https://www.example.com/a" },
    { description: "another port", url: "https://example.com:8443/a" },
  ])("is false for $description", ({ url }) => {
    expect(isSameOriginUrl(url, "https://example.com")).toBe(false);
  });

  it("is false for a URL that does not parse", () => {
    expect(isSameOriginUrl("not a url", "https://example.com")).toBe(false);
  });
});
