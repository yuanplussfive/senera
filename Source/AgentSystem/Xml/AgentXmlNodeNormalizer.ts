import { AgentXmlErrorCodes } from "./AgentXmlStatus.js";
import {
  AgentXmlParseError,
  type AgentXmlParseErrorCode,
  type XmlPath,
} from "./AgentXmlParserTypes.js";
import type { AgentXmlSourceHelper } from "./AgentXmlSourceHelper.js";

export class AgentXmlNodeNormalizer {
  normalize(options: {
    rootName: string;
    value: unknown;
    sourceHelper: AgentXmlSourceHelper;
  }): unknown {
    return this.normalizeNode(options.value, {
      rootName: options.rootName,
      path: [],
      sourceHelper: options.sourceHelper,
    });
  }

  private normalizeNode(
    node: unknown,
    context: {
      rootName: string;
      path: XmlPath;
      sourceHelper: AgentXmlSourceHelper;
    },
  ): unknown {
    if (Array.isArray(node)) {
      return node.map((item, index) =>
        this.normalizeNode(item, {
          ...context,
          path: [...context.path, index],
        }));
    }

    if (node && typeof node === "object") {
      return this.normalizeObjectNode(node as Record<string, unknown>, context);
    }

    return node;
  }

  private normalizeObjectNode(
    record: Record<string, unknown>,
    context: {
      rootName: string;
      path: XmlPath;
      sourceHelper: AgentXmlSourceHelper;
    },
  ): unknown {
    const normalized: Record<string, unknown> = {};
    const keys = Object.keys(record);
    const textKeys = keys.filter((key) => key === "#text" || key === "#cdata");

    if (textKeys.length > 0 && textKeys.length === keys.length) {
      return textKeys
        .map((key) => this.normalizeTextNodeValue(record[key]))
        .join("");
    }

    if (textKeys.length > 0 && keys.length > textKeys.length) {
      throw this.createPathError({
        code: AgentXmlErrorCodes.MixedXmlContent,
        rootName: context.rootName,
        path: context.path,
        sourceHelper: context.sourceHelper,
        message: "XML 不允许文本和子节点混合出现。",
        suggestion: "把文本放入单独子标签，或者删除嵌套子节点。",
      });
    }

    for (const [key, value] of Object.entries(record)) {
      if (key === "#text" || key === "#cdata") {
        return value;
      }

      normalized[key] = this.normalizeNode(value, {
        ...context,
        path: [...context.path, key],
      });
    }

    return normalized;
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

  private normalizeTextNodeValue(value: unknown): string {
    if (Array.isArray(value)) {
      return value.map((item) => this.normalizeTextNodeValue(item)).join("");
    }

    return String(value ?? "");
  }
}
