import { pathToFileURL } from "node:url";
import { ZodError, type ZodType } from "zod";
import { toRuntimeModulePath } from "./AgentPath.js";

export class AgentSchemaValidationError extends Error {
  constructor(
    message: string,
    readonly issues: ZodError["issues"],
    readonly schemaPath: string,
  ) {
    super(message);
  }
}

export class AgentSchemaValidator {
  private readonly schemas = new Map<string, ZodType>();

  async validate(schemaPath: string, value: unknown): Promise<unknown> {
    const schema = await this.getSchema(schemaPath);
    const result = schema.safeParse(value);

    if (!result.success) {
      throw new AgentSchemaValidationError(
        `Zod 校验失败：${schemaPath}。`,
        result.error.issues,
        schemaPath,
      );
    }

    return result.data;
  }

  private async getSchema(schemaPath: string): Promise<ZodType> {
    const cached = this.schemas.get(schemaPath);
    if (cached) {
      return cached;
    }

    const modulePath = toRuntimeModulePath(schemaPath);
    const imported = (await import(pathToFileURL(modulePath).href)) as Record<string, unknown>;
    const schema = (imported.Schema ?? imported.default) as ZodType | undefined;

    if (!schema?.safeParse) {
      throw new Error(`Schema 模块必须导出 Schema 或默认 Zod schema：${schemaPath}`);
    }

    this.schemas.set(schemaPath, schema);
    return schema;
  }
}
