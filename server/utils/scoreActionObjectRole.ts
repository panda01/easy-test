import { urlMatchesPatternKey } from "./detectPagePatterns.js";

/**
 * The four kinds that act on an object, in the order the form lists them:
 * - `create`: it makes a new object, which each run records;
 * - `read`: it opens or checks an existing object (or nothing in particular);
 * - `update`: it changes an existing object;
 * - `delete`: it deletes an existing object, which a passed run marks as
 *   deleted on the site.
 */
export const CRUD_ACTION_KINDS = ["create", "read", "update", "delete"] as const;

/** One of the four object kinds (see `CRUD_ACTION_KINDS`). */
export type CrudActionKind = (typeof CRUD_ACTION_KINDS)[number];

/**
 * What an action does with an object - the action's "switch":
 * - `parameters`: the special kind for login-style actions that only take
 *   typed values and touch no object;
 * - the four object kinds of `CRUD_ACTION_KINDS`.
 */
export const ACTION_KINDS = ["parameters", ...CRUD_ACTION_KINDS] as const;

/** One action kind (see `ACTION_KINDS`). */
export type ActionKind = (typeof ACTION_KINDS)[number];

/** How sure a detection is: the winner's share of the score. */
export type DetectionConfidence = "high" | "medium" | "low";

/** A winner's share of the score from which a detection counts as High. */
export const HIGH_CONFIDENCE_SHARE = 0.75;

/** A winner's share of the score from which a detection counts as Medium. */
export const MEDIUM_CONFIDENCE_SHARE = 0.5;

/** Words that mean the action makes a NEW object. */
export const CREATE_WORDS = [
  "create",
  "add",
  "new",
  "make",
  "register",
  "sign up",
  "invite",
  "build",
  "post",
  "submit",
] as const;

/** Words that mean the action opens or checks an EXISTING object without changing it. */
export const READ_WORDS = [
  "open",
  "view",
  "show",
  "visit",
  "go to",
  "select",
  "find",
  "search",
  "list",
  "check",
  "review",
  "browse",
  "filter",
  "export",
  "download",
] as const;

/** Words that mean the action CHANGES an existing object. */
export const UPDATE_WORDS = [
  "edit",
  "update",
  "change",
  "rename",
  "modify",
  "assign",
  "move",
  "set",
  "toggle",
  "enable",
  "disable",
] as const;

/** Words that mean the action DELETES an existing object. */
export const DELETE_WORDS = ["delete", "remove", "destroy", "archive"] as const;

/** Each object kind's word list, in `CRUD_ACTION_KINDS` order. */
const KIND_WORD_LISTS: Record<CrudActionKind, readonly string[]> = {
  create: CREATE_WORDS,
  read: READ_WORDS,
  update: UPDATE_WORDS,
  delete: DELETE_WORDS,
};

/** How much an exact word counts. */
const EXACT_MATCH_WEIGHT = 1;

/** How much a word with the same stem (`creates` for `create`) counts. */
const STEM_MATCH_WEIGHT = 0.9;

/** How much a word one typo away (`craete` for `create`) counts. */
const TYPO_MATCH_WEIGHT = 0.6;

/** Typos are only forgiven in words at least this long, so short words cannot match each other by accident. */
const MIN_TYPO_WORD_LENGTH = 5;

/** A word in the title counts this many times as much as one in the description. */
const TITLE_WORD_WEIGHT = 2;

/** A word in the description counts this much. */
const DESCRIPTION_WORD_WEIGHT = 1;

/** How much it counts toward an object type that a version's start URL or `goto` opens one of its pages. */
const OBJECT_TYPE_ADDRESS_WEIGHT = 2;

/** Endings dropped to find a word's stem, longest first. */
const STEM_SUFFIXES = ["ions", "ion", "ing", "ed", "es", "s"] as const;

/** Words that never decide anything. */
const STOP_WORDS: ReadonlySet<string> = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "to",
  "for",
  "in",
  "on",
  "at",
  "by",
  "with",
  "from",
  "into",
  "it",
  "its",
  "is",
  "are",
  "be",
  "as",
  "that",
  "this",
  "then",
  "so",
  "can",
  "should",
  "will",
  "you",
  "your",
  "i",
  "we",
  "they",
  "user",
  "users",
]);

/** One word of the title or description that matched a word list. */
export interface WordMatch {
  /** The word as written (lower case), or the two-word phrase. */
  word: string;
  /** The list word it matched. */
  listWord: string;
  /** How much the match counts, before the title / description weight. */
  weight: number;
  /** True when it is in the title. */
  isInTitle: boolean;
}

/** How the action kind was detected from the title and description. */
export interface ActionKindDetection {
  /** The detected kind: the object kind whose words won, otherwise `parameters`. */
  kind: ActionKind;
  /** How the result came about: one kind won, the top kinds tied, or nothing matched. */
  reason: "won" | "tie" | "noMatch";
  /** How sure it is (`low` for a tie or no match). */
  confidence: DetectionConfidence;
  /** The winner's share of the total score, from 0 to 1 (0 when nothing matched). */
  confidenceShare: number;
  /** Each object kind's score. */
  scores: Record<CrudActionKind, number>;
  /** The words that decided it (the winner's; the tied kinds' for a tie). */
  evidence: string[];
}

/** One web object an action could work on, as the object type detection reads it. */
export interface ObjectTypeCandidate {
  /** Its `instancePatternKey` - the object type's key. */
  objectTypeKey: string;
  /** The name to show: the user's rename, or the detected name (e.g. `Project`, `Crawl run`). */
  name: string;
  /** The pattern keys of its own page and its create page, which a version's addresses are compared with. */
  addressPatternKeys: string[];
}

/** The object type detection's result. */
export interface ObjectTypeDetection {
  /** The winning type's key. */
  objectTypeKey: string;
  /** Its name. */
  objectTypeName: string;
  /** How sure it is. */
  confidence: DetectionConfidence;
  /** The winner's share of the score, from 0 to 1. */
  confidenceShare: number;
  /** What decided it: the words that named it, and `address` when a version opens one of its pages. */
  evidence: string[];
}

/** An action's choices as `resolveActionObjectRole` reads them: its text, and the user's settings (null for "detect"). */
export interface ActionRoleInput {
  /** The action's title. */
  title: string;
  /** The action's description. */
  description: string;
  /** The user's kind, or null to detect it. */
  userActionKind: string | null;
  /** The user's object type key, or null to detect it. */
  userObjectTypeKey: string | null;
}

/** What an action does with an object, after the user's choices and detection are combined. */
export interface ResolvedActionRole {
  /** The kind the action runs as. */
  kind: ActionKind;
  /** `you` when the user chose it, `detected` otherwise. */
  kindSource: "you" | "detected";
  /** The detection, always included so the form can show what "Detect" would pick. */
  detectedKind: ActionKindDetection;
  /** The object type the action works on, or null (always null for a `parameters` action). */
  objectTypeKey: string | null;
  /** That type's name, or null when it is unknown (none, or a chosen type a later crawl no longer found). */
  objectTypeName: string | null;
  /** `you`, `detected`, or null when there is no type. */
  objectTypeSource: "you" | "detected" | null;
  /** The type detection, or null when no type's name or address matched. */
  detectedObjectType: ObjectTypeDetection | null;
  /** Things the user should check, in plain words. */
  warnings: string[];
}

/**
 * Splits text into lower case words (letters and digits only).
 * @param text - Any text
 * @returns Its words, in order
 */
export function splitIntoWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "");
}

/**
 * Finds a word's stem, so `creates`, `created`, `creating`, and `creation`
 * all match `create`: the first of `STEM_SUFFIXES` it ends with is dropped
 * (when 3 letters remain), then a final `e`, then a final `i` becomes `y`
 * (`modifies` → `modify`), and a doubled last letter is undoubled
 * (`submitted` → `submit`). Both sides of a comparison are stemmed the same
 * way, so the stems need not be real words.
 * @param word - A lower case word
 * @returns Its stem
 */
export function stemWord(word: string): string {
  const droppedSuffix = STEM_SUFFIXES.find(
    (suffix) => word.endsWith(suffix) && word.length - suffix.length >= 3,
  );
  let stem = droppedSuffix === undefined ? word : word.slice(0, -droppedSuffix.length);
  if (stem.length > 3 && stem.endsWith("e")) stem = stem.slice(0, -1);
  if (stem.length > 3 && stem.endsWith("i")) stem = `${stem.slice(0, -1)}y`;
  const lastLetterIsDoubled = stem.length > 3 && stem.at(-1) === stem.at(-2) && /[^aeiou]/.test(stem.at(-1) ?? "");
  if (lastLetterIsDoubled) stem = stem.slice(0, -1);
  return stem;
}

/**
 * Checks whether two words are at most one typo apart: one letter added,
 * dropped, changed, or two neighbouring letters swapped.
 * @param firstWord - One word
 * @param secondWord - The other word
 * @returns True when they differ by exactly one such typo
 */
export function isOneTypoApart(firstWord: string, secondWord: string): boolean {
  if (firstWord === secondWord) return false;
  const lengthDifference = Math.abs(firstWord.length - secondWord.length);
  if (lengthDifference > 1) return false;
  if (lengthDifference === 1) {
    const [shorterWord, longerWord] =
      firstWord.length < secondWord.length ? [firstWord, secondWord] : [secondWord, firstWord];
    const letterIndexes = Array.from({ length: longerWord.length }, (_unused, letterIndex) => letterIndex);
    return letterIndexes.some(
      (letterIndex) => longerWord.slice(0, letterIndex) + longerWord.slice(letterIndex + 1) === shorterWord,
    );
  }
  const letterIndexes = Array.from({ length: firstWord.length }, (_unused, letterIndex) => letterIndex);
  const differingPositions = letterIndexes.filter((letterIndex) => firstWord[letterIndex] !== secondWord[letterIndex]);
  if (differingPositions.length === 1) return true;
  const [firstDifference, secondDifference] = differingPositions;
  const lettersAreSwapped =
    differingPositions.length === 2 &&
    secondDifference === firstDifference + 1 &&
    firstWord[firstDifference] === secondWord[secondDifference] &&
    firstWord[secondDifference] === secondWord[firstDifference];
  return lettersAreSwapped;
}

/**
 * Scores how well one word of the text matches one list word.
 * @param word - A lower case word of the title or description
 * @param listWord - A single list word
 * @returns The match weight: exact, same stem, one typo (both words long enough), or 0
 */
export function scoreWordMatch(word: string, listWord: string): number {
  if (word === listWord) return EXACT_MATCH_WEIGHT;
  if (stemWord(word) === stemWord(listWord)) return STEM_MATCH_WEIGHT;
  const bothWordsAreLongEnough = word.length >= MIN_TYPO_WORD_LENGTH && listWord.length >= MIN_TYPO_WORD_LENGTH;
  if (bothWordsAreLongEnough && isOneTypoApart(word, listWord)) return TYPO_MATCH_WEIGHT;
  return 0;
}

/**
 * Finds the words of one text that match a word list. Two-word phrases
 * (`go to`, `sign up`) match as phrases, exactly; a stop word never matches
 * on its own. Each word of the text matches at most once, against its best
 * list word.
 * @param text - The title or the description
 * @param listWords - The word list
 * @param isInTitle - True for the title
 * @returns The matches, in text order
 */
export function findWordMatches(text: string, listWords: readonly string[], isInTitle: boolean): WordMatch[] {
  const words = splitIntoWords(text);
  const phrases = listWords.filter((listWord) => listWord.includes(" "));
  const singleWords = listWords.filter((listWord) => !listWord.includes(" "));
  const matches: WordMatch[] = [];
  let wordIndex = 0;
  while (wordIndex < words.length) {
    const word = words[wordIndex];
    const twoWords = `${word} ${words[wordIndex + 1] ?? ""}`;
    const matchedPhrase = phrases.find((phrase) => phrase === twoWords);
    if (matchedPhrase !== undefined) {
      matches.push({ word: twoWords, listWord: matchedPhrase, weight: EXACT_MATCH_WEIGHT, isInTitle });
      wordIndex += 2;
      continue;
    }
    wordIndex += 1;
    if (STOP_WORDS.has(word)) continue;
    const bestMatch = singleWords
      .map((listWord) => ({ listWord, weight: scoreWordMatch(word, listWord) }))
      .reduce((best, candidate) => (candidate.weight > best.weight ? candidate : best), { listWord: "", weight: 0 });
    if (bestMatch.weight > 0) {
      matches.push({ word, listWord: bestMatch.listWord, weight: bestMatch.weight, isInTitle });
    }
  }
  return matches;
}

/**
 * Finds the matches of a word list in both the title and the description.
 * @param title - The action's title
 * @param description - The action's description
 * @param listWords - The word list
 * @returns The title's matches, then the description's
 */
function findTitleAndDescriptionMatches(
  title: string,
  description: string,
  listWords: readonly string[],
): WordMatch[] {
  return [...findWordMatches(title, listWords, true), ...findWordMatches(description, listWords, false)];
}

/**
 * Adds up matches: each match's weight, counted `TITLE_WORD_WEIGHT` times in
 * the title and `DESCRIPTION_WORD_WEIGHT` times in the description.
 * @param matches - Matches from `findWordMatches`
 * @returns The total score
 */
export function sumWordMatches(matches: WordMatch[]): number {
  return matches.reduce(
    (total, match) => total + match.weight * (match.isInTitle ? TITLE_WORD_WEIGHT : DESCRIPTION_WORD_WEIGHT),
    0,
  );
}

/**
 * Turns a winner's share of the score into a confidence level.
 * @param confidenceShare - From 0 to 1
 * @returns `high` from `HIGH_CONFIDENCE_SHARE`, `medium` from `MEDIUM_CONFIDENCE_SHARE`, else `low`
 */
export function describeConfidence(confidenceShare: number): DetectionConfidence {
  if (confidenceShare >= HIGH_CONFIDENCE_SHARE) return "high";
  if (confidenceShare >= MEDIUM_CONFIDENCE_SHARE) return "medium";
  return "low";
}

/**
 * Lists the distinct words of some matches, in order.
 * @param matches - Matches from `findWordMatches`
 * @returns Each matched word once
 */
function listEvidenceWords(matches: WordMatch[]): string[] {
  return [...new Set(matches.map((match) => match.word))];
}

/** One object kind's matches and score, for the kind detection. */
interface KindScore {
  /** The kind. */
  kind: CrudActionKind;
  /** Its word list's matches. */
  matches: WordMatch[];
  /** Their total (see `sumWordMatches`). */
  score: number;
}

/**
 * Detects an action's kind from its title and description, with no LLM: each
 * object kind's words are scored (see `KIND_WORD_LISTS`, `findWordMatches`
 * and `sumWordMatches`), and the highest score wins with a confidence of its
 * share of the total. A tie for first place, or no match at all, is
 * `parameters` - the kind that touches no object.
 * @param title - The action's title
 * @param description - The action's description
 * @returns The detected kind, why, how sure, and the deciding words
 */
export function detectActionKind(title: string, description: string): ActionKindDetection {
  const kindScores: KindScore[] = CRUD_ACTION_KINDS.map((kind) => {
    const matches = findTitleAndDescriptionMatches(title, description, KIND_WORD_LISTS[kind]);
    return { kind, matches, score: sumWordMatches(matches) };
  });
  const scores = Object.fromEntries(kindScores.map((kindScore) => [kindScore.kind, kindScore.score])) as Record<
    CrudActionKind,
    number
  >;
  const totalScore = kindScores.reduce((total, kindScore) => total + kindScore.score, 0);
  const nothingMatched = totalScore === 0;
  if (nothingMatched) {
    return { kind: "parameters", reason: "noMatch", confidence: "low", confidenceShare: 0, scores, evidence: [] };
  }
  const rankedScores = [...kindScores].sort((first, second) => second.score - first.score);
  const winner = rankedScores[0];
  const tiedForFirst = rankedScores.filter((kindScore) => Math.abs(kindScore.score - winner.score) < 1e-9);
  const firstPlaceIsTied = tiedForFirst.length > 1;
  if (firstPlaceIsTied) {
    return {
      kind: "parameters",
      reason: "tie",
      confidence: "low",
      confidenceShare: MEDIUM_CONFIDENCE_SHARE,
      scores,
      evidence: listEvidenceWords(tiedForFirst.flatMap((kindScore) => kindScore.matches)),
    };
  }
  const confidenceShare = winner.score / totalScore;
  return {
    kind: winner.kind,
    reason: "won",
    confidence: describeConfidence(confidenceShare),
    confidenceShare,
    scores,
    evidence: listEvidenceWords(winner.matches),
  };
}

/**
 * Finds where an object type's name appears in a text: its words in order,
 * the last one matched like the kind words (so `projects` and `project`
 * both match `Project`), the ones before it exactly.
 * @param text - The title or description
 * @param nameWords - The type name's words, lower case
 * @param isInTitle - True for the title
 * @returns The matches (one per place the name appears)
 */
function findNameMatches(text: string, nameWords: string[], isInTitle: boolean): WordMatch[] {
  const words = splitIntoWords(text);
  const leadingNameWords = nameWords.slice(0, -1);
  const lastNameWord = nameWords.at(-1) ?? "";
  const matches: WordMatch[] = [];
  words.forEach((word, wordIndex) => {
    const leadingWordsMatch = leadingNameWords.every(
      (nameWord, nameWordIndex) => words[wordIndex - leadingNameWords.length + nameWordIndex] === nameWord,
    );
    const weight = leadingWordsMatch ? scoreWordMatch(word, lastNameWord) : 0;
    if (weight > 0) {
      const matchedWords = words.slice(wordIndex - leadingNameWords.length, wordIndex + 1).join(" ");
      matches.push({ word: matchedWords, listWord: nameWords.join(" "), weight, isInTitle });
    }
  });
  return matches;
}

/**
 * Detects which object type an action works on: each crawled object's name
 * is looked for in the title and description (see `findNameMatches`, scored
 * like the kind words), and a type gets `OBJECT_TYPE_ADDRESS_WEIGHT` more
 * when the newest version's start URL or a `goto` opens its own page or its
 * create page. The highest score wins, with its share of the total as the
 * confidence; a tie for first place picks nothing.
 * @param title - The action's title
 * @param description - The action's description
 * @param candidates - The website's web objects
 * @param planUrls - The newest version's start URL and `goto` addresses
 * @returns The winning type, or null when none matched (or two tied)
 */
export function detectObjectType(
  title: string,
  description: string,
  candidates: ObjectTypeCandidate[],
  planUrls: string[],
): ObjectTypeDetection | null {
  const scoredCandidates = candidates.map((candidate) => {
    const nameWords = splitIntoWords(candidate.name);
    const nameMatches =
      nameWords.length === 0
        ? []
        : [...findNameMatches(title, nameWords, true), ...findNameMatches(description, nameWords, false)];
    const versionOpensItsPage = planUrls.some((planUrl) =>
      candidate.addressPatternKeys.some((patternKey) => urlMatchesPatternKey(planUrl, patternKey)),
    );
    const score = sumWordMatches(nameMatches) + (versionOpensItsPage ? OBJECT_TYPE_ADDRESS_WEIGHT : 0);
    const evidence = [...listEvidenceWords(nameMatches), ...(versionOpensItsPage ? ["address"] : [])];
    return { candidate, score, evidence };
  });
  const totalScore = scoredCandidates.reduce((total, scored) => total + scored.score, 0);
  if (totalScore === 0) return null;
  const rankedCandidates = [...scoredCandidates].sort((first, second) => second.score - first.score);
  const winner = rankedCandidates[0];
  const runnerUp = rankedCandidates.at(1);
  const firstPlaceIsTied = runnerUp !== undefined && Math.abs(runnerUp.score - winner.score) < 1e-9;
  if (firstPlaceIsTied) return null;
  const confidenceShare = winner.score / totalScore;
  return {
    objectTypeKey: winner.candidate.objectTypeKey,
    objectTypeName: winner.candidate.name,
    confidence: describeConfidence(confidenceShare),
    confidenceShare,
    evidence: winner.evidence,
  };
}

/**
 * Reads a stored kind, keeping only a known one.
 * @param storedKind - The `userActionKind` column
 * @returns The kind, or null for "detect" (null or an unknown value)
 */
export function readActionKind(storedKind: string | null): ActionKind | null {
  return ACTION_KINDS.find((kind) => kind === storedKind) ?? null;
}

/**
 * Lists what the user should check about a resolved role.
 * @param role - The role, before its warnings are filled in
 * @returns The warnings, in plain words
 */
function listRoleWarnings(role: Omit<ResolvedActionRole, "warnings">): string[] {
  const warnings: string[] = [];
  const kindWasDetectedFromATie = role.kindSource === "detected" && role.detectedKind.reason === "tie";
  if (kindWasDetectedFromATie) {
    warnings.push(
      `Check this: the kind words tied (${role.detectedKind.evidence.join(", ")}), so it was set to Parameters`,
    );
  }
  const kindNeedsAType = kindNeedsAnObjectType(role.kind);
  if (kindNeedsAType && role.objectTypeKey === null) {
    warnings.push("Pick the kind of object this action works on - none was detected");
  }
  const kindMayHaveAType = kindTakesAnObjectType(role.kind);
  if (kindMayHaveAType && role.objectTypeKey !== null && role.objectTypeName === null) {
    warnings.push("The chosen kind of object is no longer found by the latest crawl; pick it again");
  }
  const typeIsUnsure = role.objectTypeSource === "detected" && role.detectedObjectType?.confidence === "low";
  if (kindMayHaveAType && typeIsUnsure) {
    warnings.push("Check the kind of object - the detection is not sure");
  }
  return warnings;
}

/**
 * Says whether a kind can have an object type: every kind but `parameters`.
 * @param kind - The kind
 * @returns True for the four object kinds
 */
export function kindTakesAnObjectType(kind: ActionKind): boolean {
  return kind !== "parameters";
}

/**
 * Says whether a kind must have an object type to do its job: Create (to
 * record what it made) and Update (to know what it acts on). A Read action
 * may have none, and a Delete action takes its parameters from the Create
 * action it cleans up after, so its type is optional too.
 * @param kind - The kind
 * @returns True for `create` and `update`
 */
export function kindNeedsAnObjectType(kind: ActionKind): boolean {
  return kind === "create" || kind === "update";
}

/**
 * Says whether a kind acts on an EXISTING object picked from the known
 * instances of its type (the `object` parameter): Read and Update. A Delete
 * action does not - it mirrors its Create action's parameters instead.
 * @param kind - The kind
 * @returns True for `read` and `update`
 */
export function kindActsOnAnExistingObject(kind: ActionKind): boolean {
  return kind === "read" || kind === "update";
}

/**
 * Works out what an action does with an object: its kind and the object type
 * it works on. The user's choices always win; anything left on "detect" is
 * detected from the title and description (no LLM), and the object type also
 * from the newest version's addresses. A `parameters` action has no object
 * type.
 * @param action - The action's text and the user's choices
 * @param candidates - The website's web objects
 * @param planUrls - The newest version's start URL and `goto` addresses (empty when it has none)
 * @returns The resolved role, with the detections and anything to check
 */
export function resolveActionObjectRole(
  action: ActionRoleInput,
  candidates: ObjectTypeCandidate[],
  planUrls: string[],
): ResolvedActionRole {
  const detectedKind = detectActionKind(action.title, action.description);
  const userKind = readActionKind(action.userActionKind);
  const kind = userKind ?? detectedKind.kind;
  const detectedObjectType = detectObjectType(action.title, action.description, candidates, planUrls);

  const kindTakesAType = kindTakesAnObjectType(kind);
  const userObjectTypeKey = action.userObjectTypeKey;
  let objectTypeKey: string | null = null;
  let objectTypeName: string | null = null;
  let objectTypeSource: "you" | "detected" | null = null;
  if (kindTakesAType && userObjectTypeKey !== null) {
    objectTypeKey = userObjectTypeKey;
    objectTypeName = candidates.find((candidate) => candidate.objectTypeKey === userObjectTypeKey)?.name ?? null;
    objectTypeSource = "you";
  } else if (kindTakesAType && detectedObjectType !== null) {
    objectTypeKey = detectedObjectType.objectTypeKey;
    objectTypeName = detectedObjectType.objectTypeName;
    objectTypeSource = "detected";
  }

  const roleWithoutWarnings: Omit<ResolvedActionRole, "warnings"> = {
    kind,
    kindSource: userKind === null ? "detected" : "you",
    detectedKind,
    objectTypeKey,
    objectTypeName,
    objectTypeSource,
    detectedObjectType,
  };
  return { ...roleWithoutWarnings, warnings: listRoleWarnings(roleWithoutWarnings) };
}
