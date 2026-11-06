/**
 * Copies a JSON-like value with every object's keys sorted, recursively, so
 * two values that differ only in key order serialize to the same text.
 * Arrays keep their order: a step plan's `steps` are a sequence, so the same
 * steps in another order are a different plan.
 * @param value - Any JSON-like value (a parsed plan, one of its steps, a primitive)
 * @returns A copy whose nested objects have their keys in sorted order; arrays and primitives as they were
 */
function sortKeysRecursively(value: unknown): unknown {
  const valueIsAnArray = Array.isArray(value);
  if (valueIsAnArray) {
    return value.map(sortKeysRecursively);
  }
  const valueIsAPlainObject = typeof value === "object" && value !== null;
  if (!valueIsAPlainObject) {
    return value;
  }
  const sortedEntries = Object.entries(value)
    .sort(([firstKey], [secondKey]) => firstKey.localeCompare(secondKey))
    .map(([key, nestedValue]) => [key, sortKeysRecursively(nestedValue)]);
  return Object.fromEntries(sortedEntries);
}

/**
 * Checks whether two step plans are the same plan: their JSON is equal once
 * every object's keys are sorted, so key order never counts, while a changed
 * step, a changed value, or steps in another order always do. An auto-refine
 * job uses it to notice a refinement that came back with the plan it was
 * asked to fix, and stop instead of refining the same plan again.
 * @param firstPlan - One plan (a parsed `plan` JSON value)
 * @param secondPlan - The other plan
 * @returns True when both serialize to the same JSON with keys sorted
 */
export function plansAreIdentical(firstPlan: unknown, secondPlan: unknown): boolean {
  const firstPlanJson = JSON.stringify(sortKeysRecursively(firstPlan));
  const secondPlanJson = JSON.stringify(sortKeysRecursively(secondPlan));
  return firstPlanJson === secondPlanJson;
}
