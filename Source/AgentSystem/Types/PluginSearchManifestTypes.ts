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
