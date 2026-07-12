export const AgentXmlErrorCodes = {
  EmptyXml: "EmptyXml",
  XmlTokenLimitExceeded: "XmlTokenLimitExceeded",
  XmlTooLong: "XmlTooLong",
  InvalidXmlSyntax: "InvalidXmlSyntax",
  ForbiddenXmlSyntax: "ForbiddenXmlSyntax",
  MultipleDecisionRoots: "MultipleDecisionRoots",
  MixedXmlContent: "MixedXmlContent",
  DuplicateSiblingTag: "DuplicateSiblingTag",
  RequiredCdataMissing: "RequiredCdataMissing",
  RequiredCdataMixedContent: "RequiredCdataMixedContent",
  XmlAttributesNotAllowed: "XmlAttributesNotAllowed",
  XmlDepthExceeded: "XmlDepthExceeded",
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

export type AgentXmlErrorCode = (typeof AgentXmlErrorCodes)[keyof typeof AgentXmlErrorCodes];

export type AgentExecutionErrorCode = (typeof AgentExecutionErrorCodes)[keyof typeof AgentExecutionErrorCodes];

export type AgentProtocolErrorCode = (typeof AgentProtocolErrorCodes)[keyof typeof AgentProtocolErrorCodes];

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

export type AgentToolProcessErrorPhase = (typeof AgentToolProcessErrorPhases)[keyof typeof AgentToolProcessErrorPhases];
