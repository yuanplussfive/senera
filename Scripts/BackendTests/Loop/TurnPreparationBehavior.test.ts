import { describe, expect, test } from "vitest";
import { InteractionRunMode, TurnContextMode } from "../../../Source/AgentSystem/BamlClient/baml_client/types.js";
import { AgentLoopStateMachine } from "../../../Source/AgentSystem/Loop/AgentLoopStateMachine.js";
import {
  AgentTurnPreparationSnapshotSchemaVersion,
  createAgentTurnPreparationSnapshot,
  isAgentTurnPreparationReusable,
  parseAgentTurnPreparationSnapshot,
} from "../../../Source/AgentSystem/Loop/AgentTurnPreparationSnapshot.js";

describe("Turn preparation behavior", () => {
  test("reuses a preparation only for the same input and runtime generation", () => {
    const snapshot = preparation();

    expect(
      isAgentTurnPreparationReusable(snapshot, {
        runtimeFingerprint: "runtime-a",
        userInput: "Inspect the workspace",
      }),
    ).toBe(true);
    expect(
      isAgentTurnPreparationReusable(snapshot, {
        runtimeFingerprint: "runtime-b",
        userInput: "Inspect the workspace",
      }),
    ).toBe(false);
    expect(
      isAgentTurnPreparationReusable(snapshot, {
        runtimeFingerprint: "runtime-a",
        userInput: "Edit the workspace",
      }),
    ).toBe(false);
  });

  test("starts a prepared turn at prompt rendering without understanding or routing commands", () => {
    const transition = new AgentLoopStateMachine().start({
      sessionId: "session-a",
      requestId: "request-new",
      input: "Inspect the workspace",
      loadedToolNames: [],
      preparation: preparation(),
    });

    expect(transition.command).toMatchObject({
      kind: "render_prompt",
      requestId: "request-new",
      loadedToolNames: ["WorkspaceListFiles"],
    });
    expect(transition.events.map((event) => event.kind)).toEqual(["run.started", "interaction.routed"]);
    expect(transition.state).toMatchObject({
      turnUnderstanding: { standaloneRequest: "Inspect the workspace" },
      interactionRoute: { mode: "tool_agent_loop", objective: "Inspect the workspace" },
      activeSkills: [],
      initialAction: {
        kind: "CallTools",
        calls: [{ toolName: "WorkspaceListFiles" }],
      },
    });
  });

  test("rejects obsolete snapshots and validates prepared actions against the visible tool set", () => {
    const snapshot = preparation();

    expect(parseAgentTurnPreparationSnapshot(snapshot)).toMatchObject({
      schemaVersion: AgentTurnPreparationSnapshotSchemaVersion,
      initialAction: { kind: "CallTools" },
    });
    expect(
      parseAgentTurnPreparationSnapshot({
        ...snapshot,
        schemaVersion: AgentTurnPreparationSnapshotSchemaVersion - 1,
      }),
    ).toBeUndefined();
    expect(
      parseAgentTurnPreparationSnapshot({
        ...snapshot,
        loadedToolNames: [],
      }),
    ).toBeUndefined();
  });
});

function preparation() {
  return createAgentTurnPreparationSnapshot({
    runtimeFingerprint: "runtime-a",
    userInput: "Inspect the workspace",
    turnUnderstanding: {
      rawUserTurn: "Inspect the workspace",
      standaloneRequest: "Inspect the workspace",
      contextMode: TurnContextMode.None,
      contextBasis: "",
      missingContext: "",
    },
    route: {
      mode: "tool_agent_loop",
      objective: "Inspect the workspace",
      preferredTools: ["WorkspaceListFiles"],
      discoveryQueries: [],
      raw: {
        mode: InteractionRunMode.ToolAgentLoop,
        objective: "Inspect the workspace",
        preferredTools: ["WorkspaceListFiles"],
        discoveryQueries: [],
      },
    },
    loadedToolNames: ["WorkspaceListFiles"],
    initialAction: {
      kind: "CallTools",
      preface: "Inspecting the workspace.",
      calls: [
        {
          toolName: "WorkspaceListFiles",
          purpose: "List workspace files.",
          required: true,
        },
      ],
    },
    activeSkills: [],
  });
}
