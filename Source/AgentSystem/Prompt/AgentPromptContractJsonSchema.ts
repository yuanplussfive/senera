import { createGenerator } from "ts-json-schema-generator/dist/factory/generator.js";

export function createPromptContractJsonSchema(sourceFilePath: string, typeName: string): Record<string, unknown> {
  try {
    return createGenerator({
      path: sourceFilePath,
      type: typeName,
      skipTypeCheck: true,
      expose: "none",
      topRef: false,
      jsDoc: "extended",
      additionalProperties: false,
      functions: "hide",
    }).createSchema(typeName) as Record<string, unknown>;
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

function formatContractProjectionError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const cause = error.cause instanceof Error ? `; ${error.cause.name}: ${error.cause.message}` : "";
  return `${error.name}: ${error.message}${cause}`;
}
