import type { AgentXmlProtocolPolicy } from "./AgentXmlPolicy.js";
import { AgentXmlErrorCodes } from "./AgentXmlStatus.js";
import {
  AgentXmlParseError,
  type AgentXmlParseErrorCode,
  type XmlPath,
} from "./AgentXmlParserTypes.js";
import { AgentXmlSourceHelper } from "./AgentXmlSourceHelper.js";

export class AgentXmlParsedValueValidator {
  constructor(
    private readonly options: {
      policy?: AgentXmlProtocolPolicy;
      maxDepth?: number;
    },
  ) {}

  assertParsedValue(
    value: unknown,
    context: {
      rootName: string;
      sourceHelper: AgentXmlSourceHelper;
    },
  ): void {
    this.assertNoAttributes(value, {
      ...context,
      path: [],
    });
    this.assertDepth(value, {
      ...context,
      path: [],
    }, 1);
  }

  private assertNoAttributes(
    node: unknown,
    context: {
      rootName: string;
      path: XmlPath;
      sourceHelper: AgentXmlSourceHelper;
    },
  ): void {
    if (Array.isArray(node)) {
      node.forEach((item, index) =>
        this.assertNoAttributes(item, {
          ...context,
          path: [...context.path, index],
        }));
      return;
    }

    if (!node || typeof node !== "object") {
      return;
    }

    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key.startsWith("@_")) {
        const attributePath = [...context.path, key];
        const readablePath = renderXmlPath(context.rootName, attributePath);
        throw this.createPathError({
          code: AgentXmlErrorCodes.XmlAttributesNotAllowed,
          rootName: context.rootName,
          path: attributePath,
          sourceHelper: context.sourceHelper,
          message: `XML 不允许属性：${readablePath}。`,
          suggestion: "把属性改成子标签。",
          details: {
            path: readablePath,
            attribute: key,
          },
        });
      }

      this.assertNoAttributes(value, {
        ...context,
        path: [...context.path, key],
      });
    }
  }

  private assertDepth(
    node: unknown,
    context: {
      rootName: string;
      path: XmlPath;
      sourceHelper: AgentXmlSourceHelper;
    },
    depth: number,
  ): void {
    const maxDepth = this.options.policy?.maxDepth ?? this.options.maxDepth ?? 16;
    if (depth > maxDepth) {
      const readablePath = renderXmlPath(context.rootName, context.path);
      throw this.createPathError({
        code: AgentXmlErrorCodes.XmlDepthExceeded,
        rootName: context.rootName,
        path: context.path,
        sourceHelper: context.sourceHelper,
        message: `XML 深度超过 ${maxDepth}：${readablePath}。`,
        suggestion: "减少嵌套层级，只保留决策所需字段。",
        details: {
          path: readablePath,
          depth,
          maxDepth,
        },
      });
    }

    if (Array.isArray(node)) {
      node.forEach((item, index) =>
        this.assertDepth(item, {
          ...context,
          path: [...context.path, index],
        }, depth + 1));
      return;
    }

    if (!node || typeof node !== "object") {
      return;
    }

    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      this.assertDepth(value, {
        ...context,
        path: [...context.path, key],
      }, depth + 1);
    }
  }

  private createPathError(options: {
    code: AgentXmlParseErrorCode;
    rootName: string;
    path: XmlPath;
    sourceHelper: AgentXmlSourceHelper;
    message: string;
    suggestion: string;
    details?: Record<string, unknown>;
  }): AgentXmlParseError {
    const diagnostic = options.sourceHelper.diagnosticForPath(
      options.message,
      options.rootName,
      options.path,
      options.suggestion,
    );

    return new AgentXmlParseError(options.message, [
      diagnostic,
    ], options.code, {
      ...options.details,
      pointer: diagnostic.pointer,
      line: diagnostic.position?.line,
      column: diagnostic.position?.column,
    });
  }
}

function renderXmlPath(rootName: string, path: XmlPath): string {
  const segments = [rootName, ...path];
  let output = "";

  for (const segment of segments) {
    output = typeof segment === "number"
      ? `${output}[${segment}]`
      : output.length === 0
        ? segment
        : `${output}.${segment}`;
  }

  return output;
}
