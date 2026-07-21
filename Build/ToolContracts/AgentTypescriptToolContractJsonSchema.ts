import { createGenerator } from "ts-json-schema-generator/dist/factory/generator.js";

interface ContractSchemaGeneratorCacheEntry {
  sourceDigest: string;
  generator: ReturnType<typeof createGenerator>;
  schemas: Map<string, Record<string, unknown>>;
}

export class AgentTypescriptToolContractJsonSchemaCatalog {
  private readonly generators = new Map<string, ContractSchemaGeneratorCacheEntry>();

  create(sourceFilePath: string, typeName: string, sourceDigest: string): Record<string, unknown> {
    try {
      const cached = this.generators.get(sourceFilePath);
      const entry =
        cached?.sourceDigest === sourceDigest ? cached : this.createGeneratorEntry(sourceFilePath, sourceDigest);
      const schema = entry.schemas.get(typeName);
      if (schema) return schema;

      const generated = deepFreeze(entry.generator.createSchema(typeName) as Record<string, unknown>);
      entry.schemas.set(typeName, generated);
      return generated;
    } catch (error) {
      throw new Error(
        [
          `ToolSignature JSON Schema 生成失败：${sourceFilePath}`,
          `type: ${typeName}`,
          `cause: ${formatContractProjectionError(error)}`,
        ].join("\n"),
        { cause: error },
      );
    }
  }

  private createGeneratorEntry(sourceFilePath: string, sourceDigest: string): ContractSchemaGeneratorCacheEntry {
    const entry = {
      sourceDigest,
      generator: createGenerator({
        path: sourceFilePath,
        type: "*",
        skipTypeCheck: true,
        expose: "none",
        topRef: false,
        jsDoc: "extended",
        additionalProperties: false,
        functions: "hide",
      }),
      schemas: new Map<string, Record<string, unknown>>(),
    };
    this.generators.set(sourceFilePath, entry);
    return entry;
  }
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  return Object.freeze(value);
}

function formatContractProjectionError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const cause = error.cause instanceof Error ? `; ${error.cause.name}: ${error.cause.message}` : "";
  return `${error.name}: ${error.message}${cause}`;
}
