import { Ajv, type ValidateFunction } from "ajv";
import {
  LocalizedConfigFormDocumentSchema,
  type LocalizedConfigFormDocument,
  type ConfigFormFieldDefinition,
} from "../Config/AgentConfigFormDocument.js";
import { projectConfigFormField } from "../Config/AgentConfigFormFieldProjector.js";
import { AgentJsonFileLoader } from "../Config/AgentJsonFileLoader.js";
import { deepFreeze } from "../Core/AgentDeepFreeze.js";
import {
  createAgentExtensionLocalizedText,
  type AgentExtensionLocalizedText,
} from "../Extensions/AgentExtensionLocalization.js";
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
  const valueSchema = readConfigurationValueSchema(schema);
  const type = readSchemaType(valueSchema);
  if (type === "object") {
    const properties = readSchemaProperties(valueSchema);
    const requiredProperties = new Set(
      Array.isArray(valueSchema.required)
        ? valueSchema.required.filter((entry): entry is string => typeof entry === "string")
        : [],
    );
    return Object.entries(properties).flatMap(([name, property]) =>
      deriveConfigurationFields(property, [...pathParts, name], requiredProperties.has(name)),
    );
  }
  if (pathParts.length === 0) throw new Error("System extension configuration schema must describe an object.");
  const fieldType = schemaFieldType(valueSchema);
  const options = Array.isArray(valueSchema.enum)
    ? valueSchema.enum.filter((entry): entry is string | number | boolean =>
        ["string", "number", "boolean"].includes(typeof entry),
      )
    : undefined;
  return [
    {
      path: [...pathParts],
      label: createAgentExtensionLocalizedText(
        typeof valueSchema.title === "string" && valueSchema.title.trim()
          ? valueSchema.title
          : titleFromPath(pathParts),
      ),
      ...(typeof valueSchema.description === "string" && valueSchema.description.trim()
        ? { description: createAgentExtensionLocalizedText(valueSchema.description) }
        : {}),
      type: fieldType.type,
      ...(fieldType.itemType ? { itemType: fieldType.itemType } : {}),
      ...(options?.length ? { options } : {}),
      ...(typeof valueSchema.minimum === "number" ? { min: valueSchema.minimum } : {}),
      ...(typeof valueSchema.maximum === "number" ? { max: valueSchema.maximum } : {}),
      ...(typeof valueSchema.minLength === "number" ? { minLength: valueSchema.minLength } : {}),
      ...(typeof valueSchema.maxLength === "number" ? { maxLength: valueSchema.maxLength } : {}),
      ...(valueSchema.default !== undefined ? { defaultValue: valueSchema.default } : {}),
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
  assertConfigurationModelSelection(extensionId, rootSchema, field, pathParts);
  const key = configurationPathKey(pathParts);
  if (declared.has(key)) {
    throw new Error(`System extension ${extensionId} UI field is duplicated: ${pathParts.join(".")}.`);
  }
  declared.add(key);
  for (const itemField of field.itemFields ?? []) {
    assertConfigurationField(extensionId, rootSchema, itemField, pathParts, declared);
  }
}

function assertConfigurationModelSelection(
  extensionId: string,
  rootSchema: Record<string, unknown>,
  field: ConfigFormFieldDefinition<AgentExtensionLocalizedText>,
  fieldPath: readonly string[],
): void {
  const selection = field.modelSelection;
  if (!selection) return;
  const cardinality = selection.cardinality ?? "one";
  const fieldShapeMatches =
    cardinality === "many" ? field.type === "array" && field.itemType === "string" : field.type === "string";
  if (!fieldShapeMatches) {
    throw new Error(
      `System extension ${extensionId} UI model selection ${fieldPath.join(".")} has an incompatible ${cardinality} field type.`,
    );
  }
  if (selection.providerPath) {
    assertConfigurationModelSelectionReference(
      extensionId,
      rootSchema,
      fieldPath,
      "providerPath",
      selection.providerPath,
      "string",
    );
  }
  if (selection.inheritance) {
    assertConfigurationModelSelectionReference(
      extensionId,
      rootSchema,
      fieldPath,
      "inheritance.path",
      selection.inheritance.path,
      "boolean",
    );
  }
}

function assertConfigurationModelSelectionReference(
  extensionId: string,
  rootSchema: Record<string, unknown>,
  fieldPath: readonly string[],
  referenceName: "providerPath" | "inheritance.path",
  referencePath: readonly string[],
  expectedType: "boolean" | "string",
): void {
  const referencedSchema = readConfigurationSchemaAtPath(rootSchema, referencePath);
  if (!referencedSchema) {
    throw new Error(
      `System extension ${extensionId} UI model selection ${fieldPath.join(".")} ${referenceName} references unknown field ${referencePath.join(".")}.`,
    );
  }
  const referencedType = schemaFieldType(referencedSchema);
  if (referencedType.type !== expectedType) {
    throw new Error(
      `System extension ${extensionId} UI model selection ${fieldPath.join(".")} ${referenceName} must reference a ${expectedType} field: ${referencePath.join(".")}.`,
    );
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
  const valueSchema = readConfigurationValueSchema(schema);
  const type = readSchemaType(valueSchema);
  if (type === "boolean" || type === "string") return { type };
  if (type === "number" || type === "integer") return { type: "number" };
  if (type === "array") {
    const item = schemaFieldType(asSchemaObject(valueSchema.items, "array items"));
    if (item.type === "array" || item.type === "table" || item.type === "record") {
      throw new Error("System extension configuration arrays must contain scalar values.");
    }
    return { type: "array", itemType: item.type };
  }
  throw new Error(`Unsupported System extension configuration field type: ${type}.`);
}

function readSchemaType(schema: Record<string, unknown>): string {
  const valueSchema = readConfigurationValueSchema(schema);
  if (typeof valueSchema.type !== "string") {
    throw new Error("System extension configuration fields require an explicit type.");
  }
  return valueSchema.type;
}

function readSchemaProperties(schema: Record<string, unknown>): Record<string, Record<string, unknown>> {
  const properties = asSchemaObject(readConfigurationValueSchema(schema).properties, "object properties");
  return Object.fromEntries(
    Object.entries(properties).map(([name, value]) => [name, asSchemaObject(value, `property ${name}`)]),
  );
}

function readConfigurationValueSchema(schema: Record<string, unknown>): Record<string, unknown> {
  if (typeof schema.type === "string") return schema;
  if (Array.isArray(schema.type)) {
    const types = schema.type.filter((entry): entry is string => typeof entry === "string");
    const concreteTypes = types.filter((type) => type !== "null");
    if (schema.type.length === 2 && types.length === 2 && concreteTypes.length === 1 && types.includes("null")) {
      return { ...schema, type: concreteTypes[0] };
    }
  }
  if (Array.isArray(schema.anyOf)) {
    const variants = schema.anyOf.map((variant, index) => asSchemaObject(variant, `anyOf variant ${index}`));
    const nullVariants = variants.filter((variant) => variant.type === "null");
    const concreteVariants = variants.filter((variant) => variant.type !== "null");
    if (nullVariants.length === 1 && concreteVariants.length === 1 && typeof concreteVariants[0]!.type === "string") {
      return { ...schema, ...concreteVariants[0] };
    }
  }
  return schema;
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
