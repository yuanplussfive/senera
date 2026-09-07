import { z } from "zod";

export type AgentJsonMergePatch<Value extends object, Identity extends keyof Value = never> = Pick<Value, Identity> & {
  [Key in Exclude<keyof Value, Identity>]?: Value[Key] | null;
};

export function applyAgentJsonMergePatch<Value extends object>(value: Value, patch: AgentJsonMergePatch<Value>): Value {
  const result = { ...value } as Record<string, unknown>;
  for (const [key, nextValue] of Object.entries(patch)) {
    if (nextValue === null) {
      delete result[key];
    } else if (nextValue !== undefined) {
      result[key] = nextValue;
    }
  }
  return result as Value;
}

export function createAgentJsonMergePatchSchema<
  Shape extends z.ZodRawShape,
  const IdentityFields extends readonly (keyof z.output<z.ZodObject<Shape>> & string)[],
>(
  baseSchema: z.ZodObject<Shape>,
  identityFields: IdentityFields,
): z.ZodType<AgentJsonMergePatch<z.output<z.ZodObject<Shape>>, IdentityFields[number]>> {
  const identity = new Set<string>(identityFields);
  const patchShape = Object.fromEntries(
    Object.entries(baseSchema.shape).map(([key, fieldSchema]) => {
      const schema = fieldSchema as z.ZodType;
      return [key, identity.has(key) ? schema : schema.nullable().optional()];
    }),
  );
  return z.object(patchShape).strict() as unknown as z.ZodType<
    AgentJsonMergePatch<z.output<z.ZodObject<Shape>>, IdentityFields[number]>
  >;
}
