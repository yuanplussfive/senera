import { XMLParser, XMLValidator } from "fast-xml-parser";
import { AgentSourceDiagnosticBuilder } from "./AgentSourceDiagnostic.js";
import type { AgentXmlProtocolPolicy } from "./AgentXmlPolicy.js";
import { createXmlProtocolSpec } from "./AgentXmlPolicy.js";
import { AgentXmlErrorCodes } from "./AgentXmlStatus.js";
import { AgentXmlCodec } from "./AgentXmlCodec.js";
import {
  AgentXmlParseError,
  type AgentXmlParseErrorCode,
  type AgentXmlParserOptions,
  type ParsedXmlRoot,
  type XmlPath,
} from "./AgentXmlParserTypes.js";
import { AgentXmlSourceHelper } from "./AgentXmlSourceHelper.js";
import {
  AgentOrderedXmlTreeParser,
} from "./AgentOrderedXmlTree.js";
import { AgentXmlSyntaxGuard } from "./AgentXmlSyntaxGuard.js";
import { AgentXmlStructureValidator } from "./AgentXmlStructureValidator.js";

export type {
  AgentXmlParseErrorCode,
  AgentXmlParserOptions,
  ParsedXmlRoot,
} from "./AgentXmlParserTypes.js";
export { AgentXmlParseError } from "./AgentXmlParserTypes.js";
export { AgentXmlSourceHelper } from "./AgentXmlSourceHelper.js";

export class AgentXmlParser {
  private readonly parser: XMLParser;
  private readonly orderedTreeParser: AgentOrderedXmlTreeParser;
  private readonly syntaxGuard: AgentXmlSyntaxGuard;
  private readonly structureValidator: AgentXmlStructureValidator;
  private readonly policy?: AgentXmlProtocolPolicy;
  private readonly codec: AgentXmlCodec;

  constructor(private readonly options: AgentXmlParserOptions = {}) {
    this.policy = options.policy;
    this.codec = new AgentXmlCodec(
      options.policy?.protocol ?? createXmlProtocolSpec(),
    );
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      allowBooleanAttributes: options.policy?.allowBooleanAttributes ?? false,
      trimValues: true,
      parseTagValue: false,
      parseAttributeValue: false,
      alwaysCreateTextNode: false,
      cdataPropName: "#cdata",
      isArray: (name) => this.isArrayElementName(name),
    });
    this.orderedTreeParser = new AgentOrderedXmlTreeParser({
      allowBooleanAttributes: options.policy?.allowBooleanAttributes ?? false,
    });
    this.syntaxGuard = new AgentXmlSyntaxGuard(this.policy);
    this.structureValidator = new AgentXmlStructureValidator({
      policy: this.policy,
      maxDepth: options.maxDepth,
      arrayElementNames: options.arrayElementNames,
      arrayElementNameSuffix: options.arrayElementNameSuffix,
    }, this.orderedTreeParser);
  }

  parse(xmlText: string): ParsedXmlRoot {
    const trimmed = xmlText.trim();
    const sourceHelper = new AgentXmlSourceHelper(trimmed);
    if (!trimmed) {
      throw new AgentXmlParseError("XML 输出为空。", [
        {
          message: "XML 输出为空。",
          suggestion: "输出一个已注册的决策根标签。",
        },
      ], AgentXmlErrorCodes.EmptyDecisionXml);
    }

    const tokenBudget = this.options.textBudget?.measure(trimmed);
    if (tokenBudget?.state === "limit_reached") {
      throw new AgentXmlParseError("XML 输出超过最大 token 限制。", [
        new AgentSourceDiagnosticBuilder(trimmed).fromPosition(
          "XML 输出超过最大 token 限制。",
          0,
          {
            pointer: "/",
            suggestion: "只输出必要的 XML 决策，不要附加解释文本或冗余字段。",
          },
        ),
      ], AgentXmlErrorCodes.DecisionXmlTokenLimitExceeded, {
        model: tokenBudget.model,
        encodingName: tokenBudget.encodingName,
        resolution: tokenBudget.resolution,
        tokenCount: tokenBudget.tokenCount,
        tokenLimit: tokenBudget.tokenLimit,
        exceededTokens: tokenBudget.exceededTokens,
      });
    }

    if (this.options.maxTextLength !== undefined && trimmed.length > this.options.maxTextLength) {
      throw new AgentXmlParseError("XML 输出超过最大长度。", [
        {
          message: "XML 输出超过最大长度。",
          suggestion: "只输出必要的 XML 决策，不要附加解释文本。",
        },
      ], AgentXmlErrorCodes.DecisionXmlTooLong, {
        length: trimmed.length,
        maxLength: this.options.maxTextLength,
      });
    }

    this.syntaxGuard.assertSafe(trimmed, sourceHelper);

    const validation = XMLValidator.validate(trimmed, {
      allowBooleanAttributes: this.policy?.allowBooleanAttributes ?? false,
    });

    if (validation !== true) {
      throw new AgentXmlParseError(`XML 格式无效：${validation.err.msg}`, [
        sourceHelper.diagnosticFromLineColumn(
          `XML 格式无效：${validation.err.msg}`,
          validation.err.line,
          validation.err.col,
          "修复 XML 标签闭合、嵌套或非法字符。",
        ),
      ], AgentXmlErrorCodes.InvalidXmlSyntax, {
        line: validation.err.line,
        column: validation.err.col,
      });
    }

    const orderedRoots = this.orderedTreeParser.parseRoots(trimmed);
    this.structureValidator.assertOrderedRoots(orderedRoots, sourceHelper);

    const parsed = this.parser.parse(trimmed) as Record<string, unknown>;
    const rootNames = Object.keys(parsed);

    if (orderedRoots.length !== 1 || rootNames.length !== 1) {
      const message = `XML 必须只有一个根节点，当前有 ${orderedRoots.length || rootNames.length} 个。`;
      const suggestion = "只保留一个决策根标签。";
      const secondaryRoot = orderedRoots[1];
      const duplicateRootCount = secondaryRoot
        ? orderedRoots
          .slice(0, 1 + orderedRoots.indexOf(secondaryRoot))
          .filter((root) => root.name === secondaryRoot.name)
          .length - 1
        : 0;
      const diagnostic = secondaryRoot
        ? sourceHelper.diagnosticForRoot(message, secondaryRoot.name, suggestion, duplicateRootCount)
        : {
            message,
            suggestion,
          };

      throw new AgentXmlParseError(message, [
        diagnostic,
      ], AgentXmlErrorCodes.MultipleDecisionRoots, {
        rootNames,
        pointer: diagnostic.pointer,
        line: diagnostic.position?.line,
        column: diagnostic.position?.column,
      });
    }

    const rootName = rootNames[0];
    const normalized = this.normalizeNode(parsed[rootName], {
      rootName,
      path: [],
      sourceHelper,
    });
    const value = normalized === "" ? {} : normalized;
    this.structureValidator.assertParsedValue(value, {
      rootName,
      sourceHelper,
    });

    return {
      rootName,
      value,
      source: trimmed,
      diagnostics: sourceHelper,
    };
  }

  serialize(rootName: string, value: unknown): string {
    return this.codec.objectToXml(
      rootName,
      value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : { value },
    );
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
      const record = node as Record<string, unknown>;
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

    return node;
  }

  private isArrayElementName(name: string): boolean {
    const arrayElementNames = this.policy?.arrayElementNames ?? new Set(this.options.arrayElementNames ?? []);
    if (arrayElementNames.has(name)) {
      return true;
    }

    const suffix = this.policy?.arrayElementNameSuffix ?? this.options.arrayElementNameSuffix ?? "";
    return suffix.length > 0 && name.endsWith(suffix);
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
