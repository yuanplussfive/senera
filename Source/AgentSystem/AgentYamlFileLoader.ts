import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { ZodError, type ZodType } from "zod";

export class AgentYamlFileError extends Error {
  constructor(
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export class AgentYamlFileLoader {
  load<T>(filePath: string, schema: ZodType<T>): T {
    const absolutePath = path.resolve(filePath);
    const text = fs.readFileSync(absolutePath, "utf8");

    let parsed: unknown;
    try {
      parsed = YAML.parse(text);
    } catch (error) {
      throw new AgentYamlFileError(
        `YAML 语法错误：${absolutePath}`,
        error instanceof Error ? error.message : String(error),
      );
    }

    const result = schema.safeParse(parsed);
    if (!result.success) {
      throw new AgentYamlFileError(
        `YAML 结构校验失败：${absolutePath}`,
        this.formatZodError(result.error),
      );
    }

    return result.data;
  }

  private formatZodError(error: ZodError): string {
    return error.issues
      .map((issue) => {
        const issuePath = issue.path.length > 0 ? issue.path.join(".") : "<root>";
        return `${issuePath}: ${issue.message}`;
      })
      .join("; ");
  }
}
