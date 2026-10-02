/**
 * Formats a count with the right singular or plural noun, for running text
 * such as "1 use case" or "3 actions".
 * @param count - How many there are
 * @param singularNoun - The noun to use when `count` is exactly 1
 * @param pluralNoun - The noun to use for every other count, including 0
 * @returns The count followed by the matching noun
 */
export function formatCount(count: number, singularNoun: string, pluralNoun: string): string {
  const countIsExactlyOne = count === 1;
  const noun = countIsExactlyOne ? singularNoun : pluralNoun;
  return `${String(count)} ${noun}`;
}
