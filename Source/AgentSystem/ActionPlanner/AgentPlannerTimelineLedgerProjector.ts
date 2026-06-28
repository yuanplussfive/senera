import type { PlannerTimelineTurn } from "../BamlClient/baml_client/types.js";
import type {
  AgentActionPlannerLedger,
  PlannerEvidenceRecord,
} from "./AgentActionPlannerLedger.js";
import {
  projectLedgerEvidenceForTimeline,
  renderToolObservationContent,
} from "../ToolRuntime/AgentToolObservationRenderer.js";
import { compactObject } from "./AgentActionPlannerProjectionUtils.js";
import {
  AgentPlannerTimelinePayloadKeys,
  encodePlannerTimelinePayload,
} from "./AgentPlannerTimelinePayload.js";

export function appendMissingLedgerObservations(
  turns: PlannerTimelineTurn[],
  ledger: AgentActionPlannerLedger,
): PlannerTimelineTurn[] {
  const seenEvidenceUris = new Set(turns.flatMap((turn) => turn.evidenceUris));
  const seenArtifactUris = new Set(turns.flatMap((turn) => turn.artifactUris));
  const evidenceByUri = new Map(ledger.evidence.map((entry) => [entry.evidenceUri, entry]));
  const result = [...turns];

  for (const call of ledger.calls) {
    const missingUris = call.evidenceUris.filter((uri) => !seenEvidenceUris.has(uri));
    const artifactSeen = call.artifactUri.length > 0 && seenArtifactUris.has(call.artifactUri);
    if (missingUris.length === 0 && artifactSeen) {
      continue;
    }

    const evidence = call.evidenceUris
      .map((uri) => evidenceByUri.get(uri))
      .filter((entry): entry is PlannerEvidenceRecord => Boolean(entry));
    const artifactUris = call.artifactUri ? [call.artifactUri] : [];
    const observation = compactObject({
      name: call.toolName,
      status: call.status,
      artifactUri: call.artifactUri,
      error: call.error,
      evidence: evidence.map(projectLedgerEvidenceForTimeline),
    });
    result.push({
      index: result.length,
      role: "user",
      kind: "tool_observation",
      step: call.step,
      content: renderToolObservationContent([
        observation,
      ]),
      payloadJson: encodePlannerTimelinePayload({
        [AgentPlannerTimelinePayloadKeys.Observations]: [observation],
      }),
      evidenceUris: call.evidenceUris,
      artifactUris,
    });
    for (const ref of call.evidenceUris) {
      seenEvidenceUris.add(ref);
    }
    for (const uri of artifactUris) {
      seenArtifactUris.add(uri);
    }
  }

  return result;
}
