import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { moduleDirPath } from "../Core/AgentPath.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import { readAgentConfigFieldContract } from "./AgentConfigFieldContractCatalog.js";

const FormSchemaPath = path.join(moduleDirPath(import.meta.url), "AgentSystemConfig.form.json");

const ConfigFormFieldTypeSchema = z.enum(["boolean", "string", "number", "array", "table", "record"]);

const ConfigFormFieldOptionValueSchema = z.union([z.string(), z.number(), z.boolean()]);

const ConfigFormFieldLevelSchema = z.enum(["basic", "advanced", "internal"]);

type ConfigFormFieldSchemaInput = {
  path: string[];
  label: string;
  description?: string;
  placeholder?: string;
  type: z.infer<typeof ConfigFormFieldTypeSchema>;
  required: boolean;
  essential: boolean;
  itemType?: z.infer<typeof ConfigFormFieldTypeSchema>;
  options?: Array<z.infer<typeof ConfigFormFieldOptionValueSchema>>;
  optionLabels?: Record<string, string>;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  step?: number;
  secret?: boolean;
  multiline?: boolean;
  level?: z.infer<typeof ConfigFormFieldLevelSchema>;
  addLabel?: string;
  itemLabelPath?: string[];
  itemFields?: ConfigFormFieldSchemaInput[];
  defaultValue?: unknown;
  defaultItem?: Record<string, unknown>;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
};

const ConfigFormFieldSchema: z.ZodType<ConfigFormFieldSchemaInput> = z.lazy(() =>
  z
    .object({
      path: z.array(z.string().min(1)).min(1),
      label: z.string().min(1),
      description: z.string().min(1).optional(),
      placeholder: z.string().min(1).optional(),
      type: ConfigFormFieldTypeSchema,
      required: z.boolean(),
      essential: z.boolean(),
      itemType: ConfigFormFieldTypeSchema.optional(),
      options: z.array(ConfigFormFieldOptionValueSchema).optional(),
      optionLabels: z.record(z.string(), z.string()).optional(),
      min: z.number().optional(),
      max: z.number().optional(),
      minLength: z.number().int().min(0).optional(),
      maxLength: z.number().int().min(1).optional(),
      step: z.number().optional(),
      secret: z.boolean().optional(),
      multiline: z.boolean().optional(),
      level: ConfigFormFieldLevelSchema.optional(),
      addLabel: z.string().min(1).optional(),
      itemLabelPath: z.array(z.string().min(1)).optional(),
      itemFields: z.array(ConfigFormFieldSchema).optional(),
      defaultValue: z.unknown().optional(),
      defaultItem: z.record(z.string(), z.unknown()).optional(),
      keyPlaceholder: z.string().min(1).optional(),
      valuePlaceholder: z.string().min(1).optional(),
    })
    .strict(),
);

const ConfigFormSectionSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    description: z.string().min(1).optional(),
    icon: z.string().min(1).optional(),
    level: ConfigFormFieldLevelSchema.optional(),
    fields: z.array(ConfigFormFieldSchema).optional(),
  })
  .strict();

const ConfigFormDocumentSchema = z
  .object({
    form: z
      .object({
        version: z.literal(1),
        sections: z.array(ConfigFormSectionSchema).optional(),
      })
      .strict(),
  })
  .strict();

export type ConfigFormFieldDefinition = z.infer<typeof ConfigFormFieldSchema>;
export type ConfigFormDocument = z.infer<typeof ConfigFormDocumentSchema>;

let cachedDocument: ConfigFormDocument | undefined;

export function readConfigFormDocument(): ConfigFormDocument {
  if (cachedDocument) {
    return cachedDocument;
  }

  const result = ConfigFormDocumentSchema.safeParse(JSON.parse(fs.readFileSync(FormSchemaPath, "utf8")));
  if (!result.success) {
    throw new Error(
      agentErrorMessage("config.formDocumentInvalid", {
        issues: result.error.issues.map(formatZodIssue).join("; "),
      }),
    );
  }

  assertConfigFormRequiredDeclarations(result.data);
  cachedDocument = result.data;
  return cachedDocument;
}

function assertConfigFormRequiredDeclarations(document: ConfigFormDocument): void {
  for (const section of document.form.sections ?? []) {
    for (const field of section.fields ?? []) {
      assertFieldRequiredDeclaration(field, []);
    }
  }
}

function assertFieldRequiredDeclaration(field: ConfigFormFieldDefinition, basePath: readonly string[]): void {
  const path = [...basePath, ...field.path];
  const contract = readAgentConfigFieldContract(path);
  if (field.required !== contract.required) {
    throw new Error(
      `Agent config form required declaration does not match AgentSystemConfigSchema: ${path.join(".")}.`,
    );
  }
  if (contract.options && !sameOptions(field.options, contract.options)) {
    throw new Error(`Agent config form options do not match AgentSystemConfigSchema: ${path.join(".")}.`);
  }
  for (const itemField of field.itemFields ?? []) {
    assertFieldRequiredDeclaration(itemField, path);
  }
}

function sameOptions(
  declared: readonly (string | number | boolean)[] | undefined,
  contract: readonly (string | number | boolean)[],
): boolean {
  if (!declared || declared.length !== contract.length) return false;
  const declaredValues = new Set(declared.map((value) => JSON.stringify(value)));
  return contract.every((value) => declaredValues.has(JSON.stringify(value)));
}

function formatZodIssue(issue: z.core.$ZodIssue): string {
  const pathText = issue.path.length > 0 ? issue.path.join(".") : "root";
  return `${pathText}: ${issue.message}`;
}
