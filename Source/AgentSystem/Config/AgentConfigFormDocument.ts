import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const FormSchemaPath = path.join(__dirname, "AgentSystemConfig.form.json");

const ConfigFormFieldTypeSchema = z.enum([
  "boolean",
  "string",
  "number",
  "array",
  "table",
  "record",
]);

const ConfigFormFieldOptionValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
]);

const ConfigFormFieldLevelSchema = z.enum([
  "basic",
  "advanced",
  "internal",
]);

type ConfigFormFieldSchemaInput = {
  path: string[];
  label: string;
  description?: string;
  placeholder?: string;
  type: z.infer<typeof ConfigFormFieldTypeSchema>;
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
  required?: boolean;
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
      required: z.boolean().optional(),
      level: ConfigFormFieldLevelSchema.optional(),
      addLabel: z.string().min(1).optional(),
      itemLabelPath: z.array(z.string().min(1)).optional(),
      itemFields: z.array(ConfigFormFieldSchema).optional(),
      defaultValue: z.unknown().optional(),
      defaultItem: z.record(z.string(), z.unknown()).optional(),
      keyPlaceholder: z.string().min(1).optional(),
      valuePlaceholder: z.string().min(1).optional(),
    })
    .strict()
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

  const result = ConfigFormDocumentSchema.safeParse(
    JSON.parse(fs.readFileSync(FormSchemaPath, "utf8")),
  );
  if (!result.success) {
    throw new Error(`主配置表单说明文件无效：${result.error.issues.map(formatZodIssue).join("; ")}`);
  }

  cachedDocument = result.data;
  return cachedDocument;
}

function formatZodIssue(issue: z.core.$ZodIssue): string {
  const pathText = issue.path.length > 0 ? issue.path.join(".") : "root";
  return `${pathText}: ${issue.message}`;
}
