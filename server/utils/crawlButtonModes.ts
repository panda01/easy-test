/**
 * Which buttons a crawl clicks on each page, on top of following its links.
 * Shared by the request validation and the crawler, so both agree on the
 * spelling - and stored on each crawl run (`CrawlRun.buttonMode`).
 *
 * - `linksOnly`: never click buttons (links only - the default).
 * - `allButRisky`: click every labelled button except risky ones (create,
 *   delete, update, logout, pay, confirm, ...).
 * - `openOnly`: click only buttons that say "open" - the strictest.
 */
export const CRAWL_BUTTON_MODES = ["linksOnly", "allButRisky", "openOnly"] as const;

/** One of `CRAWL_BUTTON_MODES`. */
export type CrawlButtonMode = (typeof CRAWL_BUTTON_MODES)[number];

/** The mode a crawl gets when the request names none: links only, no buttons. */
export const DEFAULT_CRAWL_BUTTON_MODE: CrawlButtonMode = "linksOnly";

/**
 * Checks whether a value is one of the button modes.
 * @param value - Anything, e.g. a request body field
 * @returns True when the value is exactly one of `CRAWL_BUTTON_MODES`
 */
export function isCrawlButtonMode(value: unknown): value is CrawlButtonMode {
  return CRAWL_BUTTON_MODES.some((buttonMode) => buttonMode === value);
}
