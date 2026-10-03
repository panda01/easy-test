/**
 * The longest URL the crawler keeps. Longer ones are skipped: the page's URL
 * is part of the `(crawlRunId, url)` unique index, and a Postgres btree entry
 * cannot exceed about 2.7 KB, so one huge link would otherwise fail the whole
 * crawl.
 */
export const MAX_CRAWL_URL_LENGTH = 2000;

/** The two forms of one link the crawler needs. */
export interface NormalizedCrawlUrl {
  /** The page's identity: origin + path, with the query string and hash dropped. */
  identityUrl: string;
  /** What the browser should load: the full URL with only the hash dropped. */
  loadUrl: string;
}

/**
 * Resolves one link the way a browser would and reduces it to the two forms
 * the crawler needs (see `NormalizedCrawlUrl`).
 *
 * Two links are the same page when their `identityUrl`s match, so `/a`,
 * `/a?x=1`, and `/a#top` are one page (the user's choice). The query string
 * is kept in `loadUrl`, because the page may need it to render.
 *
 * Returns null for links the crawler never follows: anything that does not
 * parse, anything that is not http(s) (`mailto:`, `tel:`, `javascript:`, ...),
 * and URLs longer than `MAX_CRAWL_URL_LENGTH`.
 * @param rawHref - The link exactly as written in the page's `href` attribute (may be relative)
 * @param baseUrl - The page's base URL (`document.baseURI`) to resolve relative links against
 * @returns The link's identity and load URLs, or null when it is not followable
 */
export function normalizeCrawlUrl(rawHref: string, baseUrl: string): NormalizedCrawlUrl | null {
  const hrefIsBlank = rawHref.trim() === "";
  if (hrefIsBlank) {
    return null;
  }

  let resolvedUrl: URL;
  try {
    resolvedUrl = new URL(rawHref.trim(), baseUrl);
  } catch {
    return null;
  }

  const protocolIsHttp = resolvedUrl.protocol === "http:" || resolvedUrl.protocol === "https:";
  if (!protocolIsHttp) {
    return null;
  }

  resolvedUrl.hash = "";
  const loadUrl = resolvedUrl.href;
  const urlIsTooLong = loadUrl.length > MAX_CRAWL_URL_LENGTH;
  if (urlIsTooLong) {
    return null;
  }

  const identityUrl = `${resolvedUrl.origin}${resolvedUrl.pathname}`;
  return { identityUrl, loadUrl };
}

/**
 * Checks whether a URL is on the given origin (same scheme, host, and port).
 * A URL that does not parse is never on it.
 * @param url - An absolute URL
 * @param origin - The origin to compare with, e.g. `http://localhost:5180`
 * @returns True when the URL's origin equals `origin`
 */
export function isSameOriginUrl(url: string, origin: string): boolean {
  try {
    const urlOrigin = new URL(url).origin;
    return urlOrigin === origin;
  } catch {
    return false;
  }
}
