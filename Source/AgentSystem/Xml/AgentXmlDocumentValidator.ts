import { XMLValidator } from "fast-xml-parser";
import type { AgentXmlProtocolPolicy } from "./AgentXmlPolicy.js";
import { AgentXmlErrorCodes } from "./AgentXmlStatus.js";
import { AgentXmlParseError } from "./AgentXmlParserTypes.js";
import type { AgentXmlSourceHelper } from "./AgentXmlSourceHelper.js";
import type { OrderedXmlNode } from "./AgentOrderedXmlTree.js";

export function assertXmlDocumentSyntax(
  xmlText: string,
  policy: AgentXmlProtocolPolicy | undefined,
  sourceHelper: AgentXmlSourceHelper,
): void {
  const validation = XMLValidator.validate(xmlText, {
    allowBooleanAttributes: policy?.allowBooleanAttributes ?? false,
  });

  if (validation === true) {
    return;
  }

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

export function readSingleParsedRootName(options: {
  parsed: Record<string, unknown>;
  orderedRoots: readonly OrderedXmlNode[];
  sourceHelper: AgentXmlSourceHelper;
}): string {
  const rootNames = Object.keys(options.parsed);
  if (options.orderedRoots.length === 1 && rootNames.length === 1) {
    return rootNames[0];
  }

  const message = `XML 必须只有一个根节点，当前有 ${options.orderedRoots.length || rootNames.length} 个。`;
  const suggestion = "只保留一个决策根标签。";
  const secondaryRoot = options.orderedRoots[1];
  const duplicateRootCount = secondaryRoot
    ? options.orderedRoots
      .slice(0, 1 + options.orderedRoots.indexOf(secondaryRoot))
      .filter((root) => root.name === secondaryRoot.name)
      .length - 1
    : 0;
  const diagnostic = secondaryRoot
    ? options.sourceHelper.diagnosticForRoot(message, secondaryRoot.name, suggestion, duplicateRootCount)
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
