import type { AgentXmlProtocolPolicy } from "./AgentXmlPolicy.js";
import { AgentXmlErrorCodes } from "./AgentXmlStatus.js";
import { AgentXmlParseError, type AgentXmlParseErrorCode, type XmlPath } from "./AgentXmlParserTypes.js";
import { type AgentXmlSourceHelper } from "./AgentXmlSourceHelper.js";
import type { OrderedXmlNode } from "./AgentOrderedXmlTree.js";
import { type AgentOrderedXmlTreeParser } from "./AgentOrderedXmlTree.js";
import { AgentXmlParsedValueValidator } from "./AgentXmlParsedValueValidator.js";

export class AgentXmlStructureValidator {
  constructor(
    private readonly options: {
      policy?: AgentXmlProtocolPolicy;
      maxDepth?: number;
      arrayElementNames?: string[];
      arrayElementNameSuffix?: string;
    },
    private readonly orderedTreeParser: AgentOrderedXmlTreeParser,
  ) {
    this.parsedValueValidator = new AgentXmlParsedValueValidator({
      policy: options.policy,
      maxDepth: options.maxDepth,
    });
  }

  private readonly parsedValueValidator: AgentXmlParsedValueValidator;

  assertOrderedRoots(roots: OrderedXmlNode[], sourceHelper: AgentXmlSourceHelper): void {
    if (roots.length !== 1) {
      return;
    }

    const [root] = roots;
    this.assertNoIllegalRepeatedSiblingsInNode(root.name, root, sourceHelper);
    this.assertRequiredCdataFields(root, sourceHelper);
  }

  assertParsedValue(
    value: unknown,
    context: {
      rootName: string;
      sourceHelper: AgentXmlSourceHelper;
    },
  ): void {
    this.parsedValueValidator.assertParsedValue(value, context);
  }

  private assertNoIllegalRepeatedSiblingsInNode(
    rootName: string,
    node: OrderedXmlNode,
    sourceHelper: AgentXmlSourceHelper,
  ): void {
    const siblingNames = new Map<string, OrderedXmlNode[]>();

    for (const child of node.children) {
      const existing = siblingNames.get(child.name) ?? [];
      existing.push(child);
      siblingNames.set(child.name, existing);
    }

    for (const [name, siblings] of siblingNames.entries()) {
      if (siblings.length <= 1 || this.isArrayElementName(name)) {
        continue;
      }

      const second = siblings[1];
      const diagnostic = sourceHelper.diagnosticForPath(
        `XML 不允许重复标签：${name}。`,
        rootName,
        second.path,
        `只有声明为数组的标签才允许重复。请合并或删除多余的 <${name}> 标签。`,
      );
      throw new AgentXmlParseError(
        `XML 不允许重复标签：${name}。`,
        [diagnostic],
        AgentXmlErrorCodes.DuplicateSiblingTag,
        {
          tagName: name,
          pointer: diagnostic.pointer,
        },
      );
    }

    for (const child of node.children) {
      this.assertNoIllegalRepeatedSiblingsInNode(rootName, child, sourceHelper);
    }
  }

  private assertRequiredCdataFields(root: OrderedXmlNode, sourceHelper: AgentXmlSourceHelper): void {
    const rules = this.options.policy?.requiredCdataFieldRules ?? [];

    for (const rule of rules) {
      if (rule.root !== root.name) {
        continue;
      }

      const target = this.orderedTreeParser.findNodeByPath(root, rule.path);
      if (!target) {
        continue;
      }

      const hasCdata = target.content.some((item) => item.kind === "cdata");
      const hasPlainText = target.content.some((item) => item.kind === "text" && item.text.trim().length > 0);
      const hasElements = target.content.some((item) => item.kind === "element");
      const readablePath = renderXmlPath(rule.root, [...rule.path]);
      const tagName = rule.path[rule.path.length - 1] ?? target.name;

      if (!hasCdata) {
        throw this.createPathError({
          code: AgentXmlErrorCodes.RequiredCdataMissing,
          rootName: rule.root,
          path: target.path,
          sourceHelper,
          message: `字段文本包装不符合协议：${readablePath}。`,
          suggestion: `把正文作为 <${tagName}> 的文本内容输出，并保持标签完整闭合。`,
          details: {
            path: readablePath,
            requiredWrapper: "CDATA",
          },
        });
      }

      if (hasPlainText || hasElements) {
        throw this.createPathError({
          code: AgentXmlErrorCodes.RequiredCdataMixedContent,
          rootName: rule.root,
          path: target.path,
          sourceHelper,
          message: `字段文本包装不符合协议：${readablePath}。`,
          suggestion: `删除 <${tagName}> 内多余的嵌套子节点，保留单一文本内容。`,
          details: {
            path: readablePath,
            hasPlainText,
            hasElements,
          },
        });
      }

      if (target.content.some((item) => item.kind === "cdata" && item.text.includes("]]>"))) {
        throw this.createPathError({
          code: AgentXmlErrorCodes.RequiredCdataMixedContent,
          rootName: rule.root,
          path: target.path,
          sourceHelper,
          message: `字段文本包含非法结束标记：${readablePath}。`,
          suggestion: `改写 <${tagName}> 的正文，避免直接包含 XML 结束标记片段。`,
          details: {
            path: readablePath,
            reason: "cdata_contains_closing_token",
          },
        });
      }
    }
  }

  private isArrayElementName(name: string): boolean {
    const arrayElementNames = this.options.policy?.arrayElementNames ?? new Set(this.options.arrayElementNames ?? []);
    if (arrayElementNames.has(name)) {
      return true;
    }

    const suffix = this.options.policy?.arrayElementNameSuffix ?? this.options.arrayElementNameSuffix ?? "";
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

    return new AgentXmlParseError(options.message, [diagnostic], options.code, {
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
    output =
      typeof segment === "number" ? `${output}[${segment}]` : output.length === 0 ? segment : `${output}.${segment}`;
  }

  return output;
}
