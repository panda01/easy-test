/** The parts of a crawled page the tree is built from. */
export interface CrawlSiteTreePage {
  id: string;
  /** The page whose link led here; null for the start page. */
  parentPageId: string | null;
}

/** One page in the site map tree, with the pages first found on it. */
export interface CrawlSiteTreeNode<TPage extends CrawlSiteTreePage> {
  page: TPage;
  childNodes: CrawlSiteTreeNode<TPage>[];
}

/** One row of the site map when the tree is drawn as an indented list. */
export interface CrawlSiteTreeRow<TPage extends CrawlSiteTreePage> {
  page: TPage;
  /** How deep the row sits in the tree: 0 for a root. */
  treeDepth: number;
}

/**
 * Builds the site map tree from a crawl's pages: each page sits under the
 * page whose link first led to it (`parentPageId`).
 *
 * The start page (no parent) is a root. A page whose parent is not in the
 * list is treated as a root too, so a missing row can never hide part of the
 * tree. Roots and children keep the order the pages came in (visiting order).
 * @param pages - The crawl's pages, in visiting order
 * @returns The root nodes
 */
export function buildCrawlSiteTree<TPage extends CrawlSiteTreePage>(
  pages: TPage[],
): CrawlSiteTreeNode<TPage>[] {
  const nodesByPageId = new Map<string, CrawlSiteTreeNode<TPage>>();
  for (const page of pages) {
    nodesByPageId.set(page.id, { page, childNodes: [] });
  }

  // A Map iterates in insertion order, so this walks the pages in the order
  // they came in.
  const rootNodes: CrawlSiteTreeNode<TPage>[] = [];
  for (const node of nodesByPageId.values()) {
    const { parentPageId } = node.page;
    const parentNode = parentPageId === null ? undefined : nodesByPageId.get(parentPageId);
    const pageHasNoKnownParent = parentNode === undefined || parentNode === node;
    if (pageHasNoKnownParent) {
      rootNodes.push(node);
    } else {
      parentNode.childNodes.push(node);
    }
  }
  return rootNodes;
}

/**
 * Appends one level of the tree to `rows`, each node followed by the nodes
 * under it.
 * @param nodes - The nodes at this level
 * @param treeDepth - Their depth: 0 for the roots
 * @param rows - The rows built so far, appended to in place
 */
function appendTreeRows<TPage extends CrawlSiteTreePage>(
  nodes: CrawlSiteTreeNode<TPage>[],
  treeDepth: number,
  rows: CrawlSiteTreeRow<TPage>[],
): void {
  for (const node of nodes) {
    rows.push({ page: node.page, treeDepth });
    appendTreeRows(node.childNodes, treeDepth + 1, rows);
  }
}

/**
 * Flattens the tree into rows in reading order (each page, then the pages
 * under it), with each row's depth, so it can be drawn as one indented list.
 * @param rootNodes - The tree's root nodes
 * @returns The rows, parents before their children
 */
export function flattenCrawlSiteTree<TPage extends CrawlSiteTreePage>(
  rootNodes: CrawlSiteTreeNode<TPage>[],
): CrawlSiteTreeRow<TPage>[] {
  const rows: CrawlSiteTreeRow<TPage>[] = [];
  appendTreeRows(rootNodes, 0, rows);
  return rows;
}
