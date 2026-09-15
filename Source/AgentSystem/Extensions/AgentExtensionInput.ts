import { z } from "zod";

export const AgentExtensionInputTypes = {
  String: "string",
  Number: "number",
  Boolean: "boolean",
  FilePath: "filepath",
  Directory: "directory",
} as const;

export const AgentExtensionInputValueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.array(z.string()),
  z.array(z.number().finite()),
  z.array(z.boolean()),
]);

export type AgentExtensionInputValue = z.infer<typeof AgentExtensionInputValueSchema>;

export const AgentExtensionInputDefinitionSchema = z
  .object({
    id: z
      .string()
      .trim()
      .regex(/^[A-Za-z][A-Za-z0-9._-]*$/u, "Expected a stable alphanumeric input id."),
    title: z.string().trim().min(1),
    description: z.string().trim().min(1).optional(),
    type: z.enum(AgentExtensionInputTypes),
    required: z.boolean().default(false),
    secret: z.boolean().default(false),
    multiple: z.boolean().default(false),
    defaultValue: AgentExtensionInputValueSchema.optional(),
    choices: z.array(AgentExtensionInputValueSchema).min(1).optional(),
    placeholder: z.string().optional(),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.secret && input.type !== AgentExtensionInputTypes.String) {
      context.addIssue({ code: "custom", path: ["secret"], message: "Secret inputs must use the string type." });
    }
    if (input.multiple && input.secret) {
      context.addIssue({ code: "custom", path: ["multiple"], message: "Secret inputs cannot be multiple." });
    }
    if (input.secret && input.defaultValue !== undefined) {
      context.addIssue({ code: "custom", path: ["defaultValue"], message: "Secret inputs cannot declare defaults." });
    }
    if (input.min !== undefined && input.max !== undefined && input.min > input.max) {
      context.addIssue({ code: "custom", path: ["min"], message: "min must not exceed max." });
    }
    validateDeclaredValue(input, input.defaultValue, ["defaultValue"], context);
    for (const [index, value] of (input.choices ?? []).entries()) {
      if (Array.isArray(value)) {
        context.addIssue({ code: "custom", path: ["choices", index], message: "Choices must be scalar values." });
      } else {
        validateInputValue({ ...input, multiple: false, choices: undefined }, value, (message) =>
          context.addIssue({ code: "custom", path: ["choices", index], message }),
        );
      }
    }
    const choiceKeys = (input.choices ?? []).map((value) => JSON.stringify(value));
    if (new Set(choiceKeys).size !== choiceKeys.length) {
      context.addIssue({ code: "custom", path: ["choices"], message: "Choices must be unique." });
    }
    if (
      input.defaultValue !== undefined &&
      input.choices &&
      !inputValueMatchesChoices(input.defaultValue, input.choices)
    ) {
      context.addIssue({
        code: "custom",
        path: ["defaultValue"],
        message: "defaultValue must be one of the declared choices.",
      });
    }
  });

export type AgentExtensionInputDefinition = z.infer<typeof AgentExtensionInputDefinitionSchema>;

export function parseAgentExtensionInputValue(
  definition: AgentExtensionInputDefinition,
  value: unknown,
): AgentExtensionInputValue {
  const parsed = AgentExtensionInputValueSchema.safeParse(value);
  if (!parsed.success) throw new Error(`Input ${definition.id} has an unsupported value.`);
  const issues: string[] = [];
  validateInputValue(definition, parsed.data, (message) => issues.push(message));
  if (issues.length > 0) throw new Error(`Input ${definition.id} is invalid: ${issues.join(" ")}`);
  return parsed.data;
}

export function stringifyAgentExtensionInputValue(value: AgentExtensionInputValue): string {
  if (Array.isArray(value)) return value.map(String).join(",");
  return String(value);
}

function validateDeclaredValue(
  input: z.infer<typeof AgentExtensionInputDefinitionSchema>,
  value: AgentExtensionInputValue | undefined,
  path: PropertyKey[],
  context: z.RefinementCtx,
): void {
  if (value === undefined) return;
  validateInputValue(input, value, (message) => context.addIssue({ code: "custom", path, message }));
}

function validateInputValue(
  input: Pick<AgentExtensionInputDefinition, "type" | "multiple" | "choices" | "min" | "max">,
  value: AgentExtensionInputValue,
  report: (message: string) => void,
): void {
  const values = Array.isArray(value) ? value : [value];
  if (input.multiple !== Array.isArray(value)) {
    report(input.multiple ? "Expected an array value." : "Expected a scalar value.");
    return;
  }
  for (const item of values) {
    if (!matchesInputType(input.type, item)) {
      report(`Expected ${input.type}.`);
      return;
    }
    if (typeof item === "number") {
      if (input.min !== undefined && item < input.min)
        report(`Expected a value greater than or equal to ${input.min}.`);
      if (input.max !== undefined && item > input.max) report(`Expected a value less than or equal to ${input.max}.`);
    }
    if (typeof item === "string") {
      if (input.min !== undefined && item.length < input.min) report(`Expected at least ${input.min} characters.`);
      if (input.max !== undefined && item.length > input.max) report(`Expected at most ${input.max} characters.`);
    }
  }
  if (input.choices && !inputValueMatchesChoices(value, input.choices)) {
    report("Expected one of the declared choices.");
  }
}

function inputValueMatchesChoices(
  value: AgentExtensionInputValue,
  choices: readonly AgentExtensionInputValue[],
): boolean {
  const values = Array.isArray(value) ? value : [value];
  return values.every((entry) => choices.some((choice) => !Array.isArray(choice) && sameInputValue(choice, entry)));
}

function matchesInputType(type: AgentExtensionInputDefinition["type"], value: string | number | boolean): boolean {
  if (type === AgentExtensionInputTypes.Number) return typeof value === "number" && Number.isFinite(value);
  if (type === AgentExtensionInputTypes.Boolean) return typeof value === "boolean";
  return typeof value === "string";
}

function sameInputValue(left: AgentExtensionInputValue, right: AgentExtensionInputValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
