import { describe, it, expect } from "vitest";
import { buildCrawlSiteTree, flattenCrawlSiteTree } from "../../src/utils/buildCrawlSiteTree";

/**
 * Builds a minimal page for the tree.
 * @param id - The page's id
 * @param parentPageId - Its parent's id, or null for a root
 * @returns The page
 */
function buildTreePage(id: string, parentPageId: string | null): { id: string; parentPageId: string | null } {
  return { id, parentPageId };
}

describe("buildCrawlSiteTree", () => {
  it("puts each page under its parent, keeping visiting order at every level", () => {
    const home = buildTreePage("home", null);
    const about = buildTreePage("about", "home");
    const blog = buildTreePage("blog", "home");
    const team = buildTreePage("team", "about");
    const post = buildTreePage("post", "blog");

    const tree = buildCrawlSiteTree([home, about, blog, team, post]);

    expect(tree).toEqual([
      {
        page: home,
        childNodes: [
          { page: about, childNodes: [{ page: team, childNodes: [] }] },
          { page: blog, childNodes: [{ page: post, childNodes: [] }] },
        ],
      },
    ]);
  });

  it("treats a page whose parent is not in the list as a root, so it is never hidden", () => {
    const home = buildTreePage("home", null);
    const orphan = buildTreePage("orphan", "missing-page");

    const tree = buildCrawlSiteTree([home, orphan]);

    expect(tree.map((node) => node.page.id)).toEqual(["home", "orphan"]);
  });

  it("treats a page that names itself as its parent as a root", () => {
    const selfParented = buildTreePage("loop", "loop");

    expect(buildCrawlSiteTree([selfParented])).toEqual([{ page: selfParented, childNodes: [] }]);
  });

  it("returns no roots for no pages", () => {
    expect(buildCrawlSiteTree([])).toEqual([]);
  });
});

describe("flattenCrawlSiteTree", () => {
  it("lists each page followed by the pages under it, with their depth", () => {
    const tree = buildCrawlSiteTree([
      buildTreePage("home", null),
      buildTreePage("about", "home"),
      buildTreePage("blog", "home"),
      buildTreePage("team", "about"),
      buildTreePage("post", "blog"),
    ]);

    const rows = flattenCrawlSiteTree(tree);

    expect(rows.map((row) => [row.page.id, row.treeDepth])).toEqual([
      ["home", 0],
      ["about", 1],
      ["team", 2],
      ["blog", 1],
      ["post", 2],
    ]);
  });
});
