import { Ajv, type ValidateFunction } from "ajv";
import {
  LocalizedConfigFormDocumentSchema,
  type LocalizedConfigFormDocument,
  type ConfigFormFieldDefinition,
} from "../Config/AgentConfigFormDocument.js";
import { projectConfigFormField } from "../Config/AgentConfigFormFieldProjector.js";
import { AgentJsonFileLoader } from "../Config/AgentJsonFileLoader.js";
import { deepFreeze } from "../Core/AgentDeepFreeze.js";
import type { AgentExtensionLocalizedText } from "../Extensions/AgentExtensionLocalization.js";
import type { AgentConfigFormSection } from "../Types/ConfigFormTypes.js";
import { AgentSystemExtensionJsonSchema, type AgentSystemExtensionManifest } from "./AgentSystemExtensionManifest.js";
import { resolveSystemExtensionPackageFile } from "./AgentSystemExtensionPackagePath.js";

export interface AgentSystemExtensionConfigurationSettings {
  readonly configured: boolean;
  readonly value: Readonly<Record<string, unknown>>;
  readonly effectiveValue: Readonly<Record<string, unknown>>;
  readonly defaults: Readonly<Record<string, unknown>>;
  readonly sections: readonly AgentConfigFormSection<AgentExtensionLocalizedText>[];
}

export class AgentSystemExtensionConfigurationReader {
  private readonly json = new AgentJsonFileLoader();
  private readonly ajv = new Ajv({ allErrors: true, strict: true, validateFormats: false });
  private readonly defaultingAjv = new Ajv({
    allErrors: true,
    strict: true,
    validateFormats: false,
    useDefaults: true,
  });

  read(
    packageRoot: string,
    manifest: AgentSystemExtensionManifest,
    explicitValue: Readonly<Record<string, unknown>> | undefined,
  ): AgentSystemExtensionConfigurationSettings | undefined {
    if (!manifest.configuration) {
      if (explicitValue !== undefined) {
        throw new Error(`System extension ${manifest.id} does not declare a configuration schema.`);
      }
      return undefined;
    }
    const schema = this.json.load(
      resolveSystemExtensionPackageFile(packageRoot, manifest.configuration.schema, "configuration schema"),
      AgentSystemExtensionJsonSchema,
    );
    const ui = manifest.configuration.ui
      ? (this.json.load(
          resolveSystemExtensionPackageFile(packageRoot, manifest.configuration.ui, "UI schema"),
          LocalizedConfigFormDocumentSchema,
        ) as LocalizedConfigFormDocument)
      : deriveConfigurationUi(manifest, schema);
    assertConfigurationUiMatchesSchema(manifest.id, schema, ui);
    const value = structuredClone(explicitValue ?? {});
    assertValidConfiguration(manifest.id, this.ajv.compile(schema), value);
    const defaults = materializeConfiguration(this.defaultingAjv, manifest.id, schema, {});
    const effectiveValue = materializeConfiguration(this.defaultingAjv, manifest.id, schema, value);
    return {
      configured: explicitValue !== undefined,
      value: deepFreeze(value),
      effectiveValue: deepFreeze(effectiveValue),
      defaults: deepFreeze(defaults),
      sections:
        ui.form.sections?.map((section) => {
          const fields = (section.fields ?? []).map((field) =>
            projectConfigFormField({
              field,
              section: section.id,
              source: value,
              inheritedSource: {},
              effectiveSource: effectiveValue,
              basePath: [],
            }),
          );
          return {
            name: section.id,
            label: section.label,
            description: section.description,
            icon: section.icon,
            keyCount: fields.length,
            fields,
          };
        }) ?? [],
    };
  }
}

function materializeConfiguration(
  ajv: Ajv,
  extensionId: string,
  schema: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const value = structuredClone(source);
  assertValidConfiguration(extensionId, ajv.compile(schema), value);
  return value;
}

function assertValidConfiguration(extensionId: string, validate: ValidateFunction, value: unknown): void {
  if (validate(value)) return;
  const issues = (validate.errors ?? [])
    .map((issue) => `${issue.instancePath || "/"} ${issue.message ?? "is invalid"}`)
    .join("; ");
  throw new Error(`System extension ${extensionId} configuration is invalid: ${issues}.`);
}

function deriveConfigurationUi(
  manifest: AgentSystemExtensionManifest,
  schema: Record<string, unknown>,
): LocalizedConfigFormDocument {
  return LocalizedConfigFormDocumentSchema.parse({
    form: {
      version: 1,
      sections: [
        {
          id: "configuration",
          label: manifest.displayName,
          description: manifest.description,
          fields: deriveConfigurationFields(schema, [], false),
        },
      ],
    },
  });
}

function deriveConfigurationFields(
  schema: Record<string, unknown>,
  pathParts: readonly string[],
  required: boolean,
): ConfigFormFieldDefinition<AgentExtensionLocalizedText>[] {
  const type = readSchemaType(schema);
  if (type === "object") {
    const properties = readSchemaProperties(schema);
    const requiredProperties = new Set(
      Array.isArray(schema.required)
        ? schema.required.filter((entry): entry is string => typeof entry === "string")
        : [],
    );
    return Object.entries(properties).flatMap(([name, property]) =>
      deriveConfigurationFields(property, [...pathParts, name], requiredProperties.has(name)),
    );
  }
  if (pathParts.length === 0) throw new Error("System extension configuration schema must describe an object.");
  const fieldType = schemaFieldType(schema);
  const options = Array.isArray(schema.enum)
    ? schema.enum.filter((entry): entry is string | number | boolean =>
        ["string", "number", "boolean"].includes(typeof entry),
      )
    : undefined;
  return [
    {
      path: [...pathParts],
      label: untranslatedText(
        typeof schema.title === "string" && schema.title.trim() ? schema.title : titleFromPath(pathParts),
      ),
      ...(typeof schema.description === "string" && schema.description.trim()
        ? { description: untranslatedText(schema.description) }
        : {}),
      type: fieldType.type,
      ...(fieldType.itemType ? { itemType: fieldType.itemType } : {}),
      ...(options?.length ? { options } : {}),
      ...(typeof schema.minimum === "number" ? { min: schema.minimum } : {}),
      ...(typeof schema.maximum === "number" ? { max: schema.maximum } : {}),
      ...(typeof schema.minLength === "number" ? { minLength: schema.minLength } : {}),
      ...(typeof schema.maxLength === "number" ? { maxLength: schema.maxLength } : {}),
      ...(schema.default !== undefined ? { defaultValue: schema.default } : {}),
      required,
      essential: true,
    },
  ];
}

function assertConfigurationUiMatchesSchema(
  extensionId: string,
  schema: Record<string, unknown>,
  ui: LocalizedConfigFormDocument,
): void {
  const declared = new Set<string>();
  for (const section of ui.form.sections ?? []) {
    for (const field of section.fields ?? []) {
      assertConfigurationField(extensionId, schema, field, [], declared);
    }
  }
  const missing = listConfigurationLeafPaths(schema).filter(
    (pathParts) => !declared.has(configurationPathKey(pathParts)),
  );
  if (missing.length > 0) {
    throw new Error(
      `System extension ${extensionId} UI schema omits configuration fields: ${missing
        .map((pathParts) => pathParts.join("."))
        .join(", ")}.`,
    );
  }
}

function assertConfigurationField(
  extensionId: string,
  rootSchema: Record<string, unknown>,
  field: ConfigFormFieldDefinition<AgentExtensionLocalizedText>,
  basePath: readonly string[],
  declared: Set<string>,
): void {
  const pathParts = [...basePath, ...field.path];
  const schema = readConfigurationSchemaAtPath(rootSchema, pathParts);
  if (!schema) {
    throw new Error(`System extension ${extensionId} UI schema references unknown field ${pathParts.join(".")}.`);
  }
  const expectedType = schemaFieldType(schema);
  if (field.type !== expectedType.type || field.itemType !== expectedType.itemType) {
    throw new Error(`System extension ${extensionId} UI field ${pathParts.join(".")} must use ${expectedType.type}.`);
  }
  const key = configurationPathKey(pathParts);
  if (declared.has(key)) {
    throw new Error(`System extension ${extensionId} UI field is duplicated: ${pathParts.join(".")}.`);
  }
  declared.add(key);
  for (const itemField of field.itemFields ?? []) {
    assertConfigurationField(extensionId, rootSchema, itemField, pathParts, declared);
  }
}

function listConfigurationLeafPaths(schema: Record<string, unknown>, basePath: readonly string[] = []): string[][] {
  if (readSchemaType(schema) !== "object") return [[...basePath]];
  return Object.entries(readSchemaProperties(schema)).flatMap(([name, property]) =>
    listConfigurationLeafPaths(property, [...basePath, name]),
  );
}

function readConfigurationSchemaAtPath(
  rootSchema: Record<string, unknown>,
  pathParts: readonly string[],
): Record<string, unknown> | undefined {
  let current = rootSchema;
  for (const part of pathParts) {
    if (readSchemaType(current) !== "object") return undefined;
    const next = readSchemaProperties(current)[part];
    if (!next) return undefined;
    current = next;
  }
  return current;
}

function schemaFieldType(schema: Record<string, unknown>): {
  type: ConfigFormFieldDefinition["type"];
  itemType?: ConfigFormFieldDefinition["itemType"];
} {
  const type = readSchemaType(schema);
  if (type === "boolean" || type === "string") return { type };
  if (type === "number" || type === "integer") return { type: "number" };
  if (type === "array") {
    const item = schemaFieldType(asSchemaObject(schema.items, "array items"));
    if (item.type === "array" || item.type === "table" || item.type === "record") {
      throw new Error("System extension configuration arrays must contain scalar values.");
    }
    return { type: "array", itemType: item.type };
  }
  throw new Error(`Unsupported System extension configuration field type: ${type}.`);
}

function readSchemaType(schema: Record<string, unknown>): string {
  if (typeof schema.type !== "string") {
    throw new Error("System extension configuration fields require an explicit type.");
  }
  return schema.type;
}

function readSchemaProperties(schema: Record<string, unknown>): Record<string, Record<string, unknown>> {
  const properties = asSchemaObject(schema.properties, "object properties");
  return Object.fromEntries(
    Object.entries(properties).map(([name, value]) => [name, asSchemaObject(value, `property ${name}`)]),
  );
}

function asSchemaObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`System extension configuration ${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function configurationPathKey(pathParts: readonly string[]): string {
  return pathParts.join("\u001f");
}

function titleFromPath(pathParts: readonly string[]): string {
  const value = pathParts[pathParts.length - 1] ?? "Configuration";
  return value.replaceAll(/([a-z0-9])([A-Z])/gu, "$1 $2").replaceAll(/[-_.]+/gu, " ");
}

function untranslatedText(value: string): AgentExtensionLocalizedText {
  return { "zh-CN": value, "en-US": value };
}
