import type {
  ToolSearchCapabilityManifest,
  ToolSearchManifest,
} from "./PluginSearchManifestTypes.js";

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
