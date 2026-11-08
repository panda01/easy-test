/**
 * The beta header that turns on structured outputs (`output_config.format`)
 * on the beta messages endpoint - the same one the SDK's own `parse` adds.
 */
export const STRUCTURED_OUTPUTS_BETA = "structured-outputs-2025-12-15";

/**
 * Checks whether a JSON value is a plain object (not null, not an array).
 * @param value - Any JSON value
 * @returns True for a plain object
 */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Rewrites zod's JSON schema into the plainest form structured outputs
 * accept: the `$schema` marker is dropped, a type list such as
 * `["string", "null"]` becomes an `anyOf`, and an `anyOf` nested directly in
 * another `anyOf` is flattened into it. Everything else - `enum`,
 * `required`, `additionalProperties: false` - is kept as it is, so the
 * allowed values are ENFORCED by the API, not just described. Shared by the
 * plan generation and the delete-action proposal.
 * @param schemaNode - One node of the JSON schema
 * @returns The rewritten node
 */
export function toStructuredOutputSchema(schemaNode: unknown): unknown {
  if (Array.isArray(schemaNode)) {
    return schemaNode.map(toStructuredOutputSchema);
  }
  if (!isJsonObject(schemaNode)) {
    return schemaNode;
  }

  const rewrittenNode: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(schemaNode)) {
    const keyIsTheSchemaMarker = key === "$schema";
    if (keyIsTheSchemaMarker) continue;
    rewrittenNode[key] = toStructuredOutputSchema(child);
  }

  const { type } = rewrittenNode;
  const typeIsAList = Array.isArray(type);
  if (typeIsAList) {
    delete rewrittenNode.type;
    rewrittenNode.anyOf = type.map((typeName: unknown) => ({ type: typeName }));
  }

  const { anyOf } = rewrittenNode;
  if (Array.isArray(anyOf)) {
    rewrittenNode.anyOf = anyOf.flatMap((variant: unknown) => {
      const variantIsOnlyAnAnyOf =
        isJsonObject(variant) && Array.isArray(variant.anyOf) && Object.keys(variant).length === 1;
      return variantIsOnlyAnAnyOf ? variant.anyOf : [variant];
    });
  }
  return rewrittenNode;
}
