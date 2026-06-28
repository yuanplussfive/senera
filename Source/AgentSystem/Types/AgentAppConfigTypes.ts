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

export interface AgentCliConfig {
  Connection?: {
    Url?: string;
    SessionId?: string;
    TimeoutSeconds?: number;
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
