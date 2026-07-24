export type JsonMergePatch<Value extends object, Identity extends keyof Value> = Pick<Value, Identity> & {
  [Key in Exclude<keyof Value, Identity>]?: Value[Key] | null;
};

export function createJsonMergePatch<Value extends object, const Identity extends readonly (keyof Value)[]>(
  base: Value,
  next: Value,
  identityFields: Identity,
): JsonMergePatch<Value, Identity[number]> {
  const identity = new Set<keyof Value>(identityFields);
  const result: Partial<Record<keyof Value, Value[keyof Value] | null>> = {};
  for (const field of identityFields) result[field] = next[field];
  for (const field of new Set<keyof Value>([
    ...(Object.keys(base) as Array<keyof Value>),
    ...(Object.keys(next) as Array<keyof Value>),
  ])) {
    if (identity.has(field)) continue;
    const nextHasField = Object.prototype.hasOwnProperty.call(next, field);
    if (!nextHasField) {
      if (Object.prototype.hasOwnProperty.call(base, field)) result[field] = null;
      continue;
    }
    if (!sameJsonValue(base[field], next[field])) result[field] = next[field];
  }
  return result as JsonMergePatch<Value, Identity[number]>;
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  return Object.is(left, right) || JSON.stringify(left) === JSON.stringify(right);
}
