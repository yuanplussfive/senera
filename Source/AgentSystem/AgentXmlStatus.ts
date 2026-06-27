export const AgentXmlErrorCodes = {
  EmptyDecisionXml: "EmptyDecisionXml",
  DecisionXmlTokenLimitExceeded: "DecisionXmlTokenLimitExceeded",
  DecisionXmlTooLong: "DecisionXmlTooLong",
  InvalidXmlSyntax: "InvalidXmlSyntax",
  InvalidXmlEnvelope: "InvalidXmlEnvelope",
  XmlEnvelopePrefixText: "XmlEnvelopePrefixText",
  XmlEnvelopeSuffixText: "XmlEnvelopeSuffixText",
  XmlEnvelopeOrphanClosingTag: "XmlEnvelopeOrphanClosingTag",
  XmlEnvelopeExtraRoot: "XmlEnvelopeExtraRoot",
  IncompleteXmlEnvelope: "IncompleteXmlEnvelope",
  ForbiddenXmlSyntax: "ForbiddenXmlSyntax",
  MultipleDecisionRoots: "MultipleDecisionRoots",
  MixedXmlContent: "MixedXmlContent",
  DuplicateSiblingTag: "DuplicateSiblingTag",
  RequiredCdataMissing: "RequiredCdataMissing",
  RequiredCdataMixedContent: "RequiredCdataMixedContent",
  XmlAttributesNotAllowed: "XmlAttributesNotAllowed",
  XmlDepthExceeded: "XmlDepthExceeded",
  InvalidDecisionPayload: "InvalidDecisionPayload",
  UnknownDecisionRoot: "UnknownDecisionRoot",
  ForbiddenOutputXml: "ForbiddenOutputXml",
} as const;

export const AgentExecutionErrorCodes = {
  UnknownToolName: "UnknownToolName",
  InvalidToolArguments: "InvalidToolArguments",
  PluginExecutionError: "PluginExecutionError",
  ToolProcessConfigurationInvalid: "ToolProcessConfigurationInvalid",
  ToolProcessRuntimeUnsupported: "ToolProcessRuntimeUnsupported",
  ToolProcessSpawnFailed: "ToolProcessSpawnFailed",
  ToolProcessTimeout: "ToolProcessTimeout",
  ToolProcessCancelled: "ToolProcessCancelled",
  ToolProcessStdoutLimitExceeded: "ToolProcessStdoutLimitExceeded",
  ToolProcessStderrLimitExceeded: "ToolProcessStderrLimitExceeded",
  ToolProcessResponseMissing: "ToolProcessResponseMissing",
  ToolProcessResponseInvalid: "ToolProcessResponseInvalid",
  ToolProcessResponseEnvelopeInvalid: "ToolProcessResponseEnvelopeInvalid",
} as const;

export const AgentProtocolErrorCodes = {
  ...AgentXmlErrorCodes,
  ...AgentExecutionErrorCodes,
} as const;

export type AgentXmlErrorCode =
  typeof AgentXmlErrorCodes[keyof typeof AgentXmlErrorCodes];

export type AgentExecutionErrorCode =
  typeof AgentExecutionErrorCodes[keyof typeof AgentExecutionErrorCodes];

export type AgentProtocolErrorCode =
  typeof AgentProtocolErrorCodes[keyof typeof AgentProtocolErrorCodes];

export function isAgentExecutionErrorCode(value: unknown): value is AgentExecutionErrorCode {
  return typeof value === "string" && value in AgentExecutionErrorCodes;
}

export function isAgentProtocolErrorCode(value: unknown): value is AgentProtocolErrorCode {
  return typeof value === "string" && value in AgentProtocolErrorCodes;
}

export const AgentToolProcessErrorPhases = {
  ConfigurationValidation: "configuration_validation",
  ProcessSpawn: "process_spawn",
  SchemaValidation: "schema_validation",
  RuntimeExecution: "runtime_execution",
  ResponseParsing: "response_parsing",
  ResponseValidation: "response_validation",
} as const;

export type AgentToolProcessErrorPhase =
  typeof AgentToolProcessErrorPhases[keyof typeof AgentToolProcessErrorPhases];

export const AgentXmlEnvelopeKinds = {
  Collecting: "collecting",
  Ready: "ready",
  Invalid: "invalid",
} as const;

export type AgentXmlEnvelopeKind =
  typeof AgentXmlEnvelopeKinds[keyof typeof AgentXmlEnvelopeKinds];

export const AgentXmlTailKinds = {
  Empty: "empty",
  ClosingFence: "closing_fence",
  ClosingFencePrefix: "closing_fence_prefix",
  TrailingText: "trailing_text",
  OrphanClosingTag: "orphan_closing_tag",
  ExtraRoot: "extra_root",
  IncompleteXml: "incomplete_xml",
} as const;

export type AgentXmlTailKind =
  typeof AgentXmlTailKinds[keyof typeof AgentXmlTailKinds];

export const AgentXmlStreamStates = {
  Collecting: "collecting",
  RootClosed: "root_closed",
  Invalid: "invalid",
} as const;

export type AgentXmlStreamState =
  typeof AgentXmlStreamStates[keyof typeof AgentXmlStreamStates];

export function tailKindToErrorCode(kind: AgentXmlTailKind): AgentXmlErrorCode | undefined {
  const mapping: Partial<Record<AgentXmlTailKind, AgentXmlErrorCode>> = {
    [AgentXmlTailKinds.TrailingText]: AgentXmlErrorCodes.XmlEnvelopeSuffixText,
    [AgentXmlTailKinds.OrphanClosingTag]: AgentXmlErrorCodes.XmlEnvelopeOrphanClosingTag,
    [AgentXmlTailKinds.ExtraRoot]: AgentXmlErrorCodes.XmlEnvelopeExtraRoot,
    [AgentXmlTailKinds.IncompleteXml]: AgentXmlErrorCodes.IncompleteXmlEnvelope,
  };
  return mapping[kind];
}
