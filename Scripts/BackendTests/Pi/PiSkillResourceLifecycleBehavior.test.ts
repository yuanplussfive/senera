import fs from "node:fs";
import path from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { describe, expect, test } from "vitest";
import { resolveAgentWorkspaceLayout } from "../../../Source/AgentSystem/Core/AgentWorkspaceLayout.js";
import { AgentExtensionRegistry } from "../../../Source/AgentSystem/Extensions/AgentExtensionRegistry.js";
import { AgentPiCodingAgentSessionFactory } from "../../../Source/AgentSystem/Pi/AgentPiCodingAgentSessionFactory.js";
import type {
  AgentPiCodingAgentLeaseInput,
  AgentPiPooledCodingSession,
} from "../../../Source/AgentSystem/Pi/AgentPiCodingAgentSessionPoolContracts.js";
import { projectSeneraModelProviderToPi } from "../../../Source/AgentSystem/Pi/AgentPiModelProjector.js";
import { projectAgentPiSkillCatalog } from "../../../Source/AgentSystem/Pi/AgentPiSkillCatalog.js";
import type { AgentPiToolSet } from "../../../Source/AgentSystem/Pi/AgentPiToolRegistryProjector.js";
import { AgentSkillActivationService } from "../../../Source/AgentSystem/Skills/AgentSkillActivation.js";
import { AgentSkillScanner } from "../../../Source/AgentSystem/Skills/AgentSkillScanner.js";
import { emptyAgentToolAccessGrant } from "../../../Source/AgentSystem/ToolRuntime/AgentToolAccessGrant.js";
import { AgentToolExposureState } from "../../../Source/AgentSystem/ToolRuntime/AgentToolExposureState.js";
import {
  createModelProvider,
  createPiPlanningCompilerFactory,
  createTemporaryDirectory,
  removeDirectory,
} from "../Support/AgentTestFixtures.js";
import { createTestToolObservationCompressor } from "../Support/PiToolObservationFixtures.js";

describe("Pi Skill resource lifecycle", () => {
  test("keeps per-session snapshots and refreshes additions, edits, and removals before reload", async () => {
    const root = createTemporaryDirectory("senera-pi-resource-lifecycle");
    const layout = resolveAgentWorkspaceLayout(root, path.join(root, "host-state"));
    const registry = new AgentExtensionRegistry();
    const scanner = new AgentSkillScanner();
    const activation = new AgentSkillActivationService(registry);
    const provider = createModelProvider({ Id: "resource-lifecycle", ContextWindowTokens: 16_384 });
    const factory = new AgentPiCodingAgentSessionFactory({
      workspaceRoot: root,
      workspaceLayout: layout,
      sessionsRoot: path.join(layout.stateRoot, "pi-sessions"),
      systemPromptPath: path.resolve("System/Prompts/Templates/PiSessionBaseSystemPrompt.liquid"),
      provider: projectSeneraModelProviderToPi(provider),
      modelProvider: provider,
      planningCompilerFactory: createPiPlanningCompilerFactory(),
      compaction: { Enabled: true },
      observationCompressor: createTestToolObservationCompressor(),
      observationTokenBudget: 2_048,
    });
    const allTools: AgentPiToolSet = {
      fingerprint: "empty-tools",
      activeToolNames: [],
      materialize: () => [],
      refresh: () => allTools,
    };
    const sessions: AgentPiPooledCodingSession[] = [];
    const skillRoot = path.join(layout.skillRoot, "project-skill");
    const nativeContext = path.join(root, "AGENTS.md");
    fs.mkdirSync(layout.contextRoot, { recursive: true });
    const input = async (sessionId: string): Promise<AgentPiCodingAgentLeaseInput> => {
      const activeSkills = await activation.activate({ input: "/project-skill" });
      const grant = emptyAgentToolAccessGrant();
      return {
        sessionId,
        allTools,
        activeToolNames: [],
        inheritProjectContext: true,
        frame: {
          sessionId,
          activeSkills,
          skillCatalog: projectAgentPiSkillCatalog(registry.listSkills(), activeSkills),
          nativeProviderToolNames: [],
          toolAccessGrant: grant,
          toolExposure: new AgentToolExposureState(grant),
          selectedPromptTemplates: [],
          preflight: async () => undefined,
        },
      };
    };
    try {
      writeSkill(skillRoot, "FIRST_BODY");
      registry.registerSkill(scanner.readSkillDirectory(skillRoot));
      fs.writeFileSync(layout.projectContextFile, "FIRST_PROJECT_CONTEXT");
      fs.writeFileSync(nativeContext, "FIRST_NATIVE_CONTEXT");
      const first = await factory.create(await input("first"), SessionManager.inMemory(root), 1);
      sessions.push(first);
      expect(first.resourceLoader.getSkills().skills.map((skill) => skill.filePath)).toEqual([
        path.join(skillRoot, "SKILL.md"),
      ]);
      expect(first.resourceLoader.getSkills().diagnostics).toEqual([]);

      writeSkill(skillRoot, "SECOND_BODY");
      registry.replaceSkills("standalone:project-skill", [scanner.readSkillDirectory(skillRoot)]);
      fs.writeFileSync(layout.projectContextFile, "SECOND_PROJECT_CONTEXT");
      fs.writeFileSync(nativeContext, "SECOND_NATIVE_CONTEXT");
      const extraRoot = path.join(layout.skillRoot, "extra-skill");
      writeSkill(extraRoot, "EXTRA_BODY");
      registry.registerSkill(scanner.readSkillDirectory(extraRoot));
      const second = await factory.create(await input("second"), SessionManager.inMemory(root), 2);
      sessions.push(second);

      // Reloading an older session must not consume another session's refreshed cache.
      await first.resourceLoader.reload();
      expect(first.frame.skillSnapshot()[0]?.content).toBe("FIRST_BODY");
      expect(first.resourceLoader.getSkills().skills.map((skill) => skill.name)).toEqual(["project-skill"]);
      expect(first.resourceLoader.getAgentsFiles().agentsFiles).toEqual(
        expect.arrayContaining([
          { path: nativeContext, content: "FIRST_NATIVE_CONTEXT" },
          { path: layout.projectContextFile, content: "FIRST_PROJECT_CONTEXT" },
        ]),
      );
      expect(second.frame.skillSnapshot()[0]?.content).toBe("SECOND_BODY");

      await factory.configure(first, await input("first"));
      expect(first.frame.skillSnapshot()[0]?.content).toBe("SECOND_BODY");
      expect(first.resourceLoader.getSkills().skills.map((skill) => skill.name)).toEqual([
        "extra-skill",
        "project-skill",
      ]);
      expect(first.resourceLoader.getAgentsFiles().agentsFiles).toEqual(
        expect.arrayContaining([
          { path: nativeContext, content: "SECOND_NATIVE_CONTEXT" },
          { path: layout.projectContextFile, content: "SECOND_PROJECT_CONTEXT" },
        ]),
      );

      fs.rmSync(skillRoot, { recursive: true });
      fs.rmSync(extraRoot, { recursive: true });
      registry.removeSkills("standalone:project-skill");
      registry.removeSkills("standalone:extra-skill");
      const empty = inputWithoutSkills("first", allTools);
      await factory.configure(first, empty);
      expect(first.resourceLoader.getSkills().skills).toEqual([]);
      expect(first.frame.skillSnapshot()).toEqual([]);
    } finally {
      for (const session of sessions) {
        session.disposeDiagnostics();
        session.disposeToolExposure();
        session.session.dispose();
      }
      removeDirectory(root);
    }
  });
});

function inputWithoutSkills(sessionId: string, allTools: AgentPiToolSet): AgentPiCodingAgentLeaseInput {
  const grant = emptyAgentToolAccessGrant();
  return {
    sessionId,
    allTools,
    activeToolNames: [],
    inheritProjectContext: true,
    frame: {
      sessionId,
      skillCatalog: projectAgentPiSkillCatalog([]),
      nativeProviderToolNames: [],
      toolAccessGrant: grant,
      toolExposure: new AgentToolExposureState(grant),
      selectedPromptTemplates: [],
      preflight: async () => undefined,
    },
  };
}

function writeSkill(root: string, content: string): void {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(
    path.join(root, "SKILL.md"),
    `---\nname: ${path.basename(root)}\ndescription: Resource test.\n---\n${content}\n`,
  );
}
