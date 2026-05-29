import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { AgentSourceDiagnostic } from "./AgentSourceDiagnostic.js";
import { AgentSourceDiagnosticBuilder } from "./AgentSourceDiagnostic.js";
import type { AgentTextBudgetEvaluator } from "./AgentTextBudget.js";
import type { AgentXmlProtocolPolicy } from "./AgentXmlPolicy.js";
import { createXmlProtocolSpec } from "./AgentXmlPolicy.js";
import { AgentXmlErrorCodes, type AgentXmlErrorCode } from "./AgentXmlStatus.js";
import { AgentXmlCodec } from "./AgentXmlCodec.js";

export interface ParsedXmlRoot {
  rootName: string;
  value: unknown;
  source: string;
  diagnostics: AgentXmlSourceHelper;
}

export type AgentXmlParseErrorCode = AgentXmlErrorCode;

export class AgentXmlParseError extends Error {
  constructor(
    message: string,
    readonly diagnostics: AgentSourceDiagnostic[],
    readonly code: AgentXmlParseErrorCode,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export class AgentXmlSourceHelper {
  private readonly builder: AgentSourceDiagnosticBuilder;

  constructor(readonly source: string) {
    this.builder = new AgentSourceDiagnosticBuilder(source);
  }

  diagnosticForRoot(
    message: string,
    rootName: string,
    suggestion?: string,
    occurrence = 0,
  ): AgentSourceDiagnostic {
    const position = this.builder.findXmlTag(rootName, occurrence);
    if (!position) {
      return {
        message,
        suggestion,
      };
    }

    return this.builder.fromPosition(message, position.position, {
      pointer: `/${rootName}`,
      suggestion,
    });
  }

  diagnosticForPath(
    message: string,
    rootName: string,
    path: Array<string | number>,
    suggestion?: string,
  ): AgentSourceDiagnostic {
    const xmlPath = [rootName, ...path];
    const resolved = this.findNearestPath(xmlPath);
    const position = resolved ? this.builder.findXmlTagByPath(resolved) : undefined;
    const pointer = this.pathToPointer(xmlPath);

    if (!position) {
      return {
        message,
        path,
        pointer,
        suggestion,
      };
    }

    return this.builder.fromPosition(message, position.position, {
      path,
      pointer,
      suggestion,
    });
  }

  diagnosticFromLineColumn(
    message: string,
    line: number,
    column: number,
    suggestion?: string,
  ): AgentSourceDiagnostic {
    return this.builder.fromLineColumn(message, line, column, {
      suggestion,
    });
  }

  diagnosticForOffset(
    message: string,
    offset: number,
    suggestion?: string,
    options: {
      pointer?: string;
      path?: Array<string | number>;
    } = {},
  ): AgentSourceDiagnostic {
    return this.builder.fromPosition(message, offset, {
      pointer: options.pointer,
      path: options.path,
      suggestion,
    });
  }

  positionFromOffset(offset: number) {
    return this.builder.positionFromOffset(offset);
  }

  private pathToPointer(path: Array<string | number>): string {
    if (path.length === 0) {
      return "";
    }

    let pointer = "";

    for (const part of path) {
      if (typeof part === "number") {
        pointer += `[${part}]`;
        continue;
      }

      const escaped = String(part).replace(/~/g, "~0").replace(/\//g, "~1");
      pointer += `/${escaped}`;
    }

    return pointer;
  }

  private findNearestPath(path: Array<string | number>): Array<string | number> | undefined {
    for (let length = path.length; length >= 1; length -= 1) {
      const candidate = path.slice(0, length);
      if (this.builder.findXmlTagByPath(candidate)) {
        return candidate;
      }
    }

    return undefined;
  }
}

export interface AgentXmlParserOptions {
  maxDepth?: number;
  maxTextLength?: number;
  arrayElementNames?: string[];
  arrayElementNameSuffix?: string;
  textBudget?: AgentTextBudgetEvaluator;
  policy?: AgentXmlProtocolPolicy;
}

type XmlPath = Array<string | number>;

type OrderedXmlContent =
  | {
      kind: "element";
      node: OrderedXmlNode;
    }
  | {
      kind: "text";
      text: string;
    }
  | {
      kind: "cdata";
      text: string;
    };

type OrderedXmlNode = {
  name: string;
  content: OrderedXmlContent[];
  children: OrderedXmlNode[];
  path: XmlPath;
};

export class AgentXmlParser {
  private readonly parser: XMLParser;
  private readonly orderedParser: XMLParser;
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
    this.orderedParser = new XMLParser({
      preserveOrder: true,
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      allowBooleanAttributes: options.policy?.allowBooleanAttributes ?? false,
      trimValues: true,
      parseTagValue: false,
      parseAttributeValue: false,
      alwaysCreateTextNode: false,
      cdataPropName: "#cdata",
    });
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

    this.rejectForbiddenSyntax(trimmed);
    this.rejectUnclosedCdata(trimmed, sourceHelper);

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

    const orderedRoots = this.parseOrderedRoots(trimmed);
    this.assertNoIllegalRepeatedSiblings(orderedRoots, sourceHelper);

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
    const orderedRoot = orderedRoots[0];
    if (orderedRoot) {
      this.assertRequiredCdataFields(orderedRoot, sourceHelper);
    }
    const normalized = this.normalizeNode(parsed[rootName], {
      rootName,
      path: [],
      sourceHelper,
    });
    const value = normalized === "" ? {} : normalized;
    this.assertNoAttributes(value, {
      rootName,
      path: [],
      sourceHelper,
    });
    this.assertDepth(value, {
      rootName,
      path: [],
      sourceHelper,
    }, 1);

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

  private rejectForbiddenSyntax(xmlText: string): void {
    const forbiddenPatterns = this.policy?.forbiddenSyntaxRules ?? [];
    // 把宿主已封装的文本区段替换成等长空白，让禁止规则只检查真实 XML 结构。
    const masked = xmlText.replace(
      /<!\[CDATA\[[\s\S]*?\]\]>/g,
      (match) => " ".repeat(match.length),
    );

    for (const item of forbiddenPatterns) {
      if (item.pattern.test(masked)) {
        const builder = new AgentSourceDiagnosticBuilder(xmlText);
        const match = item.pattern.exec(masked);
        throw new AgentXmlParseError(`XML 使用了禁止语法：${item.label}。`, [
          builder.fromPosition(`XML 使用了禁止语法：${item.label}。`, match?.index ?? 0, {
            suggestion: "删除 DOCTYPE、ENTITY、namespace 或处理指令；参数文本中的特殊字符请保持为普通文本或使用 XML 实体转义。",
          }),
        ], AgentXmlErrorCodes.ForbiddenXmlSyntax, {
          syntax: item.label,
        });
      }
    }
  }

  private rejectUnclosedCdata(
    xmlText: string,
    sourceHelper: AgentXmlSourceHelper,
  ): void {
    let index = 0;

    while (index < xmlText.length) {
      const start = xmlText.indexOf("<![CDATA[", index);
      if (start === -1) {
        return;
      }

      const end = xmlText.indexOf("]]>", start + "<![CDATA[".length);
      if (end === -1) {
        const position = sourceHelper.positionFromOffset(start);
        throw new AgentXmlParseError("XML 中存在未闭合的 CDATA。", [
          sourceHelper.diagnosticForOffset(
            "XML 中存在未闭合的 CDATA。",
            start,
            "修正字段正文和外层标签闭合；不要把文本片段插入标签名、开始标签或结束标签中。",
            {
              pointer: "/",
            },
          ),
        ], AgentXmlErrorCodes.InvalidXmlSyntax, {
          pointer: "/",
          line: position.line,
          column: position.column,
          reason: "unclosed_cdata",
        });
      }

      index = end + "]]>".length;
    }
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

  private assertNoIllegalRepeatedSiblings(
    roots: OrderedXmlNode[],
    sourceHelper: AgentXmlSourceHelper,
  ): void {
    if (roots.length !== 1) {
      return;
    }

    const [root] = roots;
    this.assertNoIllegalRepeatedSiblingsInNode(root.name, root, sourceHelper);
  }

  private parseOrderedRoots(
    xmlText: string,
  ): OrderedXmlNode[] {
    const parsed = this.orderedParser.parse(xmlText) as unknown[];
    const roots: OrderedXmlNode[] = [];

    for (const item of parsed) {
      const rootEntry = this.readOrderedElementEntry(item);
      if (rootEntry) {
        roots.push(this.toOrderedNode(rootEntry, []));
      }
    }

    return roots;
  }

  private readOrderedElementEntry(
    value: unknown,
  ): { name: string; children: unknown[] } | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }

    const record = value as Record<string, unknown>;
    const elementEntries = Object.entries(record).filter(
      ([key]) => key !== "#text" && key !== ":@",
    );

    if (elementEntries.length !== 1) {
      return undefined;
    }

    const [name, children] = elementEntries[0];
    return {
      name,
      children: Array.isArray(children) ? children : [],
    };
  }

  private toOrderedNode(
    entry: { name: string; children: unknown[] },
    path: Array<string | number>,
  ): OrderedXmlNode {
    const childOccurrences = new Map<string, number>();
    const content: OrderedXmlContent[] = [];
    const children: OrderedXmlNode[] = [];

    for (const rawChild of entry.children) {
      const text = this.readOrderedTextNode(rawChild);
      if (text !== undefined) {
        content.push({
          kind: "text",
          text,
        });
        continue;
      }

      const cdata = this.readOrderedCdataNode(rawChild);
      if (cdata !== undefined) {
        content.push({
          kind: "cdata",
          text: cdata,
        });
        continue;
      }

      const childEntry = this.readOrderedElementEntry(rawChild);
      if (!childEntry) {
        continue;
      }

      const occurrence = childOccurrences.get(childEntry.name) ?? 0;
      childOccurrences.set(childEntry.name, occurrence + 1);
      const childNode = this.toOrderedNode(childEntry, [...path, childEntry.name, occurrence]);
      content.push({
        kind: "element",
        node: childNode,
      });
      children.push(childNode);
    }

    return {
      name: entry.name,
      content,
      children,
      path,
    };
  }

  private readOrderedTextNode(value: unknown): string | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }

    const record = value as Record<string, unknown>;
    if (!("#text" in record) || Object.keys(record).length !== 1) {
      return undefined;
    }

    return String(record["#text"] ?? "");
  }

  private readOrderedCdataNode(value: unknown): string | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }

    const record = value as Record<string, unknown>;
    if (!("#cdata" in record) || Object.keys(record).length !== 1) {
      return undefined;
    }

    return this.readOrderedTextPayload(record["#cdata"]);
  }

  private readOrderedTextPayload(value: unknown): string {
    if (typeof value === "string") {
      return value;
    }

    if (Array.isArray(value)) {
      return value
        .map((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) {
            return "";
          }

          const record = item as Record<string, unknown>;
          return "#text" in record ? String(record["#text"] ?? "") : "";
        })
        .join("");
    }

    if (value && typeof value === "object" && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      return "#text" in record ? String(record["#text"] ?? "") : "";
    }

    return "";
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
      throw new AgentXmlParseError(`XML 不允许重复标签：${name}。`, [
        diagnostic,
      ], AgentXmlErrorCodes.DuplicateSiblingTag, {
        tagName: name,
        pointer: diagnostic.pointer,
      });
    }

    for (const child of node.children) {
      this.assertNoIllegalRepeatedSiblingsInNode(rootName, child, sourceHelper);
    }
  }

  private assertRequiredCdataFields(
    root: OrderedXmlNode,
    sourceHelper: AgentXmlSourceHelper,
  ): void {
    const rules = this.policy?.requiredCdataFieldRules ?? [];

    for (const rule of rules) {
      if (rule.root !== root.name) {
        continue;
      }

      const target = this.findOrderedNodeByPath(root, rule.path);
      if (!target) {
        continue;
      }

      const hasCdata = target.content.some((item) => item.kind === "cdata");
      const hasPlainText = target.content.some((item) =>
        item.kind === "text" && item.text.trim().length > 0);
      const hasElements = target.content.some((item) => item.kind === "element");
      const readablePath = this.renderPath(rule.root, [...rule.path]);
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

  private findOrderedNodeByPath(
    root: OrderedXmlNode,
    path: readonly string[],
  ): OrderedXmlNode | undefined {
    let current: OrderedXmlNode | undefined = root;

    for (const segment of path) {
      current = current?.children.find((child) => child.name === segment);
      if (!current) {
        return undefined;
      }
    }

    return current;
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
        const readablePath = this.renderPath(context.rootName, attributePath);
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
    const maxDepth = this.policy?.maxDepth ?? this.options.maxDepth ?? 16;
    if (depth > maxDepth) {
      const readablePath = this.renderPath(context.rootName, context.path);
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

  private renderPath(rootName: string, path: XmlPath): string {
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

  private normalizeTextNodeValue(value: unknown): string {
    if (Array.isArray(value)) {
      return value.map((item) => this.normalizeTextNodeValue(item)).join("");
    }

    return String(value ?? "");
  }
}
