import { describe, it, expect } from "vitest";
import type { CrawledPageSnapshot } from "../../../server/services/dbService.js";
import {
  MAX_CONTEXT_CHARACTERS,
  MAX_CONTEXT_PAGES,
  MAX_SNAPSHOT_CHARACTERS,
  capSnapshot,
  extractActionSearchTerms,
  scoreCrawledPage,
  selectContextPagesByUrl,
  selectRelevantCrawledPages,
  type ActionSearchTerm,
} from "../../../server/utils/selectRelevantCrawledPages.js";

/** The one search term most tests score pages by. */
const CART_TERMS: ActionSearchTerm[] = [{ term: "cart", count: 1 }];

/**
 * Builds a crawled page, defaulting to a page deeper than the start page with
 * no title and a snapshot that mentions nothing.
 * @param overrides - Fields to replace
 * @returns The page
 */
function buildPage(overrides: Partial<CrawledPageSnapshot> = {}): CrawledPageSnapshot {
  return {
    url: "https://shop.example.com/about",
    title: null,
    depth: 1,
    ariaSnapshot: '- heading "About us" [level=1]',
    ...overrides,
  };
}

/**
 * Builds a snapshot of an exact length that mentions no search term.
 * @param length - How many characters it has
 * @returns The snapshot
 */
function buildFillerSnapshot(length: number): string {
  return "x".repeat(length);
}

describe("extractActionSearchTerms", () => {
  it("counts every meaningful word and every pair of adjacent meaningful words, most repeated first", () => {
    const searchTerms = extractActionSearchTerms(
      "Add a product to the cart",
      "Open the product page and add it to the cart.",
    );

    expect(searchTerms).toEqual([
      { term: "product", count: 2 },
      { term: "cart", count: 2 },
      { term: "add", count: 2 },
      { term: "product page", count: 1 },
      { term: "open", count: 1 },
      { term: "page", count: 1 },
    ]);
  });

  it("drops stop words, including the filler use cases are written in", () => {
    const searchTerms = extractActionSearchTerms("The user should see their orders", "");

    expect(searchTerms).toEqual([{ term: "orders", count: 1 }]);
  });

  it("drops words shorter than three characters", () => {
    const searchTerms = extractActionSearchTerms("Go to id 42 page a1", "");

    expect(searchTerms).toEqual([{ term: "page", count: 1 }]);
  });

  it("only pairs words that stand next to each other with nothing dropped between them", () => {
    const searchTerms = extractActionSearchTerms("search results", "search the results");

    expect(searchTerms).toEqual([
      { term: "results", count: 2 },
      { term: "search", count: 2 },
      { term: "search results", count: 1 },
    ]);
  });

  it("never pairs the last word of the title with the first word of the description", () => {
    const searchTerms = extractActionSearchTerms("Empty cart", "Checkout now");

    expect(searchTerms.map(({ term }) => term)).not.toContain("cart checkout");
    expect(searchTerms.map(({ term }) => term)).toContain("empty cart");
  });

  it("lowercases the words and splits them at punctuation, keeping letters and digits of any script", () => {
    const searchTerms = extractActionSearchTerms("Sign-In to CAFÉ_2024!!", "");

    expect(searchTerms).toEqual([
      { term: "café 2024", count: 1 },
      { term: "sign", count: 1 },
      { term: "café", count: 1 },
      { term: "2024", count: 1 },
    ]);
  });

  it("breaks count ties by length, longer (more specific) first", () => {
    const searchTerms = extractActionSearchTerms("zip", "checkout");

    expect(searchTerms).toEqual([
      { term: "checkout", count: 1 },
      { term: "zip", count: 1 },
    ]);
  });

  it("returns at most 12 terms", () => {
    const words = [
      "alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf",
      "hotel", "india", "juliet", "kilo", "lima", "mike", "november",
    ];
    // "the" between the words keeps them from pairing up.
    const searchTerms = extractActionSearchTerms(words.join(" the "), "");

    expect(searchTerms).toHaveLength(12);
  });

  it("returns nothing for an action with no meaningful words", () => {
    expect(extractActionSearchTerms("", "")).toEqual([]);
    expect(extractActionSearchTerms("Do it", "Go to the one")).toEqual([]);
  });
});

describe("scoreCrawledPage", () => {
  it("scores 0 when no term appears on the page", () => {
    expect(scoreCrawledPage(buildPage(), CART_TERMS)).toBe(0);
  });

  it("counts a match in the snapshot once", () => {
    const page = buildPage({ ariaSnapshot: '- button "Add to cart"' });

    expect(scoreCrawledPage(page, CART_TERMS)).toBe(1);
  });

  it("matches the snapshot case-insensitively", () => {
    const page = buildPage({ ariaSnapshot: '- link "CART"\n- link "Cart (2)"' });

    expect(scoreCrawledPage(page, CART_TERMS)).toBe(2);
  });

  it("counts a match in the URL path three times", () => {
    const page = buildPage({ url: "https://shop.example.com/cart" });

    expect(scoreCrawledPage(page, CART_TERMS)).toBe(3);
  });

  it("counts a match in the title three times", () => {
    const page = buildPage({ title: "Your Cart" });

    expect(scoreCrawledPage(page, CART_TERMS)).toBe(3);
  });

  it("matches a two-word term in a URL that separates words with - _ and /", () => {
    const searchTerms = [{ term: "order history", count: 1 }];

    expect(scoreCrawledPage(buildPage({ url: "https://shop.example.com/order-history" }), searchTerms)).toBe(3);
    expect(scoreCrawledPage(buildPage({ url: "https://shop.example.com/order_history" }), searchTerms)).toBe(3);
    expect(scoreCrawledPage(buildPage({ url: "https://shop.example.com/order/history" }), searchTerms)).toBe(3);
  });

  it("ignores the host, the query string, and the hash", () => {
    const page = buildPage({ url: "https://cart.example.com/search?q=cart#cart" });

    expect(scoreCrawledPage(page, CART_TERMS)).toBe(0);
  });

  it("caps each term at five matches in the snapshot and five in the URL and title", () => {
    const snapshotPage = buildPage({ ariaSnapshot: "cart ".repeat(9) });
    const titlePage = buildPage({ title: "cart ".repeat(9) });

    expect(scoreCrawledPage(snapshotPage, CART_TERMS)).toBe(5);
    expect(scoreCrawledPage(titlePage, CART_TERMS)).toBe(15);
  });

  it("multiplies each match by how often the action repeats the term, and adds up every term", () => {
    const page = buildPage({
      url: "https://shop.example.com/cart",
      title: "Checkout",
      ariaSnapshot: '- button "Checkout"\n- text "Your cart"',
    });
    const searchTerms = [
      { term: "cart", count: 2 },
      { term: "checkout", count: 3 },
    ];

    // cart: 2 x (1 path match x 3 + 1 snapshot match) = 8
    // checkout: 3 x (1 title match x 3 + 1 snapshot match) = 12
    expect(scoreCrawledPage(page, searchTerms)).toBe(20);
  });

  it("scores 0 for no search terms", () => {
    expect(scoreCrawledPage(buildPage({ title: "Cart" }), [])).toBe(0);
  });
});

describe("selectRelevantCrawledPages", () => {
  const startPage = buildPage({ url: "https://shop.example.com/", depth: 0, title: "Home" });

  it("always puts the start page first, even when it mentions none of the terms", () => {
    const cartPage = buildPage({ url: "https://shop.example.com/cart", title: "Cart" });

    const selectedPages = selectRelevantCrawledPages([cartPage, startPage], CART_TERMS);

    expect(selectedPages.map(({ url }) => url)).toEqual([
      "https://shop.example.com/",
      "https://shop.example.com/cart",
    ]);
  });

  it("leaves out deeper pages that mention none of the terms", () => {
    const aboutPage = buildPage();

    const selectedPages = selectRelevantCrawledPages([startPage, aboutPage], CART_TERMS);

    expect(selectedPages.map(({ url }) => url)).toEqual(["https://shop.example.com/"]);
  });

  it("orders the other pages best score first", () => {
    const snapshotMentionPage = buildPage({ url: "https://shop.example.com/a", ariaSnapshot: "cart" });
    const titleMentionPage = buildPage({ url: "https://shop.example.com/b", title: "Cart" });
    const doubleTitleMentionPage = buildPage({ url: "https://shop.example.com/c", title: "Cart cart" });

    const selectedPages = selectRelevantCrawledPages(
      [snapshotMentionPage, startPage, titleMentionPage, doubleTitleMentionPage],
      CART_TERMS,
    );

    expect(selectedPages.map(({ url }) => url)).toEqual([
      "https://shop.example.com/",
      "https://shop.example.com/c",
      "https://shop.example.com/b",
      "https://shop.example.com/a",
    ]);
  });

  it("returns only each page's URL, title, and snapshot", () => {
    const selectedPages = selectRelevantCrawledPages([startPage], CART_TERMS);

    expect(selectedPages).toEqual([
      { url: "https://shop.example.com/", title: "Home", ariaSnapshot: startPage.ariaSnapshot },
    ]);
  });

  it(`picks at most ${String(MAX_CONTEXT_PAGES)} pages`, () => {
    const cartPages = Array.from({ length: 10 }, (_unused, pageIndex) =>
      buildPage({ url: `https://shop.example.com/cart-${String(pageIndex)}`, title: "Cart" }),
    );

    const selectedPages = selectRelevantCrawledPages([startPage, ...cartPages], CART_TERMS);

    expect(selectedPages).toHaveLength(MAX_CONTEXT_PAGES);
    expect(selectedPages[0].url).toBe("https://shop.example.com/");
  });

  it(`skips a page that would go over ${String(MAX_CONTEXT_CHARACTERS)} characters in favour of smaller, lower-scored ones`, () => {
    const bigStartPage = { ...startPage, ariaSnapshot: buildFillerSnapshot(15_000) };
    const bestPage = buildPage({
      url: "https://shop.example.com/best",
      title: "cart cart cart",
      ariaSnapshot: buildFillerSnapshot(20_000),
    });
    const secondPage = buildPage({
      url: "https://shop.example.com/second",
      title: "cart cart",
      ariaSnapshot: buildFillerSnapshot(20_000),
    });
    const tooBigPage = buildPage({
      url: "https://shop.example.com/too-big",
      title: "cart",
      ariaSnapshot: buildFillerSnapshot(10_000),
    });
    // Exactly fills the budget: 15k + 20k + 20k + 5k = 60k.
    const exactFitPage = buildPage({
      url: "https://shop.example.com/fits",
      ariaSnapshot: `cart${buildFillerSnapshot(4_996)}`,
    });

    const selectedPages = selectRelevantCrawledPages(
      [exactFitPage, tooBigPage, secondPage, bestPage, bigStartPage],
      CART_TERMS,
    );

    expect(selectedPages.map(({ url }) => url)).toEqual([
      "https://shop.example.com/",
      "https://shop.example.com/best",
      "https://shop.example.com/second",
      "https://shop.example.com/fits",
    ]);
    const totalCharacters = selectedPages.reduce((total, page) => total + page.ariaSnapshot.length, 0);
    expect(totalCharacters).toBe(MAX_CONTEXT_CHARACTERS);
  });

  it(`cuts a snapshot longer than ${String(MAX_SNAPSHOT_CHARACTERS)} characters and says how much is missing`, () => {
    const longSnapshot = `${"a".repeat(MAX_SNAPSHOT_CHARACTERS)}${"b".repeat(5_000)}`;
    const longStartPage = { ...startPage, ariaSnapshot: longSnapshot };

    const [selectedPage] = selectRelevantCrawledPages([longStartPage], CART_TERMS);

    expect(selectedPage.ariaSnapshot).toBe(
      `${"a".repeat(MAX_SNAPSHOT_CHARACTERS)}\n# [... snapshot cut here: 5000 more characters not shown ...]`,
    );
  });

  it(`keeps a snapshot of exactly ${String(MAX_SNAPSHOT_CHARACTERS)} characters whole`, () => {
    const fullSnapshot = buildFillerSnapshot(MAX_SNAPSHOT_CHARACTERS);

    const [selectedPage] = selectRelevantCrawledPages([{ ...startPage, ariaSnapshot: fullSnapshot }], CART_TERMS);

    expect(selectedPage.ariaSnapshot).toBe(fullSnapshot);
  });

  it("returns nothing when the website was never crawled", () => {
    expect(selectRelevantCrawledPages([], CART_TERMS)).toEqual([]);
  });
});

describe("capSnapshot", () => {
  it("returns a snapshot under the limit unchanged", () => {
    const shortSnapshot = '- button "Log in"';

    expect(capSnapshot(shortSnapshot)).toBe(shortSnapshot);
  });

  it(`returns a snapshot of exactly ${String(MAX_SNAPSHOT_CHARACTERS)} characters unchanged`, () => {
    const fullSnapshot = buildFillerSnapshot(MAX_SNAPSHOT_CHARACTERS);

    expect(capSnapshot(fullSnapshot)).toBe(fullSnapshot);
  });

  it("cuts a longer snapshot at the limit and says how many characters were left out", () => {
    const longSnapshot = `${"a".repeat(MAX_SNAPSHOT_CHARACTERS)}${"b".repeat(1)}`;

    expect(capSnapshot(longSnapshot)).toBe(
      `${"a".repeat(MAX_SNAPSHOT_CHARACTERS)}\n# [... snapshot cut here: 1 more characters not shown ...]`,
    );
  });
});

describe("selectContextPagesByUrl", () => {
  const startPage = buildPage({ url: "https://shop.example.com/", depth: 0, title: "Home" });
  const cartPage = buildPage({ url: "https://shop.example.com/cart", title: "Cart" });
  const checkoutPage = buildPage({ url: "https://shop.example.com/checkout", title: "Checkout" });

  it("keeps the order of the URLs it is given, not the crawl's order", () => {
    const selectedPages = selectContextPagesByUrl(
      [startPage, cartPage, checkoutPage],
      [checkoutPage.url, startPage.url, cartPage.url],
    );

    expect(selectedPages.map(({ url }) => url)).toEqual([
      "https://shop.example.com/checkout",
      "https://shop.example.com/",
      "https://shop.example.com/cart",
    ]);
  });

  it("returns only each page's URL, title, and snapshot", () => {
    expect(selectContextPagesByUrl([startPage, cartPage], [cartPage.url])).toEqual([
      { url: cartPage.url, title: "Cart", ariaSnapshot: cartPage.ariaSnapshot },
    ]);
  });

  it("skips URLs the crawl no longer has, and pages it was not asked for", () => {
    const selectedPages = selectContextPagesByUrl(
      [startPage, cartPage, checkoutPage],
      ["https://shop.example.com/gone", cartPage.url],
    );

    expect(selectedPages.map(({ url }) => url)).toEqual(["https://shop.example.com/cart"]);
  });

  it("returns nothing when none of the URLs are in the crawl, or none were given", () => {
    expect(selectContextPagesByUrl([startPage, cartPage], ["https://shop.example.com/gone"])).toEqual([]);
    expect(selectContextPagesByUrl([startPage, cartPage], [])).toEqual([]);
    expect(selectContextPagesByUrl([], [startPage.url])).toEqual([]);
  });

  it(`cuts each snapshot longer than ${String(MAX_SNAPSHOT_CHARACTERS)} characters`, () => {
    const longSnapshot = `${"a".repeat(MAX_SNAPSHOT_CHARACTERS)}${"b".repeat(5_000)}`;
    const longCartPage = { ...cartPage, ariaSnapshot: longSnapshot };

    const [selectedPage] = selectContextPagesByUrl([longCartPage], [longCartPage.url]);

    expect(selectedPage.ariaSnapshot).toBe(capSnapshot(longSnapshot));
    expect(selectedPage.ariaSnapshot).toMatch(/# \[\.\.\. snapshot cut here: 5000 more characters not shown \.\.\.\]$/);
  });

  it(`picks at most ${String(MAX_CONTEXT_PAGES)} pages, the first ones listed`, () => {
    const manyPages = Array.from({ length: 10 }, (_unused, pageIndex) =>
      buildPage({ url: `https://shop.example.com/page-${String(pageIndex)}` }),
    );
    const pageUrls = manyPages.map(({ url }) => url);

    const selectedPages = selectContextPagesByUrl(manyPages, pageUrls);

    expect(selectedPages.map(({ url }) => url)).toEqual(pageUrls.slice(0, MAX_CONTEXT_PAGES));
  });

  it(`skips a page that would go over ${String(MAX_CONTEXT_CHARACTERS)} characters in total, keeping later ones that fit`, () => {
    const firstPage = buildPage({ url: "https://shop.example.com/a", ariaSnapshot: buildFillerSnapshot(20_000) });
    const secondPage = buildPage({ url: "https://shop.example.com/b", ariaSnapshot: buildFillerSnapshot(20_000) });
    const thirdPage = buildPage({ url: "https://shop.example.com/c", ariaSnapshot: buildFillerSnapshot(15_000) });
    const tooBigPage = buildPage({ url: "https://shop.example.com/too-big", ariaSnapshot: buildFillerSnapshot(6_000) });
    // Exactly fills the budget: 20k + 20k + 15k + 5k = 60k.
    const exactFitPage = buildPage({ url: "https://shop.example.com/fits", ariaSnapshot: buildFillerSnapshot(5_000) });
    const pages = [firstPage, secondPage, thirdPage, tooBigPage, exactFitPage];

    const selectedPages = selectContextPagesByUrl(
      pages,
      pages.map(({ url }) => url),
    );

    expect(selectedPages.map(({ url }) => url)).toEqual([
      "https://shop.example.com/a",
      "https://shop.example.com/b",
      "https://shop.example.com/c",
      "https://shop.example.com/fits",
    ]);
    const totalCharacters = selectedPages.reduce((total, page) => total + page.ariaSnapshot.length, 0);
    expect(totalCharacters).toBe(MAX_CONTEXT_CHARACTERS);
  });
});
