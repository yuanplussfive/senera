export type PluginKind =
  | "System"
  | "Tool"
  | "Resource"
  | "Prompt"
  | "Skill"
  | "Adapter"
  | "Provider";

export type PluginRootKind = "System" | "User";


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
  DecisionActions?: DecisionActionManifest[];
  Tools?: ToolManifest[];
  Skills?: SkillManifest[];
  Agents?: AgentManifest[];
  ContextPacks?: AgentContextPackManifest[];
  Workflows?: AgentWorkflowManifest[];
  MergePolicies?: AgentMergePolicyManifest[];
  Resources?: unknown[];
  Prompts?: PromptManifest[];
  Templates?: TemplateManifest[];
  RootCommands?: RootCommandManifest[];
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
  SignatureType?: string;
}

export interface ToolManifest {
  Name: string;
  DescriptionFile?: string;
  SignatureFile?: string;
  SignatureType?: string;
  Permissions?: string[];
  Handler?: ToolHandlerManifest;
  Search?: ToolSearchManifest;
  EvidenceCapabilities?: ToolEvidenceCapabilityManifest[];
  Artifacts?: ToolArtifactPolicyManifest;
  ArtifactPolicyFile?: string;
}

export interface ToolEvidenceCapabilityManifest {
  Produces: string;
  Quality: string;
  Satisfies?: string[];
  Kinds?: string[];
  CapabilityIds?: string[];
}

export interface ToolSearchManifest {
  Summary?: string;
  Tags?: string[];
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

export interface SkillManifest {
  Name: string;
  Title?: string;
  DescriptionFile: string;
  WorkflowFile?: string;
  RecommendedTools?: string[];
  RecommendedAgents?: string[];
  RecommendedWorkflows?: string[];
  EvidenceRequirements?: SkillEvidenceRequirementManifest[];
  Search?: ToolSearchManifest;
}

export interface SkillEvidenceRequirementManifest {
  Need: string;
  Accepts: string[];
  MinimumQuality?: string[];
  Minimum?: number;
  Purpose?: string;
}

export interface AgentManifest {
  Name: string;
  Title?: string;
  DescriptionFile: string;
  InstructionsFile: string;
  RecommendedTools?: string[];
  ContextPack: string;
  OutputSchema: string;
  RuntimeProfile: string;
  Search?: ToolSearchManifest;
}

export interface AgentContextPackManifest {
  Name: string;
  Description?: string;
  TemplateFile: string;
  Inputs: string[];
  ToolScope: string;
  History: string;
  Artifacts: string;
  Evidence?: string;
}

export interface AgentMergePolicyManifest {
  Name: string;
  Description?: string;
  Strategy: string;
  TemplateFile: string;
  OutputSchema?: string;
}

export interface AgentWorkflowManifest {
  Name: string;
  Title?: string;
  Description?: string;
  Trigger: AgentWorkflowTriggerManifest;
  Execution: AgentWorkflowExecutionManifest;
  Jobs: AgentWorkflowJobManifest[];
  MergePolicy: string;
  Search?: ToolSearchManifest;
}

export interface AgentWorkflowExecutionManifest {
  Strategy: "sequential" | "parallel";
  MaxConcurrency?: number;
}

export interface AgentWorkflowTriggerManifest {
  Skills?: string[];
  Agents?: string[];
  Capabilities?: ToolSearchCapabilityManifest[];
}

export interface AgentWorkflowJobManifest {
  Agent: string;
  TaskFile: string;
  ContextPack?: string;
  Required?: boolean;
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
export interface PromptManifest {
  Name: string;
  Template: string;
}

export interface TemplateManifest {
  Name: string;
  Path: string;
}

export interface RootCommandManifest {
  Action: string;
  OutputMode: "tool_call_xml" | "final_text" | "open";
  ToolAccess: "disabled" | "restricted" | "discovery_only";
  Objective: string;
  InsufficiencyPolicy: string;
  AllowedTools: RootCommandToolSelectorManifest[];
  ForbiddenOutputs: string[];
  VisibleOutput: RootCommandVisibleOutputManifest;
  IncludeDecisionProtocol: boolean;
  IncludeToolCatalog: boolean;
}

export interface RootCommandVisibleOutputManifest {
  Audience: string;
  Start: string;
  Format: string;
  Rules: RootCommandVisibleOutputRuleManifest[];
  Repair: RootCommandVisibleOutputRepairManifest;
}

export interface RootCommandVisibleOutputRuleManifest {
  Name: string;
  Value: string;
  Instruction?: string;
}

export interface RootCommandVisibleOutputRepairManifest {
  Instruction: string;
  Rules: RootCommandVisibleOutputRuleManifest[];
}

export type RootCommandToolSelectorManifest =
  | {
      Source: "None";
    }
  | {
      Source: "Loaded";
    }
  | {
      Source: "NamedLoaded";
      Names: string[];
    }
  | {
      Source: "HostCapability";
      Capability: string;
    }
  | {
      Source: "PreferredLoaded";
    }
  | {
      Source: "PreferredLoadedOrLoaded";
    };

export interface PluginSecurityManifest {
  TrustLevel?: "System" | "Local" | "External" | "Untrusted";
  Network?: "Allow" | "Deny";
  FileSystem?: {
    Read?: string[];
    Write?: string[];
  };
  RequiresApproval?: boolean;
}

