export interface RootCommandManifest {
  Action: string;
  OutputMode: "final_text" | "open";
  ToolAccess: "disabled" | "restricted" | "discovery_only";
  Objective: string;
  InsufficiencyPolicy: string;
  AllowedTools: RootCommandToolSelectorManifest[];
  ForbiddenOutputs: string[];
  VisibleOutput: RootCommandVisibleOutputManifest;
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
