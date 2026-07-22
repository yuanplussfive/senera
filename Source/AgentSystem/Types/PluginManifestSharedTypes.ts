import type { ToolSearchManifest } from "./PluginSearchManifestTypes.js";

export type PluginKind = "System" | "Tool" | "Resource" | "Prompt" | "Skill" | "Adapter" | "Provider";

export type PluginRootKind = "System" | "User";

export interface PluginDiscoverySourceManifest {
  Id: string;
  Title: string;
  Description: string;
}

export interface PluginDiscoveryManifest {
  Sources: PluginDiscoverySourceManifest[];
}

export interface PluginPromptingManifest {
  Audience?: "Model" | "User" | "System";
  Priority?: number;
}

export interface PluginMcpServerManifest {
  Id: string;
  Transport: "stdio";
  Command: string;
  Args?: string[];
  Cwd?: string;
  Env?: Record<string, string>;
}

export interface PluginSandboxManifest {
  Network?: "Allow" | "Deny";
  Workspace?: {
    Read?: string[];
    Write?: string[];
  };
  State?: {
    Write?: string[];
  };
}

export interface PromptManifest {
  Name: string;
  Template: string;
}

export interface TemplateManifest {
  Name: string;
  Path: string;
  Description?: string;
  ExposeToPi?: boolean;
  Search?: ToolSearchManifest;
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
