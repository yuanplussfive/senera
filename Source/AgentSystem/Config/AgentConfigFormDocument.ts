import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { moduleDirPath } from "../Core/AgentPath.js";
import { formatZodIssue } from "../Diagnostics/AgentValidationIssue.js";
import { AgentLocalizedError } from "../I18n/AgentLocalizedError.js";
import {
  AgentExtensionLocalizedTextSchema,
  type AgentExtensionLocalizedText,
} from "../Extensions/AgentExtensionLocalization.js";
import { AgentConfigFormVersion } from "../Types/ConfigFormTypes.js";
import { listAgentConfigLeafPaths, readAgentConfigFieldContract } from "./AgentConfigFieldContractCatalog.js";
import { parseJsonText } from "../Core/AgentJsonParsing.js";

const FormSchemaPath = path.join(moduleDirPath(import.meta.url), "AgentSystemConfig.form.json");

const ConfigFormFieldTypeSchema = z.enum(["boolean", "string", "number", "array", "table", "record"]);

const ConfigFormFieldOptionValueSchema = z.union([z.string(), z.number(), z.boolean()]);

const ConfigFormFieldLevelSchema = z.enum(["basic", "advanced", "internal"]);

const ConfigFormModelSelectionSchema = z
  .object({
    id: z.string().min(1),
    capability: z.enum([
      "Chat",
      "Embedding",
      "Rerank",
      "Vision",
      "ImageOutput",
      "Reasoning",
      "DeveloperRole",
      "StreamingUsage",
    ]),
    valueKind: z.enum(["model-id", "provider-model"]),
    mutation: z.enum(["config", "default-model"]),
    providerPath: z.array(z.string().min(1)).min(1).optional(),
    required: z.boolean(),
  })
  .strict()
  .superRefine((selection, context) => {
    if (selection.valueKind === "provider-model" && !selection.providerPath) {
      context.addIssue({
        code: "custom",
        message: "providerPath is required when valueKind is provider-model.",
        path: ["providerPath"],
      });
    }
    if (selection.valueKind === "model-id" && selection.providerPath) {
      context.addIssue({
        code: "custom",
        message: "providerPath is only supported when valueKind is provider-model.",
        path: ["providerPath"],
      });
    }
    if (selection.mutation === "default-model" && selection.valueKind !== "model-id") {
      context.addIssue({
        code: "custom",
        message: "default-model mutations require model-id values.",
        path: ["mutation"],
      });
    }
  });

export type ConfigFormFieldDefinition<TText = string> = {
  path: string[];
  label: TText;
  description?: TText;
  placeholder?: TText;
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
  itemFields?: ConfigFormFieldDefinition<TText>[];
  defaultValue?: unknown;
  defaultItem?: Record<string, unknown>;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  modelSelection?: z.infer<typeof ConfigFormModelSelectionSchema>;
};

export type ConfigFormSectionDefinition<TText = string> = {
  id: string;
  label: TText;
  description?: TText;
  icon?: string;
  level?: z.infer<typeof ConfigFormFieldLevelSchema>;
  fields?: ConfigFormFieldDefinition<TText>[];
};

function createConfigFormFieldSchema<TText>(textSchema: z.ZodType<TText>): z.ZodType<ConfigFormFieldDefinition<TText>> {
  const fieldSchema: z.ZodType<ConfigFormFieldDefinition<TText>> = z.lazy(() =>
    z
      .object({
        path: z.array(z.string().min(1)).min(1),
        label: textSchema,
        description: textSchema.optional(),
        placeholder: textSchema.optional(),
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
        itemFields: z.array(fieldSchema).optional(),
        defaultValue: z.unknown().optional(),
        defaultItem: z.record(z.string(), z.unknown()).optional(),
        keyPlaceholder: z.string().min(1).optional(),
        valuePlaceholder: z.string().min(1).optional(),
        modelSelection: ConfigFormModelSelectionSchema.optional(),
      })
      .strict(),
  );
  return fieldSchema;
}

function createConfigFormSectionSchema<TText>(
  textSchema: z.ZodType<TText>,
  fieldSchema: z.ZodType<ConfigFormFieldDefinition<TText>>,
): z.ZodType<ConfigFormSectionDefinition<TText>> {
  return z
    .object({
      id: z.string().min(1),
      label: textSchema,
      description: textSchema.optional(),
      icon: z.string().min(1).optional(),
      level: ConfigFormFieldLevelSchema.optional(),
      fields: z.array(fieldSchema).optional(),
    })
    .strict();
}

const ConfigFormCoverageOmissionSchema = z
  .object({
    path: z.array(z.string().min(1)).min(1),
    recursive: z.boolean().optional(),
    reason: z.string().min(1),
  })
  .strict();

type ConfigFormCoverageOmission = z.infer<typeof ConfigFormCoverageOmissionSchema>;

export type ConfigFormDocument<TText = string> = {
  form: {
    version: typeof AgentConfigFormVersion;
    sections?: ConfigFormSectionDefinition<TText>[];
    coverage?: { omissions?: ConfigFormCoverageOmission[] };
  };
};

function createConfigFormDocumentSchema<TText>(textSchema: z.ZodType<TText>): z.ZodType<ConfigFormDocument<TText>> {
  const fieldSchema = createConfigFormFieldSchema(textSchema);
  const sectionSchema = createConfigFormSectionSchema(textSchema, fieldSchema);
  return z
    .object({
      form: z
        .object({
          version: z.literal(AgentConfigFormVersion),
          sections: z.array(sectionSchema).optional(),
          coverage: z
            .object({
              omissions: z.array(ConfigFormCoverageOmissionSchema).optional(),
            })
            .strict()
            .optional(),
        })
        .strict(),
    })
    .strict();
}

export const ConfigFormDocumentSchema = createConfigFormDocumentSchema(z.string().min(1));
export const LocalizedConfigFormDocumentSchema = createConfigFormDocumentSchema(AgentExtensionLocalizedTextSchema);
export type LocalizedConfigFormDocument = ConfigFormDocument<AgentExtensionLocalizedText>;

let cachedDocument: ConfigFormDocument | undefined;

export function readConfigFormDocument(): ConfigFormDocument {
  if (cachedDocument) {
    return cachedDocument;
  }

  const result = ConfigFormDocumentSchema.safeParse(
    parseJsonText(fs.readFileSync(FormSchemaPath, "utf8"), "Config form document"),
  );
  if (!result.success) {
    throw new AgentLocalizedError("config.formDocumentInvalid", {
      issues: result.error.issues.map((issue) => formatZodIssue(issue)).join("; "),
    });
  }

  assertConfigFormRequiredDeclarations(result.data);
  assertConfigFormCoverage(result.data);
  cachedDocument = result.data;
  return cachedDocument;
}

function assertConfigFormCoverage(document: ConfigFormDocument): void {
  const declared = new Set<string>();
  for (const section of document.form.sections ?? []) {
    for (const field of section.fields ?? []) collectDeclaredFieldPaths(field, [], declared);
  }

  const omissions = document.form.coverage?.omissions ?? [];
  const schemaPaths = listAgentConfigLeafPaths();
  const uncovered = schemaPaths.filter((path) => {
    if (declared.has(configPathKey(path))) return false;
    return !omissions.some((omission) => omissionCoversPath(omission, path));
  });
  if (uncovered.length > 0) {
    throw new Error(`Agent config form does not account for schema fields: ${uncovered.map(renderPath).join(", ")}.`);
  }

  const unusedOmissions = omissions.filter(
    (omission) => !schemaPaths.some((path) => omissionCoversPath(omission, path)),
  );
  if (unusedOmissions.length > 0) {
    throw new Error(
      `Agent config form coverage omissions do not match schema fields: ${unusedOmissions
        .map((omission) => renderPath(omission.path))
        .join(", ")}.`,
    );
  }
}

function collectDeclaredFieldPaths(
  field: ConfigFormFieldDefinition,
  basePath: readonly string[],
  declared: Set<string>,
): void {
  const path = [...basePath, ...field.path];
  declared.add(configPathKey(path));
  for (const itemField of field.itemFields ?? []) collectDeclaredFieldPaths(itemField, path, declared);
}

function omissionCoversPath(omission: ConfigFormCoverageOmission, path: readonly string[]): boolean {
  if (omission.path.length > path.length) return false;
  if (!omission.path.every((part, index) => path[index] === part)) return false;
  return omission.recursive === true || omission.path.length === path.length;
}

function configPathKey(path: readonly string[]): string {
  return path.join("\u001f");
}

function renderPath(path: readonly string[]): string {
  return path.join(".");
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
