import type {
  EvidenceSlot,
  TaskTargetRef,
  ToolCatalogItem,
  ToolCapabilityFacets,
} from "./BamlClient/baml_client/types.js";
import type { AgentActionCapabilityNeed } from "./ActionPlanner/AgentActionPlannerTypes.js";

export interface AgentEvidenceRequirementProfile {
  id?: string;
  need: string;
  reason?: string;
  targets?: readonly TaskTargetRef[];
}

export interface AgentEvidenceCandidateProfile {
  evidenceUri: string;
  kind: string;
  toolName: string;
  artifactUri: string;
  locator: string;
  display: string;
  label: string;
  source?: string | null;
  confidence?: number | null;
  facts: readonly EvidenceSlot[];
  artifactRefs: readonly string[];
}

export interface AgentEvidenceCapabilityMatch {
  evidenceUri: string;
  kind: string;
  toolName: string;
  artifactUri: string;
  locator: string;
  display: string;
  label: string;
  source?: string | null;
  confidence?: number | null;
  facts: EvidenceSlot[];
  produces: string;
  satisfies: string[];
  quality: string;
  supportingSignals: string[];
}

interface EvidenceCapabilityDocument {
  toolName: string;
  capabilityIndex: number;
  produces: string;
  satisfiesList: string[];
  kindsList: string[];
  capabilityIdsList: string[];
  quality: string;
  signals: string[];
}

export class AgentEvidenceCapabilityIndex {
  private readonly capabilityDocsByTool = new Map<string, EvidenceCapabilityDocument[]>();
  private readonly toolsByName: ReadonlyMap<string, ToolCatalogItem>;

  constructor(tools: readonly ToolCatalogItem[]) {
    this.toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
    for (const tool of tools) {
      this.capabilityDocsByTool.set(
        tool.name,
        tool.evidenceCapabilities.map((capability, capabilityIndex) => ({
          toolName: tool.name,
          capabilityIndex,
          produces: capability.produces,
          satisfiesList: capability.satisfies,
          kindsList: capability.kinds,
          capabilityIdsList: capability.capabilityIds,
          quality: capability.quality,
          signals: uniqueStrings([
            capability.produces,
            ...capability.satisfies,
            ...capability.kinds,
            ...capability.capabilityIds,
          ]),
        })),
      );
    }
  }

  describeEvidence(
    evidence: AgentEvidenceCandidateProfile,
    _requirement: AgentEvidenceRequirementProfile,
  ): AgentEvidenceCapabilityMatch[] {
    const docs = (this.capabilityDocsByTool.get(evidence.toolName) ?? [])
      .filter((doc) => this.kindCompatible(evidence, doc));

    return docs.map((doc) => {
      const tool = this.toolsByName.get(doc.toolName);
      const capability = tool?.evidenceCapabilities[doc.capabilityIndex];
      return {
        evidenceUri: evidence.evidenceUri,
        kind: evidence.kind,
        toolName: evidence.toolName,
        artifactUri: evidence.artifactUri,
        locator: evidence.locator,
        display: evidence.display,
        label: evidence.label,
        source: evidence.source,
        confidence: evidence.confidence,
        facts: [...evidence.facts],
        produces: capability?.produces ?? doc.produces,
        satisfies: capability?.satisfies ?? doc.satisfiesList,
        quality: capability?.quality ?? doc.quality,
        supportingSignals: doc.signals,
      };
    });
  }

  projectCapabilityNeed(
    facets: ToolCapabilityFacets,
  ): AgentActionCapabilityNeed {
    return projectFacets(facets);
  }

  private kindCompatible(
    evidence: AgentEvidenceCandidateProfile,
    doc: EvidenceCapabilityDocument,
  ): boolean {
    const kinds = doc.kindsList;
    return kinds.length === 0 || kinds.includes(evidence.kind);
  }
}

function projectFacets(facets: ToolCapabilityFacets): AgentActionCapabilityNeed {
  return {
    actions: uniqueStrings(facets.Actions ?? []),
    targets: uniqueStrings(facets.Targets ?? []),
    inputs: uniqueStrings(facets.Inputs ?? []),
    outputs: uniqueStrings(facets.Outputs ?? []),
    evidence: uniqueStrings(facets.Evidence ?? []),
    effects: uniqueStrings(facets.Effects ?? []),
  };
}

export function uniqueCapabilityNeeds(
  needs: readonly AgentActionCapabilityNeed[],
): AgentActionCapabilityNeed[] {
  const byKey = new Map<string, AgentActionCapabilityNeed>();
  for (const need of needs) {
    byKey.set(capabilityNeedKey(need), need);
  }
  return [...byKey.values()];
}

function capabilityNeedKey(need: AgentActionCapabilityNeed): string {
  return JSON.stringify([
    need.actions,
    need.targets,
    need.inputs,
    need.outputs,
    need.evidence,
    need.effects,
  ]);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
