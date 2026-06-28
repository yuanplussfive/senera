export type PluginKind =
  | "System"
  | "Tool"
  | "Resource"
  | "Prompt"
  | "Skill"
  | "Adapter"
  | "Provider";

export type PluginRootKind = "System" | "User";

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
  SignatureType?: string;
}

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
