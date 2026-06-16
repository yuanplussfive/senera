export type PluginKind =
  | "System"
  | "Tool"
  | "Resource"
  | "Prompt"
  | "Skill"
  | "Adapter"
  | "Provider";

export type PluginRootKind = "System" | "User";

export interface AgentDefaultsConfig {
  PluginRoots?: {
    System?: string[];
    User?: string[];
  };
  PluginDiscovery?: {
    ManifestFileName?: string;
    ConfigFileName?: string;
  };
  ModelProviderDefaults?: AgentModelRuntimeDefaultsConfig;
  Cli?: AgentCliConfig;
  ToolExecution?: {
    Mode?: "Process";
    TimeoutMs?: number;
    MaxStdoutBytes?: number;
    MaxStderrBytes?: number;
  };
  AgentLoop?: {
    MaxSteps?: number;
    MaxRepairAttempts?: number;
    LoadedTools?: AgentLoadedToolsConfig;
  };
  ToolSearch?: AgentToolSearchConfig;
  Artifacts?: AgentArtifactsConfig;
  Uploads?: AgentUploadsConfig;
  ActionPlanner?: AgentActionPlannerConfig;
  Frontend?: AgentFrontendConfig;
  Server?: {
    Host?: string;
    Port?: number;
    HotReload?: boolean;
    RequestMaxBytes?: number;
  };
  Persistence?: {
    Kind?: "sqlite" | "memory";
    DatabasePath?: string;
  };
}

export interface AgentSystemConfig {
  Defaults?: AgentDefaultsConfig;
  PluginRoots?: {
    System?: string[];
    User?: string[];
  };
  PluginDiscovery?: {
    ManifestFileName?: string;
    ConfigFileName?: string;
  };
  XmlProtocol?: {
    MaxDepth?: number;
    MaxTextLength?: number;
    MaxDecisionTokens?: number;
    MaxToolCalls?: number;
    ArrayElementNames?: string[];
    ArrayElementNameSuffix?: string;
  };
  ToolExecution?: {
    Mode?: "Process";
    TimeoutMs?: number;
    MaxStdoutBytes?: number;
    MaxStderrBytes?: number;
  };
  PluginDocumentation?: {
    Markdown?: {
      MinNonEmptyLines?: number;
      ExcludePathFragments?: string[];
    };
    ToolDescription?: {
      MinNonEmptyLines?: number;
      SummarySection?: string;
      TriggerSection?: string;
      AvoidSection?: string;
      RequiredSections?: string[];
    };
    DecisionActionDescription?: {
      MinNonEmptyLines?: number;
      SummarySection?: string;
      TriggerSection?: string;
      AvoidSection?: string;
      RequiredSections?: string[];
    };
    PromptXml?: {
      XmlFenceLanguages?: string[];
      CodeFenceLanguages?: string[];
    };
  };
  DefaultModelProviderId?: string;
  ModelProviderDefaults?: AgentModelProviderDefaultsConfig;
  ModelProviders: AgentModelProviderConfig[];
  Cli?: AgentCliConfig;
  AgentLoop?: {
    MaxSteps?: number;
    MaxRepairAttempts?: number;
    LoadedTools?: AgentLoadedToolsConfig;
  };
  ToolSearch?: AgentToolSearchConfig;
  Artifacts?: AgentArtifactsConfig;
  Uploads?: AgentUploadsConfig;
  ActionPlanner?: AgentActionPlannerConfig;
  Frontend?: AgentFrontendConfig;
  Server?: {
    Host?: string;
    Port?: number;
    HotReload?: boolean;
    RequestMaxBytes?: number;
  };
  Persistence?: {
    Kind?: "sqlite" | "memory";
    DatabasePath?: string;
  };
}

export type AgentLoadedToolsConfig = "all" | "dynamic" | string[];

export interface ResolvedAgentPluginRootsConfig {
  System: string[];
  User: string[];
}

export interface ResolvedAgentPluginDiscoveryConfig {
  ManifestFileName: string;
  ConfigFileName: string;
}

export interface ResolvedAgentToolExecutionConfig {
  Mode: "Process";
  TimeoutMs: number;
  MaxStdoutBytes: number;
  MaxStderrBytes: number;
}

export interface AgentToolSearchConfig {
  Dynamic?: {
    BootstrapTools?: string[];
  };
  Memory?: {
    Kind?: "sqlite" | "memory";
    DatabasePath?: string;
    MaxEpisodes?: number;
    HalfLifeDays?: number;
  };
  Ranking?: {
    RrfK?: number;
    MmrLambda?: number;
    MmrCandidateScoreRatio?: number;
    MinScore?: number;
  };
  Rerank?: {
    Enabled?: boolean;
    CandidateLimit?: number;
    ScoreScale?: number;
    FeatureWeights?: Record<string, number>;
  };
}

export interface ResolvedAgentToolSearchConfig {
  Dynamic: {
    BootstrapTools: string[];
  };
  Memory: {
    Kind: "sqlite" | "memory";
    DatabasePath: string;
    MaxEpisodes: number;
    HalfLifeDays: number;
  };
  Ranking: {
    RrfK: number;
    MmrLambda: number;
    MmrCandidateScoreRatio: number;
    MinScore: number;
  };
  Rerank: {
    Enabled: boolean;
    CandidateLimit: number;
    ScoreScale: number;
    FeatureWeights: Record<string, number>;
  };
}

export interface AgentArtifactsConfig {
  RootDir?: string;
  SummaryMaxChars?: number;
  RawJsonMaxBytes?: number;
  TextFileMaxBytes?: number;
}

export interface ResolvedAgentArtifactsConfig {
  RootDir: string;
  SummaryMaxChars: number;
  RawJsonMaxBytes: number;
  TextFileMaxBytes: number;
}

export interface AgentUploadsConfig {
  RootDir?: string;
  MaxFileBytes?: number;
}

export interface ResolvedAgentUploadsConfig {
  RootDir: string;
  MaxFileBytes: number;
}

export interface AgentActionPlannerConfig {
  Enabled?: boolean;
  MaxRepairAttempts?: number;
  Client?: AgentActionPlannerClientConfig;
}

export type AgentActionPlannerClientProvider =
  | "auto"
  | "openai-generic"
  | "openai-responses"
  | "anthropic"
  | "google-ai";

export interface AgentActionPlannerClientConfig {
  Provider?: AgentActionPlannerClientProvider;
  BaseUrl?: string;
  ApiKey?: string;
  Model?: string;
  Temperature?: number;
  /** -1 means do not send a provider token limit field. */
  MaxTokens?: number;
}

export interface ResolvedAgentActionPlannerConfig {
  Enabled: boolean;
  MaxRepairAttempts: number;
  Client: Required<AgentActionPlannerClientConfig>;
}

export interface AgentFrontendServerConfig {
  Host?: string;
  Port?: number;
  StrictPort?: boolean;
}

export interface AgentFrontendClientConfig {
  WebSocketUrl?: string;
  ModelLabel?: string;
  UserName?: string;
  EmptySuggestions?: string[];
}

export interface AgentFrontendConfig {
  DevServer?: AgentFrontendServerConfig;
  PreviewServer?: AgentFrontendServerConfig;
  Client?: AgentFrontendClientConfig;
}

export interface ResolvedAgentFrontendConfig {
  DevServer: Required<AgentFrontendServerConfig>;
  PreviewServer: Required<AgentFrontendServerConfig>;
  Client: Required<AgentFrontendClientConfig>;
}

export interface AgentModelProviderConfig {
  Id: string;
  Title?: string;
  Icon?: string;
  Kind?: "OpenAICompatible";
  Endpoint: "Responses" | "ChatCompletions" | "ClaudeMessages" | "GoogleGenerateContent";
  BaseUrl?: string;
  ApiKey?: string;
  ApiVersion?: string;
  Model: string;
  Temperature?: number;
  MaxOutputTokens?: number;
  Stream?: boolean;
  TimeoutMs?: number;
  FirstTokenTimeoutMs?: number;
  MaxRequestMs?: number;
  MaxNetworkRetries?: number;
  Headers?: Record<string, string>;
}

export interface AgentModelProviderDefaultsConfig {
  Kind?: "OpenAICompatible";
  BaseUrl?: string;
  ApiKey?: string;
  ApiVersion?: string;
  Temperature?: number;
  MaxOutputTokens?: number;
  Stream?: boolean;
  TimeoutMs?: number;
  FirstTokenTimeoutMs?: number;
  MaxRequestMs?: number;
  MaxNetworkRetries?: number;
  Headers?: Record<string, string>;
}

export interface AgentModelRuntimeDefaultsConfig extends AgentModelProviderDefaultsConfig {
  Id?: string;
  Title?: string;
  Icon?: string;
  Endpoint?: "Responses" | "ChatCompletions" | "ClaudeMessages" | "GoogleGenerateContent";
  Model?: string;
}

export interface ResolvedAgentModelProviderConfig {
  Id: string;
  Title?: string;
  Icon?: string;
  Kind: "OpenAICompatible";
  Endpoint: "Responses" | "ChatCompletions" | "ClaudeMessages" | "GoogleGenerateContent";
  BaseUrl: string;
  ApiKey: string;
  ApiVersion: string;
  Model: string;
  Temperature: number;
  MaxOutputTokens: number;
  Stream: boolean;
  TimeoutMs: number;
  FirstTokenTimeoutMs: number;
  MaxRequestMs: number;
  MaxNetworkRetries: number;
  Headers: Record<string, string>;
}

export interface ResolvedAgentPersistenceConfig {
  Kind: "sqlite" | "memory";
  DatabasePath: string;
}

export interface AgentModelProviderListItem {
  id: string;
  title: string;
  icon?: string;
  kind: ResolvedAgentModelProviderConfig["Kind"];
  endpoint: ResolvedAgentModelProviderConfig["Endpoint"];
  baseUrl: string;
  model: string;
  isDefault: boolean;
}

export interface AgentCliConfig {
  Connection?: {
    Url?: string;
    SessionId?: string;
    TimeoutMs?: number;
  };
  Display?: {
    EventDisplayMode?: "activity" | "compact" | "verbose";
    DetailMode?: "none" | "errors" | "tools" | "xml" | "all";
    ShowXml?: boolean;
    StreamXml?: boolean;
    LivePreview?: boolean;
    PreviewMode?: "block" | "line";
    PreviewTokenLimit?: number;
  };
}

export interface PluginManifest {
  Plugin: {
    Name: string;
    Title?: string;
    Version: string;
    Kind: PluginKind;
    Description?: string;
    Entry?: PluginEntryManifest;
  };
  Compatibility?: Record<string, unknown>;
  Discovery?: {
    Tags?: string[];
  };
  DecisionActions?: DecisionActionManifest[];
  Tools?: ToolManifest[];
  Resources?: unknown[];
  Prompts?: PromptManifest[];
  Templates?: TemplateManifest[];
  Security?: PluginSecurityManifest;
  Prompting?: PluginPromptingManifest;
}

export interface PluginPromptingManifest {
  Audience?: "Model" | "User" | "System";
  Priority?: number;
}

export interface PluginEntryManifest {
  Kind: "Process";
  Command: string;
  Args?: string[];
  Cwd?: string;
  Env?: Record<string, string>;
}

export interface DecisionActionManifest {
  Name: string;
  Kind: "ToolCalls";
  XmlRoot: string;
  Schema: string;
  DescriptionFile?: string;
  SignatureFile?: string;
}

export interface ToolManifest {
  Name: string;
  DescriptionFile?: string;
  SignatureFile?: string;
  Permissions?: string[];
  Handler?: ToolHandlerManifest;
  Search?: ToolSearchManifest;
  Artifacts?: ToolArtifactPolicyManifest;
  ArtifactPolicyFile?: string;
}

export interface ToolSearchManifest {
  Summary?: string;
  Keywords?: string[];
  Capabilities?: ToolSearchCapabilityManifest[];
  UseCases?: string[];
  Examples?: string[];
  Avoid?: string[];
}

export interface ToolSearchCapabilityManifest {
  Id: string;
  Title?: string;
  Description?: string;
  Facets?: ToolSearchCapabilityFacetsManifest;
  Aliases?: string[];
  Examples?: string[];
  Avoid?: string[];
  Risk?: ToolSearchCapabilityRiskManifest;
  Metadata?: Record<string, unknown>;
}

export interface ToolSearchCapabilityFacetsManifest {
  Actions?: string[];
  Targets?: string[];
  Inputs?: string[];
  Outputs?: string[];
  Evidence?: string[];
  Effects?: string[];
}

export interface ToolSearchCapabilityRiskManifest {
  SideEffect?: string;
  Permission?: string;
  Notes?: string[];
}

export interface ToolArtifactPolicyManifest {
  Redact?: ToolArtifactRedactionManifest;
  Evidence?: ToolArtifactEvidenceManifest[];
  Summary?: ToolArtifactSummaryManifest;
  Workspace?: ToolArtifactWorkspaceManifest;
}

export interface ToolArtifactRedactionManifest {
  Keys?: string[];
  Paths?: string[];
}

export interface ToolArtifactEvidenceManifest {
  Kind: string;
  Records: string;
  Slots: Record<string, ToolArtifactEvidenceSlotManifest>;
  Identity: ToolArtifactEvidenceIdentityManifest;
  Presentation: ToolArtifactEvidencePresentationManifest;
  ModelProjection: ToolArtifactEvidenceModelProjectionManifest;
  PlannerMemory: ToolArtifactEvidencePlannerMemoryManifest;
  Projection: ToolArtifactEvidenceProjectionManifest;
  Confidence: number;
  When?: string | ToolArtifactConditionManifest;
  Metadata?: Record<string, ToolArtifactEvidenceSlotManifest>;
}

export type ToolArtifactEvidenceSlotScope = "Record" | "Root";

export type ToolArtifactEvidenceSlotManifest =
  | string
  | ToolArtifactEvidenceSlotObjectManifest;

export interface ToolArtifactEvidenceSlotObjectManifest {
  Selector: string;
  Scope?: ToolArtifactEvidenceSlotScope;
}

export interface ToolArtifactEvidenceIdentityManifest {
  Parts: Array<string | ToolArtifactEvidenceIdentityPartManifest>;
}

export interface ToolArtifactEvidenceIdentityPartManifest {
  Slot: string;
  Required?: boolean;
}

export interface ToolArtifactEvidencePresentationManifest {
  RefPrefix: string;
  Locator: string;
  Display: string;
  Label: string;
  Source: string;
}

export interface ToolArtifactEvidenceModelProjectionManifest {
  Slots: string[];
}

export interface ToolArtifactEvidencePlannerMemoryManifest {
  Facts: string[];
  ArtifactRefs?: string[];
}

export interface ToolArtifactEvidenceProjectionManifest {
  SummaryTemplate: string;
  ArtifactTemplate: string;
}

export interface ToolArtifactConditionManifest {
  Selector: string;
  Exists?: boolean;
  Equals?: string | number | boolean | null;
  In?: Array<string | number | boolean | null>;
}

export interface ToolArtifactSummaryManifest {
  Template: string;
  ArtifactTemplate: string;
}

export interface ToolArtifactWorkspaceManifest {
  Capture?: "none" | "declared";
  Paths?: ToolArtifactWorkspacePathManifest[];
  MaxFileBytes?: number;
  MaxFiles?: number;
  MaxDirectoryDepth?: number;
  CaptureContent?: "none" | "text";
  PatchContextLines: number;
}

export interface ToolArtifactWorkspacePathManifest {
  Selector: string;
  Base?: string;
}

export type ToolHandlerManifest =
  | {
      Kind: "PluginProcess";
    }
  | {
      Kind: "HostCapability";
      Capability: string;
    };

export type RegisteredToolHandler =
  | {
      kind: "PluginProcess";
    }
  | {
      kind: "HostCapability";
      capability: string;
    };

export interface PromptManifest {
  Name: string;
  Template: string;
}

export interface TemplateManifest {
  Name: string;
  Path: string;
}

export interface PluginSecurityManifest {
  TrustLevel?: "System" | "Local" | "External" | "Untrusted";
  Network?: "Allow" | "Deny";
  FileSystem?: {
    Read?: string[];
    Write?: string[];
  };
  RequiresApproval?: boolean;
}

export interface LoadedPlugin {
  rootPath: string;
  rootKind: PluginRootKind;
  manifestPath: string;
  config: LoadedPluginConfig;
  manifest: PluginManifest;
}

export interface LoadedPluginConfig {
  fileName: string;
  path: string;
  exists: boolean;
  toml: string;
  sections: LoadedPluginConfigSection[];
  runtime: LoadedPluginRuntimeConfig;
  diagnostics: LoadedPluginConfigDiagnostic[];
}

export interface LoadedPluginConfigSection {
  name: string;
  label?: string;
  description?: string;
  keyCount: number;
  toml: string;
  fields: LoadedPluginConfigField[];
}

export interface LoadedPluginConfigField {
  label?: string;
  section: string;
  key: string;
  path: string[];
  type: LoadedPluginConfigFieldType;
  itemType?: LoadedPluginConfigFieldType;
  value: unknown;
  description?: string;
  placeholder?: string;
  options?: LoadedPluginConfigFieldOptionValue[];
  optionLabels?: Record<string, string>;
  min?: number;
  max?: number;
  step?: number;
  secret?: boolean;
  multiline?: boolean;
}

export type LoadedPluginConfigFieldType =
  | "boolean"
  | "string"
  | "number"
  | "array"
  | "table"
  | "unknown";

export type LoadedPluginConfigFieldOptionValue = string | number | boolean;

export interface LoadedPluginRuntimeConfig {
  enabled: boolean;
  tools: Record<string, LoadedPluginToolRuntimeConfig>;
}

export interface LoadedPluginToolRuntimeConfig {
  enabled?: boolean;
}

export interface LoadedPluginConfigDiagnostic {
  severity: "error" | "warning";
  message: string;
}

export interface AgentPluginConfigSnapshotItem {
  name: string;
  title: string;
  kind: PluginKind;
  rootKind: PluginRootKind;
  description?: string;
  rootPath: string;
  manifestPath: string;
  configPath: string;
  configExists: boolean;
  enabled: boolean;
  available: boolean;
  toolCount: number;
  enabledToolCount: number;
  tools: AgentPluginConfigToolItem[];
  sections: LoadedPluginConfigSection[];
  toml: string;
  diagnostics: LoadedPluginConfigDiagnostic[];
}

export interface AgentPluginConfigToolItem {
  name: string;
  summary?: string;
  enabled: boolean;
}

export interface RegisteredDecisionAction {
  plugin: LoadedPlugin;
  name: string;
  kind: DecisionActionManifest["Kind"];
  xmlRoot: string;
  schemaPath: string;
  descriptionFile?: string;
  signatureFile?: string;
}

export interface RegisteredTool {
  plugin: LoadedPlugin;
  name: string;
  descriptionFile?: string;
  signatureFile?: string;
  permissions: string[];
  handler: RegisteredToolHandler;
  search?: ToolSearchManifest;
  artifactPolicy?: ToolArtifactPolicyManifest;
}

export interface RegisteredTemplate {
  plugin: LoadedPlugin;
  name: string;
  path: string;
}

export type AgentDecision =
  {
    kind: "ToolCalls";
    root: string;
    source: AgentDecisionSource;
    payload: ToolCallsDecision;
  };

export interface AgentDecisionSource {
  xml: string;
}

export interface ToolCallsDecision {
  tool_call: ToolCallDecision[];
}

export interface ToolCallDecision {
  name: string;
  arguments?: Record<string, unknown>;
}

export interface ExecutedToolCallResult {
  callId: string;
  name: string;
  arguments: Record<string, unknown>;
  process: {
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    stderr: string;
  };
  result: unknown;
  artifact?: ExecutedToolCallArtifact;
  artifactPolicy?: ToolArtifactPolicyManifest;
  workspaceCapture?: ToolWorkspaceCaptureResult;
}

export interface ExecutedToolCallArtifact {
  artifactId: string;
  artifactUri: string;
  artifactPath: string;
  relativePath: string;
  manifestPath: string;
  files: Record<string, string>;
  summary: string;
  evidence: ToolArtifactEvidenceRecord[];
  delta: ToolArtifactDeltaRecord[];
  workspace?: ToolWorkspaceCaptureResult;
}

export interface ToolWorkspaceCaptureResult {
  before: ToolWorkspaceSnapshot;
  after: ToolWorkspaceSnapshot;
  changes: ToolWorkspaceChange[];
}

export interface ToolWorkspaceSnapshot {
  files: ToolWorkspaceFileSnapshot[];
  capturedAt: string;
  warnings?: string[];
}

export interface ToolWorkspaceFileSnapshot {
  path: string;
  absolutePath: string;
  exists: boolean;
  kind: "file" | "directory" | "missing" | "other" | "symlink";
  size: number;
  mtimeMs: number;
  hash: string;
  content?: ToolWorkspaceFileContentSnapshot;
  target?: string;
}

export type ToolWorkspaceFileContentSnapshot =
  | {
      state: "captured";
      encoding: "utf8";
      byteLength: number;
      lineCount: number;
      text?: string;
      artifactPath?: string;
      relativeArtifactPath?: string;
    }
  | {
      state: "omitted";
      reason: "missing" | "directory" | "size_limit" | "binary" | "not_requested" | "unsupported";
      byteLength?: number;
    };

export interface ToolWorkspaceChangePatch {
  status: "generated" | "skipped";
  reason?: string;
  path?: string;
  relativePath?: string;
}

export interface ToolWorkspaceChange {
  path: string;
  absolutePath: string;
  status: "added" | "modified" | "deleted" | "unchanged" | "type_changed";
  beforeKind: ToolWorkspaceFileSnapshot["kind"];
  afterKind: ToolWorkspaceFileSnapshot["kind"];
  beforeHash: string;
  afterHash: string;
  beforeSize: number;
  afterSize: number;
  patch?: ToolWorkspaceChangePatch;
}

export interface ToolArtifactEvidenceRecord {
  key: string;
  ref: string;
  kind: string;
  locator: string;
  display: string;
  label: string;
  source: string;
  confidence: number;
  slots?: Record<string, unknown>;
  modelSlots: ToolArtifactEvidenceModelSlotRecord[];
  plannerMemory: ToolArtifactEvidencePlannerMemoryRecord;
  metadata?: Record<string, unknown>;
}

export interface ToolArtifactEvidenceModelSlotRecord {
  name: string;
  value: string;
}

export interface ToolArtifactEvidencePlannerMemoryRecord {
  facts: ToolArtifactEvidenceModelSlotRecord[];
  artifactRefs: string[];
}

export interface ToolArtifactDeltaRecord {
  kind: string;
  key: string;
  status: "added" | "changed" | "unchanged";
  summary: string;
  metadata?: Record<string, unknown>;
}

export interface ToolExecutionContext {
  tool: RegisteredTool;
  arguments: Record<string, unknown>;
  registry: AgentPluginRegistryLike;
}

export interface AgentPluginRegistryLike {
  getTool(name: string): RegisteredTool | undefined;
}

export interface AgentToolProcessRequest {
  protocol: string;
  tool: string;
  arguments: Record<string, unknown>;
}

export interface AgentToolProcessError {
  code: import("./AgentXmlStatus.js").AgentExecutionErrorCode;
  message: string;
  diagnostics?: import("./AgentSourceDiagnostic.js").AgentSourceDiagnostic[];
  details?: {
    phase?: import("./AgentXmlStatus.js").AgentToolProcessErrorPhase;
    issues?: unknown;
    modulePath?: string;
    runtime?: string;
    timeoutMs?: number;
    maxStdoutBytes?: number;
    maxStderrBytes?: number;
    actualBytes?: number;
    protocol?: string;
    expectedProtocol?: string;
    receivedLine?: string;
    parseError?: string;
    pluginName?: string;
    toolName?: string;
    exitCode?: number | null;
    signal?: NodeJS.Signals | null;
    [key: string]: unknown;
  };
}

export interface AgentToolProcessResponse {
  protocol: string;
  ok: boolean;
  result?: unknown;
  error?: AgentToolProcessError;
}
