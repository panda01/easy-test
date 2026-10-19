import { describe, it, expect } from "vitest";
import {
  MAX_PAGES_PER_PATTERN,
  claimPatternSlot,
  createCrawlPatternSampler,
  dropOverSampledQueueEntries,
  recordVisitedPatternPage,
  summarizeSkippedLinks,
} from "../../../server/utils/crawlPatternSampling.js";

const ORIGIN = "https://example.com";
const POST_SKELETON = "main\n  heading[level=1]\n  paragraph";

/**
 * Builds the aria snapshot of a blog post: its title, then one paragraph.
 * @param slug - The post's slug, used as its text
 * @returns A YAML aria snapshot
 */
function postSnapshot(slug: string): string {
  return `- heading "${slug}" [level=1]\n- paragraph: ${slug}`;
}

/** What `summarizePageStructure` makes of a `postSnapshot`. */
const POST_SNAPSHOT_SKELETON = "heading[level=1]\nparagraph";

/**
 * Builds the identity of the n-th product page.
 * @param productNumber - The product's id
 * @returns `https://example.com/products/<productNumber>`
 */
function productUrl(productNumber: number): string {
  return `${ORIGIN}/products/${String(productNumber)}`;
}

describe("crawl pattern sampling", () => {
  it(`allows ${String(MAX_PAGES_PER_PATTERN)} links of one pattern, then skips and counts the rest`, () => {
    const sampler = createCrawlPatternSampler();

    const claims = [1, 2, 3, 4, 5].map((productNumber) => claimPatternSlot(sampler, productUrl(productNumber)));

    expect(MAX_PAGES_PER_PATTERN).toBe(3);
    expect(claims).toEqual([true, true, true, false, false]);
    expect(summarizeSkippedLinks(sampler)).toEqual({
      skippedSimilarUrlCount: 2,
      skippedSimilarUrlCountsByPattern: { "/products/{product}": 2 },
    });
  });

  it("counts each pattern on its own, and never limits a link without a variable segment", () => {
    const sampler = createCrawlPatternSampler();
    for (const productNumber of [1, 2, 3]) {
      claimPatternSlot(sampler, productUrl(productNumber));
    }

    expect(claimPatternSlot(sampler, `${ORIGIN}/products/1/reviews`)).toBe(true);
    expect(claimPatternSlot(sampler, `${ORIGIN}/orders/77`)).toBe(true);
    expect(["/about", "/pricing", "/contact", "/careers"].map((path) => claimPatternSlot(sampler, `${ORIGIN}${path}`))).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(summarizeSkippedLinks(sampler).skippedSimilarUrlCount).toBe(0);
  });

  it("confirms a slug pattern from 3 visited sibling pages built alike, and reports only a change", () => {
    const sampler = createCrawlPatternSampler();
    const visitPost = (slug: string): boolean =>
      recordVisitedPatternPage(
        sampler,
        { id: slug, url: `${ORIGIN}/blog/${slug}`, title: null, structureSkeleton: POST_SKELETON },
        null,
      ).slugPatternsChanged;

    expect(visitPost("a")).toBe(false);
    expect(visitPost("b")).toBe(false);
    expect(visitPost("c")).toBe(true);
    expect(visitPost("d")).toBe(false);
    expect(sampler.confirmedSlugPatterns).toHaveLength(1);
    expect(claimPatternSlot(sampler, `${ORIGIN}/blog/e`)).toBe(true);
  });

  it("builds no skeleton until a page's URL has enough siblings, then builds each sibling's once and drops its snapshot", () => {
    const sampler = createCrawlPatternSampler();
    const visitPage = (id: string, path: string): ReturnType<typeof recordVisitedPatternPage> =>
      recordVisitedPatternPage(
        sampler,
        { id, url: `${ORIGIN}${path}`, title: null, structureSkeleton: null },
        postSnapshot(id),
      );

    expect(visitPage("about", "/about")).toEqual({ slugPatternsChanged: false, newStructureSkeletons: [] });
    expect(visitPage("a", "/blog/a").newStructureSkeletons).toEqual([]);
    expect(visitPage("b", "/blog/b").newStructureSkeletons).toEqual([]);
    expect(visitPage("c", "/blog/c")).toEqual({
      slugPatternsChanged: true,
      newStructureSkeletons: ["a", "b", "c"].map((crawledPageId) => ({
        crawledPageId,
        structureSkeleton: POST_SNAPSHOT_SKELETON,
      })),
    });
    expect(visitPage("d", "/blog/d")).toEqual({
      slugPatternsChanged: false,
      newStructureSkeletons: [{ crawledPageId: "d", structureSkeleton: POST_SNAPSHOT_SKELETON }],
    });
    expect([...sampler.ariaSnapshotsAwaitingSkeleton.keys()]).toEqual(["about"]);
    expect(sampler.visitedPages.map((visitedPage) => visitedPage.structureSkeleton)).toEqual([
      null,
      POST_SNAPSHOT_SKELETON,
      POST_SNAPSHOT_SKELETON,
      POST_SNAPSHOT_SKELETON,
      POST_SNAPSHOT_SKELETON,
    ]);
  });

  it("builds no skeleton for a sibling page without an aria snapshot, so it is never compared", () => {
    const sampler = createCrawlPatternSampler();
    for (const slug of ["a", "b"]) {
      recordVisitedPatternPage(
        sampler,
        { id: slug, url: `${ORIGIN}/blog/${slug}`, title: null, structureSkeleton: null },
        postSnapshot(slug),
      );
    }

    const outcome = recordVisitedPatternPage(
      sampler,
      { id: "c", url: `${ORIGIN}/blog/c`, title: null, structureSkeleton: null },
      null,
    );

    expect(outcome).toEqual({
      slugPatternsChanged: false,
      newStructureSkeletons: ["a", "b"].map((crawledPageId) => ({
        crawledPageId,
        structureSkeleton: POST_SNAPSHOT_SKELETON,
      })),
    });
    expect(sampler.ariaSnapshotsAwaitingSkeleton.size).toBe(0);
    expect(sampler.confirmedSlugPatterns).toEqual([]);
  });

  it("re-counts after new slug patterns and drops the queued links a pattern now has too many of", () => {
    const sampler = createCrawlPatternSampler();
    const visitedUrls = ["a", "b", "c"].map((slug) => `${ORIGIN}/blog/${slug}`);
    const queue = ["d", "e", "f"].map((slug) => ({ identityUrl: `${ORIGIN}/blog/${slug}`, depth: 1 }));
    const otherQueuedLink = { identityUrl: `${ORIGIN}/about`, depth: 1 };
    for (const [visitIndex, visitedUrl] of visitedUrls.entries()) {
      recordVisitedPatternPage(
        sampler,
        { id: `post-${String(visitIndex)}`, url: visitedUrl, title: null, structureSkeleton: POST_SKELETON },
        null,
      );
    }

    const keptQueue = dropOverSampledQueueEntries(sampler, visitedUrls, [...queue, otherQueuedLink]);

    expect(keptQueue).toEqual([otherQueuedLink]);
    expect(summarizeSkippedLinks(sampler)).toEqual({
      skippedSimilarUrlCount: 3,
      skippedSimilarUrlCountsByPattern: { "/blog/{blog}": 3 },
    });
    expect(sampler.pageCountByPatternKey.get("/blog/{blog}")).toBe(3);
  });

  it("keeps earlier skips when re-counting, and keeps queued links a pattern still has room for", () => {
    const sampler = createCrawlPatternSampler();
    for (const productNumber of [1, 2, 3, 4]) {
      claimPatternSlot(sampler, productUrl(productNumber));
    }

    const keptQueue = dropOverSampledQueueEntries(sampler, [productUrl(1)], [
      { identityUrl: productUrl(2) },
      { identityUrl: productUrl(3) },
      { identityUrl: productUrl(5) },
    ]);

    expect(keptQueue).toEqual([{ identityUrl: productUrl(2) }, { identityUrl: productUrl(3) }]);
    expect(summarizeSkippedLinks(sampler).skippedSimilarUrlCountsByPattern).toEqual({ "/products/{product}": 2 });
  });

  it("starts empty", () => {
    expect(summarizeSkippedLinks(createCrawlPatternSampler())).toEqual({
      skippedSimilarUrlCount: 0,
      skippedSimilarUrlCountsByPattern: {},
    });
  });
});
