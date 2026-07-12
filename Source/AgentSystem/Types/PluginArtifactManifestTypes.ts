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

export type ToolArtifactEvidenceSlotManifest = string | ToolArtifactEvidenceSlotObjectManifest;

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
