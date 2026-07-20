import { describe, expect, test } from "vitest";
import { collectArtifactEvidence } from "../../../Source/AgentSystem/Artifacts/AgentArtifactEvidenceProjection.js";
import type { ToolArtifactPolicyManifest } from "../../../Source/AgentSystem/Types/PluginManifestTypes.js";
import { createToolEvidenceMemoryEntries } from "../../../Source/AgentSystem/Memory/AgentPlannerMemory.js";

describe("Artifact evidence source projection", () => {
  test("projects source artifact URI and hydrated refs from declarative slots", () => {
    const policy: ToolArtifactPolicyManifest = {
      Evidence: [
        {
          Kind: "artifact_memory",
          Records: "$.artifacts.item[*]",
          Slots: {
            artifactUri: "$.artifactUri",
            status: "$.status",
            loadedRefs: "$.memories.item[*].ref",
          },
          Identity: { Parts: ["artifactUri", "status"] },
          Presentation: {
            Locator: "{{ artifactUri }}",
            Display: "{{ status }} {{ artifactUri }}",
            Label: "{{ artifactUri }}",
            Source: "artifact memory",
          },
          ModelProjection: { Slots: ["artifactUri", "status", "loadedRefs"] },
          PlannerMemory: {
            Facts: ["status", "loadedRefs"],
            ArtifactUri: "artifactUri",
            ArtifactRefsSlot: "loadedRefs",
          },
          Projection: {
            SummaryTemplate: "{{ evidence[0].slots.status }}",
            ArtifactTemplate: "{{ evidence[0].slots.artifactUri }}",
          },
          Confidence: 1,
        },
      ],
    };

    const [evidence] = collectArtifactEvidence(
      {
        artifacts: {
          item: [
            {
              artifactUri: "senera://artifact/art_0123456789abcdef01234567",
              status: "found",
              memories: { item: [{ ref: "raw" }, { ref: "evidence" }, { ref: "raw" }] },
            },
          ],
        },
      },
      policy,
      "art_trace",
    );

    expect(evidence.plannerMemory).toEqual({
      artifactUri: "senera://artifact/art_0123456789abcdef01234567",
      artifactRefs: ["raw", "evidence"],
      facts: [
        { name: "status", value: "found" },
        { name: "loadedRefs", value: '["raw","evidence","raw"]' },
      ],
    });

    const [memoryEntry] = createToolEvidenceMemoryEntries({
      requestId: "request-1",
      step: 1,
      results: [
        {
          callId: "call-1",
          name: "ArtifactMemoryReadTool",
          arguments: {},
          process: { exitCode: 0, signal: null, stderr: "" },
          result: {},
          artifact: {
            artifactId: "art_trace",
            artifactUri: "senera://artifact/art_89abcdef0123456701234567",
            artifactPath: ".senera/artifacts/trace",
            relativePath: "trace",
            manifestPath: ".senera/artifacts/trace/manifest.json",
            files: {},
            summary: "",
            evidence: [evidence],
            delta: [],
          },
        },
      ],
    });
    expect(memoryEntry.record.evidence[0]).toMatchObject({
      artifactUri: "senera://artifact/art_0123456789abcdef01234567",
      artifactRefs: ["raw", "evidence"],
    });
  });
});
