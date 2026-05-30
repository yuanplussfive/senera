export type PluginKind =
  | "System"
  | "Tool"
  | "Resource"
  | "Prompt"
  | "Skill"
  | "Adapter"
  | "Provider";

export interface AgentSystemConfig {
  PluginRoots: {
    System: string[];
    User: string[];
  };
  PluginDiscovery?: {
    ManifestFileName?: string;
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
  ModelProviders: AgentModelProviderConfig[];
  AgentLoop?: {
    MaxSteps?: number;
    MaxRepairAttempts?: number;
    LoadedTools?: AgentLoadedToolsConfig;
  };
  ToolSearch?: AgentToolSearchConfig;
  ActionPlanner?: AgentActionPlannerConfig;
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
    MinScore?: number;
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
    MinScore: number;
  };
}

export interface AgentActionPlannerConfig {
  Enabled?: boolean;
  MaxRepairAttempts?: number;
  MaxCatalogTools?: number;
  RecentContextChars?: number;
  ContextBudget?: AgentActionPlannerContextBudgetConfig;
  Client?: AgentActionPlannerClientConfig;
}

export interface AgentActionPlannerContextBudgetConfig {
  MaxRecentDeltas?: number;
  MaxStateCalls?: number;
  MaxEvidence?: number;
  MaxPreviewChars?: number;
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
  MaxCatalogTools: number;
  RecentContextChars: number;
  ContextBudget: Required<AgentActionPlannerContextBudgetConfig>;
  Client: Required<AgentActionPlannerClientConfig>;
}

export interface AgentModelProviderConfig {
  Id: string;
  Title?: string;
  Icon?: string;
  Kind: "OpenAICompatible";
  Endpoint: "Responses" | "ChatCompletions" | "ClaudeMessages" | "GoogleGenerateContent";
  BaseUrl: string;
  ApiKey: string;
  ApiVersion?: string;
  Model: string;
  Temperature: number;
  MaxOutputTokens: number;
  Stream: boolean;
  TimeoutMs: number;
  FirstTokenTimeoutMs?: number;
  MaxRequestMs?: number;
  MaxNetworkRetries: number;
  Headers?: Record<string, string>;
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
}

export interface ToolSearchManifest {
  Summary?: string;
  Keywords?: string[];
  UseCases?: string[];
  Examples?: string[];
  Avoid?: string[];
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
  manifestPath: string;
  manifest: PluginManifest;
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
