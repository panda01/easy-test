import type { CrawledPageSnapshot } from "../services/dbService.js";

/** The most pages Claude is shown for one conversion. */
export const MAX_CONTEXT_PAGES = 6;

/** The most aria snapshot characters Claude is shown in total (roughly 15k tokens). */
export const MAX_CONTEXT_CHARACTERS = 60_000;

/** The longest one page's snapshot may be before it is cut. */
export const MAX_SNAPSHOT_CHARACTERS = 20_000;

/** How many of the action's most repeated words and phrases are searched for. */
const MAX_SEARCH_TERMS = 12;

/** How many times one term counts per page at most, so one huge page cannot win on a single word. */
const MAX_MATCHES_PER_TERM = 5;

/** A match in a page's URL path or title says more about the page than one deep in its content. */
const URL_AND_TITLE_MATCH_WEIGHT = 3;

/**
 * Words too common to say anything about which page an action uses: articles,
 * pronouns, helper verbs, and the filler action descriptions are written in.
 */
const STOP_WORDS: ReadonlySet<string> = new Set([
  "a", "about", "after", "all", "also", "an", "and", "any", "are", "as", "at", "be",
  "been", "before", "but", "by", "can", "could", "did", "do", "does", "each", "for",
  "from", "has", "have", "he", "her", "his", "how", "i", "if", "in", "into", "is",
  "it", "its", "just", "make", "makes", "may", "me", "must", "my", "no", "not", "now",
  "of", "on", "once", "one", "only", "or", "other", "our", "out", "over", "own",
  "same", "see", "she", "should", "so", "some", "such", "than", "that", "the",
  "their", "them", "then", "there", "these", "they", "this", "those", "through",
  "to", "too", "under", "until", "up", "use", "user", "users", "using", "very",
  "was", "we", "were", "what", "when", "where", "which", "while", "who", "will",
  "with", "would", "you", "your",
]);

/** One word or two-word phrase from the action, and how often the action repeats it. */
export interface ActionSearchTerm {
  /** Lowercase word, or two words joined by one space. */
  term: string;
  /** How many times the action's title and description use it. */
  count: number;
}

/** One page chosen for Claude, with its snapshot possibly cut to size. */
export interface SelectedContextPage {
  /** The page's identity (origin + path). */
  url: string;
  /** The page's `<title>`, or null. */
  title: string | null;
  /** The aria snapshot, cut at `MAX_SNAPSHOT_CHARACTERS` with a visible marker when longer. */
  ariaSnapshot: string;
}

/**
 * Splits text into lowercase words, keeping letters and digits only.
 * @param text - Any text
 * @returns The words, in order
 */
function splitIntoWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "");
}

/**
 * Checks whether a word can help find a page: not a stop word, and at least
 * three characters long (so "go", "id", or "a1" do not match everywhere).
 * @param word - A lowercase word
 * @returns True when the word is worth searching for
 */
function wordIsMeaningful(word: string): boolean {
  const wordIsLongEnough = word.length >= 3;
  const wordIsAStopWord = STOP_WORDS.has(word);
  return wordIsLongEnough && !wordIsAStopWord;
}

/**
 * Finds the words and two-word phrases an action talks about most: the
 * title and description are split into words, stop words are dropped, and
 * every remaining word - and every pair of meaningful words that stand next
 * to each other - is counted. The most repeated come first; ties go to the
 * longer term, which is more specific.
 * @param actionTitle - The action's title
 * @param actionDescription - The action's description
 * @returns Up to `MAX_SEARCH_TERMS` terms with their counts, most repeated first
 */
export function extractActionSearchTerms(
  actionTitle: string,
  actionDescription: string,
): ActionSearchTerm[] {
  const termCounts = new Map<string, number>();
  /**
   * Adds one use of a term to the tally.
   * @param term - A word or two-word phrase
   */
  const countTerm = (term: string): void => {
    termCounts.set(term, (termCounts.get(term) ?? 0) + 1);
  };

  for (const text of [actionTitle, actionDescription]) {
    const words = splitIntoWords(text);
    words.forEach((word, wordIndex) => {
      if (!wordIsMeaningful(word)) return;
      countTerm(word);
      const wordIsTheLast = wordIndex === words.length - 1;
      if (wordIsTheLast) return;
      const nextWord = words[wordIndex + 1];
      if (wordIsMeaningful(nextWord)) {
        countTerm(`${word} ${nextWord}`);
      }
    });
  }

  return [...termCounts.entries()]
    .map(([term, count]) => ({ term, count }))
    .sort((first, second) => second.count - first.count || second.term.length - first.term.length)
    .slice(0, MAX_SEARCH_TERMS);
}

/**
 * Counts how often a term appears in a text, case-insensitively, up to a cap.
 * @param haystack - Lowercase text to search
 * @param term - Lowercase term
 * @param cap - The most matches worth counting
 * @returns The number of matches, at most `cap`
 */
function countMatches(haystack: string, term: string, cap: number): number {
  let matchCount = 0;
  let searchFrom = haystack.indexOf(term);
  while (searchFrom !== -1 && matchCount < cap) {
    matchCount += 1;
    searchFrom = haystack.indexOf(term, searchFrom + term.length);
  }
  return matchCount;
}

/**
 * Scores how much a page has to do with an action: each term found in the
 * page's URL path or title counts `URL_AND_TITLE_MATCH_WEIGHT` times, each
 * found in its aria snapshot once (capped per term), and every match is
 * worth as much as the action repeats the term.
 * @param page - The crawled page
 * @param searchTerms - From `extractActionSearchTerms`
 * @returns The page's score; 0 when no term appears on it
 */
export function scoreCrawledPage(page: CrawledPageSnapshot, searchTerms: ActionSearchTerm[]): number {
  const pathAndTitle = `${new URL(page.url).pathname} ${page.title ?? ""}`.toLowerCase();
  // URLs separate words with "-", "_" and "/", so compare word by word there.
  const pathAndTitleWords = splitIntoWords(pathAndTitle).join(" ");
  const snapshot = page.ariaSnapshot.toLowerCase();

  let score = 0;
  for (const { term, count } of searchTerms) {
    const pathAndTitleMatches = countMatches(pathAndTitleWords, term, MAX_MATCHES_PER_TERM);
    const snapshotMatches = countMatches(snapshot, term, MAX_MATCHES_PER_TERM);
    score += count * (pathAndTitleMatches * URL_AND_TITLE_MATCH_WEIGHT + snapshotMatches);
  }
  return score;
}

/**
 * Cuts a snapshot that is longer than `MAX_SNAPSHOT_CHARACTERS`, saying so
 * at the cut, so Claude knows the rest of the page exists. Also used by the
 * plan runner to cap the failing page's snapshot before it is stored.
 * @param ariaSnapshot - The full snapshot
 * @returns The snapshot, or its start plus a marker
 */
export function capSnapshot(ariaSnapshot: string): string {
  const snapshotIsTooLong = ariaSnapshot.length > MAX_SNAPSHOT_CHARACTERS;
  if (!snapshotIsTooLong) return ariaSnapshot;
  const droppedCharacterCount = ariaSnapshot.length - MAX_SNAPSHOT_CHARACTERS;
  return `${ariaSnapshot.slice(0, MAX_SNAPSHOT_CHARACTERS)}\n# [... snapshot cut here: ${droppedCharacterCount} more characters not shown ...]`;
}

/**
 * Picks the crawled pages Claude should see for one action:
 * 1. The start page (depth 0) always comes first - every plan starts there.
 * 2. Then the pages that mention the action's words most (`scoreCrawledPage`);
 *    pages that mention none of them are left out.
 * 3. At most `MAX_CONTEXT_PAGES` pages and `MAX_CONTEXT_CHARACTERS` snapshot
 *    characters in total; a page that would go over the total is skipped in
 *    favour of smaller, lower-scored ones.
 * @param pages - The crawl's pages (from `findLatestCrawledPagesForWebsite`)
 * @param searchTerms - From `extractActionSearchTerms`
 * @returns The chosen pages, start page first, then best score first
 */
export function selectRelevantCrawledPages(
  pages: CrawledPageSnapshot[],
  searchTerms: ActionSearchTerm[],
): SelectedContextPage[] {
  const startPages = pages.filter((page) => page.depth === 0);
  const scoredPages = pages
    .filter((page) => page.depth !== 0)
    .map((page) => ({ page, score: scoreCrawledPage(page, searchTerms) }))
    .filter(({ score }) => score > 0)
    .sort((first, second) => second.score - first.score);
  const candidatePages = [...startPages, ...scoredPages.map(({ page }) => page)];
  return fitPagesIntoContextBudget(candidatePages);
}

/**
 * Picks the crawled pages a refinement re-sends: the pages its source version
 * was shown (`contextPageUrls`), taken from the latest crawl, in the order
 * that version listed them. URLs the latest crawl no longer has are skipped.
 * The same caps as `selectRelevantCrawledPages` apply.
 * @param pages - The crawl's pages (from `findLatestCrawledPagesForWebsite`)
 * @param pageUrls - The URLs to pick, in the order to show them
 * @returns The found pages, in `pageUrls` order; empty when none were found
 */
export function selectContextPagesByUrl(
  pages: CrawledPageSnapshot[],
  pageUrls: string[],
): SelectedContextPage[] {
  const pagesByUrl = new Map(pages.map((page) => [page.url, page]));
  const foundPages = pageUrls.flatMap((pageUrl) => {
    const foundPage = pagesByUrl.get(pageUrl);
    return foundPage === undefined ? [] : [foundPage];
  });
  return fitPagesIntoContextBudget(foundPages);
}

/**
 * Keeps candidate pages, in order, while they fit: at most `MAX_CONTEXT_PAGES`
 * pages and `MAX_CONTEXT_CHARACTERS` snapshot characters in total. Each
 * snapshot is cut with `capSnapshot` first; a page that would go over the
 * total is skipped in favour of later, smaller ones.
 * @param candidatePages - The pages to choose from, best first
 * @returns The pages that fit, each with its (possibly cut) snapshot
 */
function fitPagesIntoContextBudget(candidatePages: CrawledPageSnapshot[]): SelectedContextPage[] {
  const selectedPages: SelectedContextPage[] = [];
  let totalCharacters = 0;
  for (const page of candidatePages) {
    const enoughPagesWereChosen = selectedPages.length >= MAX_CONTEXT_PAGES;
    if (enoughPagesWereChosen) break;
    const ariaSnapshot = capSnapshot(page.ariaSnapshot);
    const pageWouldGoOverTheTotal = totalCharacters + ariaSnapshot.length > MAX_CONTEXT_CHARACTERS;
    if (pageWouldGoOverTheTotal) continue;
    selectedPages.push({ url: page.url, title: page.title, ariaSnapshot });
    totalCharacters += ariaSnapshot.length;
  }
  return selectedPages;
}
