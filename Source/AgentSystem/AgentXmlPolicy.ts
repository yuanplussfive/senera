import type { AgentSystemConfig } from "./Types.js";

export interface AgentXmlForbiddenSyntaxRule {
  pattern: RegExp;
  label: string;
}

export const AgentXmlPathWildcard = "*" as const;

export type AgentXmlPathSegment = string | typeof AgentXmlPathWildcard;

export interface AgentXmlDecisionRuntimeFieldRule {
  root: string;
  path: readonly AgentXmlPathSegment[];
}

export interface AgentXmlRequiredCdataFieldRule {
  root: string;
  path: readonly string[];
}

export interface AgentXmlProtocolSpec {
  roots: {
    contextUserMessage: string;
    contextToolResults: string;
    toolCalls: string;
    toolResults: string;
    agentResult: string;
  };
  context: {
    userMessageContent: string;
  };
  items: {
    toolCall: string;
    toolResult: string;
    arrayItem: string;
  };
  toolCall: {
    name: string;
    arguments: string;
  };
  toolResult: {
    runtime: string;
    request: string;
    response: string;
    callId: string;
    name: string;
    arguments: string;
    result: string;
  };
  arrayElementNameSuffix: string;
}

export interface AgentXmlProtocolPolicy {
  protocol: AgentXmlProtocolSpec;
  arrayElementNames: ReadonlySet<string>;
  arrayElementNameSuffix: string;
  xmlFenceLanguages: ReadonlySet<string>;
  forbiddenSyntaxRules: readonly AgentXmlForbiddenSyntaxRule[];
  allowBooleanAttributes: boolean;
  maxDecisionTokens: number;
  maxDepth?: number;
  maxTextLength?: number;
  runtimeOnlyDecisionFieldRules: readonly AgentXmlDecisionRuntimeFieldRule[];
  requiredCdataFieldRules: readonly AgentXmlRequiredCdataFieldRule[];
}

export const AgentXmlProtocolDefaults = {
  maxDepth: 16,
  maxDecisionTokens: 32000,
} as const;

export const AgentDefaultXmlProtocolSpec = {
  roots: {
    contextUserMessage: "context_user_message",
    contextToolResults: "context_tool_results",
    toolCalls: "senera_tool_calls",
    toolResults: "tool_results",
    agentResult: "agent_result",
  },
  context: {
    userMessageContent: "content",
  },
  items: {
    toolCall: "tool_call",
    toolResult: "tool_result",
    arrayItem: "item",
  },
  toolCall: {
    name: "name",
    arguments: "arguments",
  },
  toolResult: {
    runtime: "runtime",
    request: "request",
    response: "response",
    callId: "call_id",
    name: "name",
    arguments: "arguments",
    result: "result",
  },
  arrayElementNameSuffix: "_item",
} as const satisfies AgentXmlProtocolSpec;

export function createXmlProtocolSpec(
  config?: Pick<AgentSystemConfig, "XmlProtocol">,
): AgentXmlProtocolSpec {
  return {
    roots: {
      ...AgentDefaultXmlProtocolSpec.roots,
    },
    context: {
      ...AgentDefaultXmlProtocolSpec.context,
    },
    items: {
      ...AgentDefaultXmlProtocolSpec.items,
    },
    toolCall: {
      ...AgentDefaultXmlProtocolSpec.toolCall,
    },
    toolResult: {
      ...AgentDefaultXmlProtocolSpec.toolResult,
    },
    arrayElementNameSuffix:
      config?.XmlProtocol?.ArrayElementNameSuffix
      ?? AgentDefaultXmlProtocolSpec.arrayElementNameSuffix,
  };
}

export function listXmlArrayElementNames(
  protocol: AgentXmlProtocolSpec,
  configuredNames: readonly string[] = [],
): string[] {
  return [...new Set([
    ...configuredNames,
    protocol.items.arrayItem,
    protocol.items.toolCall,
    protocol.items.toolResult,
  ])];
}

export function listRuntimeOnlyDecisionFieldRules(
  protocol: AgentXmlProtocolSpec,
): AgentXmlDecisionRuntimeFieldRule[] {
  return [
    {
      root: protocol.roots.toolCalls,
      path: [
        protocol.items.toolCall,
        AgentXmlPathWildcard,
        protocol.toolResult.callId,
      ],
    },
    {
      root: protocol.roots.toolCalls,
      path: [
        protocol.items.toolCall,
        AgentXmlPathWildcard,
        protocol.toolResult.runtime,
      ],
    },
  ];
}

export function listRequiredCdataFieldRules(
  protocol: AgentXmlProtocolSpec,
): AgentXmlRequiredCdataFieldRule[] {
  void protocol;
  return [];
}

export function createXmlProtocolPolicy(
  config: AgentSystemConfig,
): AgentXmlProtocolPolicy {
  const protocol = createXmlProtocolSpec(config);

  return {
    protocol,
    arrayElementNames: new Set(
      listXmlArrayElementNames(protocol, config.XmlProtocol?.ArrayElementNames ?? []),
    ),
    arrayElementNameSuffix: protocol.arrayElementNameSuffix,
    xmlFenceLanguages: new Set(
      ["", "xml", ...(config.PluginDocumentation?.PromptXml?.XmlFenceLanguages ?? [])]
        .map((item) => item.trim().toLowerCase()),
    ),
    forbiddenSyntaxRules: [
      { pattern: /<!DOCTYPE/i, label: "DOCTYPE" },
      { pattern: /<!ENTITY/i, label: "ENTITY" },
      { pattern: /<\?/i, label: "processing instruction" },
      { pattern: /xmlns[:=]/i, label: "namespace" },
    ],
    allowBooleanAttributes: false,
    maxDepth: config.XmlProtocol?.MaxDepth ?? AgentXmlProtocolDefaults.maxDepth,
    maxTextLength: config.XmlProtocol?.MaxTextLength,
    maxDecisionTokens:
      config.XmlProtocol?.MaxDecisionTokens
      ?? AgentXmlProtocolDefaults.maxDecisionTokens,
    runtimeOnlyDecisionFieldRules: listRuntimeOnlyDecisionFieldRules(protocol),
    requiredCdataFieldRules: listRequiredCdataFieldRules(protocol),
  };
}
