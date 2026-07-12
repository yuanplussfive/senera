import { Liquid } from "liquidjs";
import type { ToolArtifactPolicyManifest } from "../Types/PluginManifestTypes.js";
import type {
  ExecutedToolCallArtifact,
  ToolArtifactDeltaRecord,
  ToolArtifactEvidenceRecord,
} from "../Types/ToolRuntimeTypes.js";

const ArtifactTemplateRenderer = new Liquid({
  strictFilters: true,
  strictVariables: false,
});

const EvidencePresentationRenderer = new Liquid({
  strictFilters: true,
  strictVariables: false,
});

export function buildArtifactSummary(input: {
  toolName: string;
  callId: string;
  args: unknown;
  result: unknown;
  evidence: readonly ToolArtifactEvidenceRecord[];
  delta: readonly ToolArtifactDeltaRecord[];
  policy: ToolArtifactPolicyManifest | undefined;
  artifact: Record<string, unknown>;
  workspace: unknown;
}): string {
  const template = input.policy?.Summary?.Template;
  return template ? (renderArtifactTemplate(template, createArtifactTemplateScope(input)) ?? "") : "";
}

export function buildArtifactProjection(input: {
  artifact: ExecutedToolCallArtifact;
  toolName: string;
  callId: string;
  args: unknown;
  result: unknown;
  policy: ToolArtifactPolicyManifest | undefined;
}): string {
  const template = input.policy?.Summary?.ArtifactTemplate;
  return template
    ? (renderArtifactTemplate(
        template,
        createArtifactTemplateScope({
          toolName: input.toolName,
          callId: input.callId,
          args: input.args,
          result: input.result,
          evidence: input.artifact.evidence,
          delta: input.artifact.delta,
          policy: input.policy,
          artifact: {
            artifactId: input.artifact.artifactId,
            artifactUri: input.artifact.artifactUri,
            artifactPath: input.artifact.artifactPath,
            relativePath: input.artifact.relativePath,
          },
          workspace: input.artifact.workspace,
        }),
      ) ?? "")
    : "";
}

export function renderEvidenceTemplate(template: string, data: Record<string, unknown>): string | undefined {
  return renderTemplate(EvidencePresentationRenderer, template, data, "Evidence presentation template failed");
}

function renderArtifactTemplate(template: string, data: Record<string, unknown>): string | undefined {
  return renderTemplate(ArtifactTemplateRenderer, template, data, "Artifact template failed");
}

function createArtifactTemplateScope(input: {
  toolName: string;
  callId: string;
  args: unknown;
  result: unknown;
  evidence: readonly ToolArtifactEvidenceRecord[];
  delta: readonly ToolArtifactDeltaRecord[];
  policy: ToolArtifactPolicyManifest | undefined;
  artifact: Record<string, unknown>;
  workspace: unknown;
}): Record<string, unknown> {
  const evidence = input.evidence.map(projectEvidenceForTemplate);
  const projections = buildEvidenceProjectionBlocks(input.policy, evidence);
  return {
    toolName: input.toolName,
    callId: input.callId,
    arguments: input.args,
    result: input.result,
    artifact: input.artifact,
    evidence,
    evidenceByKind: Object.fromEntries(
      (input.policy?.Evidence ?? []).map((rule) => [rule.Kind, evidence.filter((entry) => entry.kind === rule.Kind)]),
    ),
    projections,
    delta: input.delta,
    workspace: input.workspace,
  };
}

function projectEvidenceForTemplate(entry: ToolArtifactEvidenceRecord): Record<string, unknown> {
  return {
    evidenceUri: entry.evidenceUri,
    kind: entry.kind,
    locator: entry.locator,
    display: entry.display,
    label: entry.label,
    source: entry.source,
    confidence: entry.confidence,
    slots: entry.slots ?? {},
    modelSlots: entry.modelSlots,
    metadata: entry.metadata ?? {},
  };
}

function buildEvidenceProjectionBlocks(
  policy: ToolArtifactPolicyManifest | undefined,
  evidence: readonly Record<string, unknown>[],
): Array<{
  kind: string;
  count: number;
  summary: string;
  artifact: string;
}> {
  return (policy?.Evidence ?? []).flatMap((rule) => {
    const records = evidence.filter((entry) => entry.kind === rule.Kind);
    if (records.length === 0) {
      return [];
    }

    const data = {
      kind: rule.Kind,
      count: records.length,
      evidence: records,
    };
    return [
      {
        kind: rule.Kind,
        count: records.length,
        summary: renderEvidenceTemplate(rule.Projection.SummaryTemplate, data) ?? "",
        artifact: renderEvidenceTemplate(rule.Projection.ArtifactTemplate, data) ?? "",
      },
    ];
  });
}

function renderTemplate(
  renderer: Liquid,
  template: string,
  data: Record<string, unknown>,
  errorPrefix: string,
): string | undefined {
  try {
    const text = String(renderer.parseAndRenderSync(template, data)).trim();
    return text.length > 0 ? text : undefined;
  } catch (error) {
    throw new Error(`${errorPrefix}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}
