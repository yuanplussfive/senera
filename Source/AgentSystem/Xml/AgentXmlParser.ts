import { XMLParser } from "fast-xml-parser";
import type { AgentXmlProtocolPolicy } from "./AgentXmlPolicy.js";
import { createXmlProtocolSpec } from "./AgentXmlPolicy.js";
import { AgentXmlCodec } from "./AgentXmlCodec.js";
import {
  type AgentXmlParserOptions,
  type ParsedXmlRoot,
} from "./AgentXmlParserTypes.js";
import { AgentXmlSourceHelper } from "./AgentXmlSourceHelper.js";
import {
  AgentOrderedXmlTreeParser,
} from "./AgentOrderedXmlTree.js";
import { AgentXmlSyntaxGuard } from "./AgentXmlSyntaxGuard.js";
import { AgentXmlStructureValidator } from "./AgentXmlStructureValidator.js";
import { assertXmlParserTextLimits } from "./AgentXmlParserTextLimits.js";
import {
  assertXmlDocumentSyntax,
  readSingleParsedRootName,
} from "./AgentXmlDocumentValidator.js";
import { AgentXmlNodeNormalizer } from "./AgentXmlNodeNormalizer.js";

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
  private readonly nodeNormalizer = new AgentXmlNodeNormalizer();

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
    assertXmlParserTextLimits(trimmed, this.options);

    this.syntaxGuard.assertSafe(trimmed, sourceHelper);
    assertXmlDocumentSyntax(trimmed, this.policy, sourceHelper);

    const orderedRoots = this.orderedTreeParser.parseRoots(trimmed);
    this.structureValidator.assertOrderedRoots(orderedRoots, sourceHelper);

    const parsed = this.parser.parse(trimmed) as Record<string, unknown>;
    const rootName = readSingleParsedRootName({
      parsed,
      orderedRoots,
      sourceHelper,
    });
    const normalized = this.nodeNormalizer.normalize({
      rootName,
      value: parsed[rootName],
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

  private isArrayElementName(name: string): boolean {
    const arrayElementNames = this.policy?.arrayElementNames ?? new Set(this.options.arrayElementNames ?? []);
    if (arrayElementNames.has(name)) {
      return true;
    }

    const suffix = this.policy?.arrayElementNameSuffix ?? this.options.arrayElementNameSuffix ?? "";
    return suffix.length > 0 && name.endsWith(suffix);
  }

}
