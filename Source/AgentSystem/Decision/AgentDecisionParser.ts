import type { RegisteredDecisionAction } from "../Types/PluginRuntimeTypes.js";
import type { AgentDecision } from "../Types/ToolRuntimeTypes.js";
import { AgentPluginRegistry } from "../Plugin/AgentPluginRegistry.js";
import {
  AgentSchemaValidationError,
  AgentSchemaValidator,
} from "../Core/AgentSchemaValidator.js";
import { AgentXmlParser } from "../Xml/AgentXmlParser.js";
import {
  AgentDecisionXmlSanitizer,
  type SanitizedDecisionXml,
} from "./AgentDecisionXmlSanitizer.js";
import type { AgentXmlProtocolPolicy } from "../Xml/AgentXmlPolicy.js";
import { AgentDecisionErrorFactory } from "./AgentDecisionErrorFactory.js";
import { AgentDecisionRuntimeFieldNormalizer } from "./AgentDecisionRuntimeFieldNormalizer.js";
import { readXmlRootName } from "../Xml/AgentXmlRootReader.js";
import { AgentXmlSourceHelper } from "../Xml/AgentXmlParser.js";
import type { AgentXmlCandidateNormalizer } from "../Xml/AgentToolCallsXmlNormalizer.js";

type ProjectableDecisionKind = RegisteredDecisionAction["kind"];
const DecisionKindProjection = {
  ToolCalls: "ToolCalls",
} as const satisfies Record<ProjectableDecisionKind, AgentDecision["kind"]>;

export class AgentDecisionParser {
  private readonly sanitizer: AgentDecisionXmlSanitizer;
  private readonly runtimeFieldNormalizer?: AgentDecisionRuntimeFieldNormalizer;
  private readonly errors: AgentDecisionErrorFactory;

  constructor(
    private readonly xmlParser: AgentXmlParser,
    private readonly registry: AgentPluginRegistry,
    private readonly schemaValidator: AgentSchemaValidator,
    options: {
      xmlFenceLanguages?: string[];
      policy?: AgentXmlProtocolPolicy;
      errorFactory?: AgentDecisionErrorFactory;
      candidateNormalizer?: AgentXmlCandidateNormalizer;
    } = {},
  ) {
    this.sanitizer = new AgentDecisionXmlSanitizer({
      xmlFenceLanguages: options.xmlFenceLanguages,
      policy: options.policy,
      candidateNormalizer: options.candidateNormalizer,
    });
    this.runtimeFieldNormalizer = options.policy
      ? new AgentDecisionRuntimeFieldNormalizer(options.policy)
      : undefined;
    this.errors = options.errorFactory ?? new AgentDecisionErrorFactory();
  }

  async parse(xmlText: string): Promise<AgentDecision> {
    return this.parseSanitized(xmlText).then((result) => result.decision);
  }

  async parseSanitized(xmlText: string): Promise<{
    decision: AgentDecision;
    sanitized: SanitizedDecisionXml;
  }> {
    let sanitized: SanitizedDecisionXml;
    const allowedRoots = new Set(this.registry.listDecisionActions().map((item) => item.xmlRoot));
    try {
      sanitized = this.sanitizer.sanitize(xmlText, {
        acceptRoot: (rootName) => allowedRoots.has(rootName),
      });
    } catch (error) {
      throw this.errors.fromSanitizerFailure(error);
    }

    const action = this.findDecisionActionOrThrow(sanitized.xml);

    let root;
    try {
      root = this.xmlParser.parse(sanitized.xml);
    } catch (error) {
      throw this.errors.fromXmlParseFailure(error);
    }

    const normalized = this.runtimeFieldNormalizer?.normalize(
      root.rootName,
      root.value,
      (message, path, suggestion) =>
        root.diagnostics.diagnosticForPath(message, root.rootName, path, suggestion),
    );
    const normalizedValue = normalized?.value ?? root.value;

    let payload;
    try {
      payload = await this.schemaValidator.validate(action.schemaPath, normalizedValue);
    } catch (error) {
      if (error instanceof AgentSchemaValidationError) {
        throw this.errors.invalidDecisionPayload({
          rootName: root.rootName,
          source: root.diagnostics,
          error,
        });
      }

      throw error;
    }

    return {
      decision: this.projectDecision(action, {
        root: root.rootName,
        xml: normalized?.changed
          ? this.xmlParser.serialize(root.rootName, normalizedValue)
          : root.source,
        payload,
      }),
      sanitized,
    };
  }

  private findDecisionActionOrThrow(xml: string): RegisteredDecisionAction {
    if (xml.trim().length === 0) {
      throw this.errors.emptyDecisionXml();
    }

    const rootName = readXmlRootName(xml);
    const allowedRoots = this.registry.listDecisionActions().map((item) => item.xmlRoot);
    if (!rootName) {
      throw this.errors.invalidDecisionRoot({
        source: new AgentXmlSourceHelper(xml),
        allowedRoots,
      });
    }

    const action = this.registry.getDecisionActionByRoot(rootName);

    if (action) {
      return action;
    }

    throw this.errors.unknownDecisionRoot({
      rootName,
      source: new AgentXmlSourceHelper(xml),
      allowedRoots,
    });
  }

  private projectDecision(
    action: RegisteredDecisionAction,
    input: {
      root: string;
      xml: string;
      payload: unknown;
    },
  ): AgentDecision {
    return {
      kind: DecisionKindProjection[action.kind],
      root: input.root,
      source: {
        xml: input.xml,
      },
      payload: input.payload,
    } as AgentDecision;
  }
}
