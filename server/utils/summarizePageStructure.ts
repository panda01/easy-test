/**
 * The longest structure skeleton kept, in characters. A longer one is cut at
 * the last whole line before it: the skeleton is stored on every crawled
 * page whose URL has enough siblings to be compared by structure, and the
 * top of a page (its header, navigation, and the start of its content)
 * already says which template it was built from.
 */
export const MAX_STRUCTURE_SKELETON_CHARACTERS = 20_000;

/** How many spaces one level of an aria snapshot (and of a skeleton) is indented by. */
const INDENT_PER_LEVEL = 2;

/** One node of an aria snapshot reduced to its role. */
interface StructureNode {
  /** The node's role, plus its heading level when it has one: `link`, `heading[level=2]`. */
  label: string;
  /** The nodes nested under it, in page order. */
  childNodes: StructureNode[];
}

/** One `- ...` line of an aria snapshot, as the skeleton needs it. */
interface SnapshotEntry {
  /** How deeply the line is nested: 0 at the top. */
  depth: number;
  /** The line's role label (see `StructureNode.label`). */
  label: string;
}

/**
 * Reads the role label of one aria snapshot entry - what follows its `- `:
 * the role, plus `[level=N]` for a heading (a page's h1 and h2 are different
 * structure). The accessible name, the text, and every other attribute
 * (`[checked]`, `[expanded]`, ...) are dropped: they change from one
 * instance of a page to the next. A quoted entry is a text node.
 * @param entryText - The entry without its indentation and `- `, e.g. `heading "Title" [level=1]`
 * @returns The label, or null for a property line such as `/url: /about`
 */
function readEntryLabel(entryText: string): string | null {
  const entryIsAProperty = entryText.startsWith("/");
  if (entryIsAProperty) return null;
  const entryIsQuotedText = entryText.startsWith('"') || entryText.startsWith("'");
  if (entryIsQuotedText) return "text";
  const roleMatch = /^([A-Za-z][\w-]*)/.exec(entryText);
  if (roleMatch === null) return null;
  const levelMatch = /\[level=(\d+)\]/.exec(entryText);
  const levelSuffix = levelMatch === null ? "" : `[level=${levelMatch[1]}]`;
  return `${roleMatch[1]}${levelSuffix}`;
}

/**
 * Reads the entries of a YAML aria snapshot, in order. Lines that are not
 * `- ...` entries (continuation lines of a long text) and property entries
 * (`- /url: ...`) are skipped.
 * @param ariaSnapshot - Playwright's YAML aria snapshot
 * @returns Each entry's depth and role label
 */
function readSnapshotEntries(ariaSnapshot: string): SnapshotEntry[] {
  const entries: SnapshotEntry[] = [];
  for (const line of ariaSnapshot.split("\n")) {
    const entryMatch = /^(\s*)- (.*)$/.exec(line);
    if (entryMatch === null) continue;
    const label = readEntryLabel(entryMatch[2]);
    if (label === null) continue;
    const depth = Math.floor(entryMatch[1].length / INDENT_PER_LEVEL);
    entries.push({ depth, label });
  }
  return entries;
}

/**
 * Builds the role tree of an aria snapshot: each entry under the nearest
 * entry above it that is less deeply nested.
 * @param entries - The snapshot's entries, in order
 * @returns The top-level nodes
 */
function buildStructureTree(entries: SnapshotEntry[]): StructureNode[] {
  const rootNodes: StructureNode[] = [];
  const openNodes: { depth: number; node: StructureNode }[] = [];
  for (const entry of entries) {
    let innermostOpenNode = openNodes.at(-1);
    while (innermostOpenNode !== undefined && innermostOpenNode.depth >= entry.depth) {
      openNodes.pop();
      innermostOpenNode = openNodes.at(-1);
    }
    const node: StructureNode = { label: entry.label, childNodes: [] };
    if (innermostOpenNode === undefined) {
      rootNodes.push(node);
    } else {
      innermostOpenNode.node.childNodes.push(node);
    }
    openNodes.push({ depth: entry.depth, node });
  }
  return rootNodes;
}

/**
 * Writes nodes as indented skeleton lines, each node followed by the nodes
 * under it - leaving out every node whose whole subtree is the same as the
 * sibling just before it, so a list of 3 items and a list of 30 items (or 2
 * paragraphs and 9) come out the same.
 * @param nodes - The sibling nodes to write
 * @param depth - Their depth: 0 at the top
 * @returns The lines, indented `INDENT_PER_LEVEL` spaces per level
 */
function renderCollapsedNodes(nodes: StructureNode[], depth: number): string[] {
  const lines: string[] = [];
  let previousSiblingText: string | null = null;
  for (const node of nodes) {
    const indent = " ".repeat(depth * INDENT_PER_LEVEL);
    const nodeLines = [`${indent}${node.label}`, ...renderCollapsedNodes(node.childNodes, depth + 1)];
    const nodeText = nodeLines.join("\n");
    const nodeRepeatsThePreviousSibling = nodeText === previousSiblingText;
    if (nodeRepeatsThePreviousSibling) continue;
    lines.push(...nodeLines);
    previousSiblingText = nodeText;
  }
  return lines;
}

/**
 * Cuts a skeleton longer than `MAX_STRUCTURE_SKELETON_CHARACTERS` at the
 * last whole line that fits.
 * @param lines - The skeleton's lines
 * @returns The skeleton text, at most `MAX_STRUCTURE_SKELETON_CHARACTERS` long
 */
function joinWithinTheCap(lines: string[]): string {
  const keptLines: string[] = [];
  let keptLength = 0;
  for (const line of lines) {
    const lengthWithThisLine = keptLength + line.length + (keptLines.length > 0 ? 1 : 0);
    const lineWouldGoOverTheCap = lengthWithThisLine > MAX_STRUCTURE_SKELETON_CHARACTERS;
    if (lineWouldGoOverTheCap) break;
    keptLines.push(line);
    keptLength = lengthWithThisLine;
  }
  return keptLines.join("\n");
}

/**
 * Reduces a page's aria snapshot to its STRUCTURE: the tree of roles, with
 * every text, accessible name, and attribute except a heading's level
 * dropped, and repeated sibling subtrees collapsed into one (see
 * `renderCollapsedNodes`). Two pages built from the same template - two blog
 * posts, two product pages - come out (nearly) the same; a settings form and
 * a billing table do not.
 *
 * The skeleton has one role per line, indented two spaces per level:
 * ```
 * banner
 *   link
 * main
 *   heading[level=1]
 *   list
 *     listitem
 *       link
 * ```
 * @param ariaSnapshot - Playwright's YAML aria snapshot of the page's `<body>`
 * @returns The skeleton, at most `MAX_STRUCTURE_SKELETON_CHARACTERS` long; empty when the snapshot has no entries
 */
export function summarizePageStructure(ariaSnapshot: string): string {
  const structureTree = buildStructureTree(readSnapshotEntries(ariaSnapshot));
  return joinWithinTheCap(renderCollapsedNodes(structureTree, 0));
}

/**
 * Lists the distinct role paths of a skeleton: each line's role preceded by
 * the roles it is nested in, e.g. `main>list>listitem>link`.
 * @param structureSkeleton - A skeleton from `summarizePageStructure`
 * @returns The skeleton's role paths
 */
function listRolePaths(structureSkeleton: string): Set<string> {
  const rolePaths = new Set<string>();
  const ancestorLabels: string[] = [];
  for (const line of structureSkeleton.split("\n")) {
    const label = line.trim();
    if (label === "") continue;
    const depth = Math.floor((line.length - line.trimStart().length) / INDENT_PER_LEVEL);
    ancestorLabels.length = Math.min(ancestorLabels.length, depth);
    ancestorLabels.push(label);
    rolePaths.add(ancestorLabels.join(">"));
  }
  return rolePaths;
}

/**
 * Measures how alike two pages' structures are: the Jaccard similarity of
 * their role paths (see `listRolePaths`) - the paths both have, over the
 * paths either has.
 * @param firstSkeleton - One page's skeleton
 * @param secondSkeleton - The other page's skeleton
 * @returns From 0 (nothing in common) to 1 (the same paths); 1 when both are empty
 */
export function compareStructureSkeletons(firstSkeleton: string, secondSkeleton: string): number {
  const firstRolePaths = listRolePaths(firstSkeleton);
  const secondRolePaths = listRolePaths(secondSkeleton);
  const sharedPathCount = [...firstRolePaths].filter((rolePath) => secondRolePaths.has(rolePath)).length;
  const combinedPathCount = firstRolePaths.size + secondRolePaths.size - sharedPathCount;
  const bothSkeletonsAreEmpty = combinedPathCount === 0;
  if (bothSkeletonsAreEmpty) return 1;
  return sharedPathCount / combinedPathCount;
}
