import { describe, expect, test } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import {
  AgentPiArtifactIndexCustomType,
  createAgentPiArtifactIndex,
  projectAgentPiArtifactReferences,
  readAgentPiArtifactIndex,
} from "../../../Source/AgentSystem/Pi/AgentPiArtifactIndex.js";
import { AgentPiToolObservationProtocol } from "../../../Source/AgentSystem/Pi/AgentPiToolObservation.js";

describe("Pi artifact index", () => {
  test("projects artifact identity from structured tool details", () => {
    expect(projectAgentPiArtifactReferences([toolResultMessage()])).toEqual([
      {
        artifactUri: "senera://artifact/current",
        toolNames: ["WorkspaceReadFile"],
        callIds: ["call-current"],
        evidenceUris: ["senera://evidence/current"],
        refs: ["projection", "raw"],
      },
    ]);
  });

  test("merges the previous compaction index with newly summarized tool results", () => {
    const index = createAgentPiArtifactIndex(
      [
        {
          artifactUri: "senera://artifact/current",
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
        artifactUri: "senera://artifact/current",
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
        artifacts: [artifactReference("senera://artifact/older")],
      }),
      customEntry("latest", {
        artifacts: [artifactReference("senera://artifact/latest")],
      }),
    ];

    expect(readAgentPiArtifactIndex(entries)).toEqual({
      artifacts: [artifactReference("senera://artifact/latest")],
    });
  });

  test("reports an invalid latest index without accepting partial data", () => {
    const result = readAgentPiArtifactIndex([
      customEntry("valid", { artifacts: [artifactReference("senera://artifact/valid")] }),
      customEntry("invalid", { artifacts: [{ artifactUri: "senera://artifact/invalid" }] }),
    ]);

    expect(result).toEqual({ artifacts: [], invalidEntryId: "invalid" });
  });
});

function toolResultMessage(): AgentMessage {
  return {
    role: "toolResult",
    toolCallId: "call-current",
    toolName: "WorkspaceReadFile",
    content: [
      {
        type: "text",
        text: JSON.stringify({
          type: AgentPiToolObservationProtocol.type,
          artifact_uri: "senera://artifact/current",
          evidence: [
            {
              evidence_uri: "senera://evidence/current",
              artifact_refs: ["projection", "raw", "projection"],
            },
          ],
        }),
      },
    ],
    details: {
      senera: {
        toolName: "WorkspaceReadFile",
        callId: "call-current",
        artifactUri: "senera://artifact/current",
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
