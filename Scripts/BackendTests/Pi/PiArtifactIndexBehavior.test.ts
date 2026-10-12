import { describe, expect, test } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import {
  AgentPiArtifactIndexCustomType,
  createAgentPiArtifactIndex,
  projectAgentPiArtifactReferences,
  readAgentPiArtifactIndex,
} from "../../../Source/AgentSystem/Pi/AgentPiArtifactIndex.js";
import {
  AgentPiToolObservationSourceViewProtocol,
  createAgentPiToolObservation,
} from "../../../Source/AgentSystem/Pi/AgentPiToolObservation.js";

describe("Pi artifact index", () => {
  test("projects artifact identity from structured tool details", () => {
    expect(projectAgentPiArtifactReferences([toolResultMessage()])).toEqual([
      {
        artifactUri: ArtifactUris.current,
        toolNames: ["WorkspaceReadFile"],
        callIds: ["call-current"],
        evidenceUris: ["senera://evidence/current"],
        refs: ["projection", "raw"],
      },
    ]);
  });

  test("retains original source coordinates for a source-view result", () => {
    const observation = createAgentPiToolObservation({
      status: "success",
      execution_status: "completed",
      output_availability: "complete",
      source_artifacts: [
        {
          artifact_uri: ArtifactUris.source,
          refs: ["raw", "evidence"],
        },
      ],
      detail: { evidence: [], result: { content: "current-turn-only" } },
    });
    const message = {
      role: "toolResult",
      toolCallId: "call-source-view",
      toolName: "ArtifactMemoryReadTool",
      content: [{ type: "text", text: JSON.stringify(observation) }],
      isError: false,
      timestamp: Date.now(),
    } as AgentMessage;

    expect(projectAgentPiArtifactReferences([message])).toEqual([
      {
        artifactUri: ArtifactUris.source,
        toolNames: ["ArtifactMemoryReadTool"],
        callIds: ["call-source-view"],
        evidenceUris: [],
        refs: ["raw", "evidence"],
      },
    ]);
  });

  test("rejects a non-canonical source artifact coordinate at the observation boundary", () => {
    expect(() =>
      createAgentPiToolObservation({
        status: "success",
        execution_status: "completed",
        output_availability: "complete",
        source_artifacts: [{ artifact_uri: "senera://artifact/not-canonical", refs: ["raw"] }],
        detail: { evidence: [] },
      }),
    ).toThrow("工具观测必须符合严格");
  });

  test("merges the previous compaction index with newly summarized tool results", () => {
    const index = createAgentPiArtifactIndex(
      [
        {
          artifactUri: ArtifactUris.current,
          toolNames: ["EarlierTool"],
          callIds: ["call-earlier"],
          evidenceUris: [],
          refs: ["summary"],
        },
      ],
      [toolResultMessage()],
    );

    expect(index.artifacts).toEqual([
      {
        artifactUri: ArtifactUris.current,
        toolNames: ["EarlierTool", "WorkspaceReadFile"],
        callIds: ["call-earlier", "call-current"],
        evidenceUris: ["senera://evidence/current"],
        refs: ["summary", "projection", "raw"],
      },
    ]);
  });

  test("reads the latest branch index entry", () => {
    const entries = [
      customEntry("older", {
        artifacts: [artifactReference(ArtifactUris.older)],
      }),
      customEntry("latest", {
        artifacts: [artifactReference(ArtifactUris.latest)],
      }),
    ];

    expect(readAgentPiArtifactIndex(entries)).toEqual({
      artifacts: [artifactReference(ArtifactUris.latest)],
    });
  });

  test("reports an invalid latest index without accepting partial data", () => {
    const result = readAgentPiArtifactIndex([
      customEntry("valid", { artifacts: [artifactReference(ArtifactUris.valid)] }),
      customEntry("invalid", { artifacts: [{ artifactUri: ArtifactUris.invalid }] }),
    ]);

    expect(result).toEqual({ artifacts: [], invalidEntryId: "invalid" });
  });
});

const ArtifactUris = {
  current: "senera://artifact/art_000000000000000000000001",
  source: "senera://artifact/art_000000000000000000000002",
  older: "senera://artifact/art_000000000000000000000003",
  latest: "senera://artifact/art_000000000000000000000004",
  valid: "senera://artifact/art_000000000000000000000005",
  invalid: "senera://artifact/art_000000000000000000000006",
} as const;

function toolResultMessage(): AgentMessage {
  const observation = createAgentPiToolObservation({
    status: "success",
    execution_status: "completed",
    output_availability: "complete",
    observation_view: {
      type: AgentPiToolObservationSourceViewProtocol.type,
      complete: true,
      omission_count: 0,
      omissions: [],
      artifact_uri: ArtifactUris.current,
    },
    detail: {
      evidence: [
        {
          evidence_uri: "senera://evidence/current",
          artifact_refs: ["projection", "raw", "projection"],
        },
      ],
    },
  });
  return {
    role: "toolResult",
    toolCallId: "call-current",
    toolName: "WorkspaceReadFile",
    content: [
      {
        type: "text",
        text: JSON.stringify(observation),
      },
    ],
    details: {
      senera: {
        toolName: "WorkspaceReadFile",
        callId: "call-current",
        artifactUri: ArtifactUris.current,
        status: "success",
      },
    },
    isError: false,
    timestamp: Date.now(),
  };
}

function customEntry(id: string, data: unknown): SessionEntry {
  return {
    type: "custom",
    id,
    parentId: null,
    timestamp: "2026-08-01T00:00:00.000Z",
    customType: AgentPiArtifactIndexCustomType,
    data,
  };
}

function artifactReference(artifactUri: string) {
  return {
    artifactUri,
    toolNames: [],
    callIds: [],
    evidenceUris: [],
    refs: [],
  };
}
