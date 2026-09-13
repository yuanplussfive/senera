import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { executeAgentSelfCommand } from "../../../Source/AgentSystem/SelfService/AgentSelfCommand.js";
import type {
  AgentSelfApprovalChannel,
  AgentSelfApprovalRequest,
} from "../../../Source/AgentSystem/SelfService/AgentSelfApprovalTypes.js";
import { createAgentSelfSkillsPort } from "../../../Source/AgentSystem/SelfService/AgentSelfSkills.js";
import type { AgentSelfServicePort } from "../../../Source/AgentSystem/SelfService/AgentSelfServiceTypes.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function createPort(): AgentSelfServicePort {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "senera-skill-approval-"));
  roots.push(root);
  return {
    workspaceRoot: root,
    skills: createAgentSelfSkillsPort([{ id: "workspace", displayName: "Workspace", kind: "workspace", root }]),
  } as unknown as AgentSelfServicePort;
}

const skillDocument = ["---", "name: learned-rules", "description: Learned rules.", "---", "", "# Rules"].join("\n");

describe("senera Skill mutation approval", () => {
  test("uses the shared approval channel before creating a workspace Skill", async () => {
    const requests: AgentSelfApprovalRequest[] = [];
    const approvals: AgentSelfApprovalChannel = {
      async request(input) {
        requests.push(input);
        return { status: "approved" };
      },
    };

    const output = await executeAgentSelfCommand(
      { command: "skills", action: "create", name: "learned-rules", content: skillDocument },
      createPort(),
      { approvals },
    );

    expect(output.ok).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      kind: "skill",
      skillName: "learned-rules",
      operation: "create",
      command: { command: "skills", action: "create" },
    });
  });

  test("does not write when approval is deferred", async () => {
    const port = createPort();
    const output = await executeAgentSelfCommand(
      { command: "skills", action: "create", name: "learned-rules", content: skillDocument },
      port,
      {
        approvals: {
          async request() {
            return { status: "deferred", approvalId: "skill-1", deadlineAt: "2026-09-10T00:00:00.000Z" };
          },
        },
      },
    );

    expect(output.ok).toBe(false);
    expect(output.error).toBe("approval_required");
    expect(output.approvalRequired).toMatchObject({ approvalId: "skill-1" });
    expect(port.skills?.inspect("learned-rules")).toMatchObject({ status: "missing" });
  });
});
