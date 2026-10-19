/**
 * The shapes of id-like URL path segments the crawler recognises on sight,
 * before it has visited the page (see `classifyPathSegment`).
 */
export type IdSegmentShape = "uuid" | "cuid" | "number" | "hex" | "ulid" | "opaqueToken";

/** `8-4-4-4-12` hex digits, any version: `3f2b9c1e-8d4a-4e6f-9b0c-1a2b3c4d5e6f`. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Digits only: `42`, `20261016`. */
const NUMBER_PATTERN = /^\d+$/;

/** 26 Crockford base32 characters (no I, L, O, or U): `01ARZ3NDEKTSV4RRFFQ69G5FAV`. */
const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

/**
 * `c` and 20-30 lowercase letters or digits - a cuid (v1, what this app's own
 * ids are), or a cuid2 that happens to start with `c` (any other cuid2 is an
 * `opaqueToken`).
 */
const CUID_PATTERN = /^c[a-z0-9]{20,30}$/;

/** 8 or more hex digits: a Mongo ObjectId, a git sha, a content hash. */
const HEX_PATTERN = /^[0-9a-f]{8,}$/i;

/** Letters, digits, `-`, and `_` only - what an opaque token (nanoid, base64url) is made of. */
const TOKEN_CHARACTER_PATTERN = /^[A-Za-z0-9_-]+$/;

/** The shortest segment that can be an opaque token. */
const MIN_OPAQUE_TOKEN_LENGTH = 16;

/** Matches at least one digit. */
const DIGIT_PATTERN = /\d/;

/** Matches at least one letter. */
const LETTER_PATTERN = /[A-Za-z]/;

/**
 * Checks whether a segment reads like dashed words - a slug such as
 * `my-first-post-2024` - rather than a random token: more than half of its
 * `-` / `_` separated parts are words of two or more letters.
 * @param segment - One URL path segment
 * @returns True when most of its parts are words
 */
function readsLikeDashedWords(segment: string): boolean {
  const parts = segment.split(/[-_]/).filter((part) => part !== "");
  const wordParts = parts.filter((part) => /^[A-Za-z]{2,}$/.test(part));
  const mostPartsAreWords = wordParts.length * 2 > parts.length;
  return mostPartsAreWords;
}

/**
 * Checks whether a segment looks like an opaque token: at least
 * `MIN_OPAQUE_TOKEN_LENGTH` characters of letters, digits, `-`, and `_`,
 * mixing letters and digits, and not reading like dashed words.
 * @param segment - One URL path segment
 * @returns True when it looks like a generated token
 */
function looksLikeOpaqueToken(segment: string): boolean {
  const segmentIsLongEnough = segment.length >= MIN_OPAQUE_TOKEN_LENGTH;
  const segmentHasOnlyTokenCharacters = TOKEN_CHARACTER_PATTERN.test(segment);
  const segmentMixesLettersAndDigits = DIGIT_PATTERN.test(segment) && LETTER_PATTERN.test(segment);
  return (
    segmentIsLongEnough &&
    segmentHasOnlyTokenCharacters &&
    segmentMixesLettersAndDigits &&
    !readsLikeDashedWords(segment)
  );
}

/**
 * Decides whether one URL path segment is an ID - a part of the path that
 * changes from one instance of a page to the next, like the two ids in
 * `/websites/ck9x.../actions/cm2a...` - judging by its shape alone. The
 * shapes are checked in this order:
 * - `uuid`: `8-4-4-4-12` hex digits;
 * - `number`: digits only;
 * - `ulid`: 26 Crockford base32 characters, with a digit;
 * - `cuid`: `c` and 20-30 lowercase letters or digits, with a digit;
 * - `hex`: 8 or more hex digits, with a digit;
 * - `opaqueToken`: 16 or more letters, digits, `-`, and `_`, mixing letters
 *   and digits, that do not read like dashed words.
 *
 * Words (`edit`, `new`), slugs (`my-first-post`, `2024-report`), and short
 * mixed segments (`v2`, `page-12`) are not IDs. A slug is only recognised
 * later, from its siblings (see `detectPagePatterns`).
 * @param segment - One URL path segment, exactly as it appears in the path
 * @returns The ID's shape, or null when the segment is not an ID
 */
export function classifyPathSegment(segment: string): IdSegmentShape | null {
  if (UUID_PATTERN.test(segment)) return "uuid";
  if (NUMBER_PATTERN.test(segment)) return "number";
  const segmentHasADigit = DIGIT_PATTERN.test(segment);
  if (!segmentHasADigit) return null;
  if (ULID_PATTERN.test(segment)) return "ulid";
  if (CUID_PATTERN.test(segment)) return "cuid";
  if (HEX_PATTERN.test(segment)) return "hex";
  if (looksLikeOpaqueToken(segment)) return "opaqueToken";
  return null;
}
