import assert from "node:assert/strict";
import { AgentSystemRuntime } from "../Source/AgentSystem/AgentSystemRuntime.js";
import { AgentWorkflowProjector } from "../Source/AgentSystem/AgentWorkflowProjector.js";
import { AgentWorkflowSelector } from "../Source/AgentSystem/AgentWorkflowSelector.js";
import { verificationConfigPath } from "./VerificationConfig.js";

void main();

function main(): void {
  const workspaceRoot = process.cwd();
  const runtime = AgentSystemRuntime.load({
    workspaceRoot,
    configPath: verificationConfigPath(workspaceRoot),
  });

  const registry = runtime.registry;
  const skillActivation = runtime.skillActivation;
  const selector = new AgentWorkflowSelector(registry);
  const projector = new AgentWorkflowProjector(registry);

  assert.ok(registry.getAgent("SecurityReviewer"));
  assert.ok(registry.getAgentContextPack("DiffFocusedReadOnly"));
  assert.ok(registry.getAgentMergePolicy("FindingsBySeverity"));
  assert.ok(registry.getAgentWorkflow("ParallelPullRequestReview"));

  const reviewSkills = skillActivation.activate({
    input: "请用子代理并行审查当前 PR 的安全、测试缺口和可维护性。",
  });
  assert.ok(reviewSkills.some((skill) => skill.name === "PullRequestReviewSkill"));
  assert.ok(reviewSkills.some((skill) => skill.name === "WorkspaceInvestigationSkill"));
  const recommendedAgents = skillActivation.recommendedAgentNames(reviewSkills);
  assert.ok(recommendedAgents.includes("SecurityReviewer"));
  assert.ok(recommendedAgents.includes("TestGapReviewer"));
  assert.ok(recommendedAgents.includes("MaintainabilityReviewer"));
  const recommendedWorkflows = skillActivation.recommendedWorkflowNames(reviewSkills);
  assert.ok(recommendedWorkflows.includes("ParallelPullRequestReview"));

  const reviewWorkflows = selector.select({
    input: "请用子代理并行审查当前 PR 的安全、测试缺口和可维护性。",
    activeSkills: reviewSkills,
  });
  const pullRequestReviewWorkflow = reviewWorkflows.find(
    (entry) => entry.workflow.name === "ParallelPullRequestReview",
  );
  assert.ok(pullRequestReviewWorkflow);

  const projectedReview = projector.projectSelection(pullRequestReviewWorkflow);
  assert.equal(projectedReview.execution.strategy, "parallel");
  assert.equal(projectedReview.execution.maxConcurrency, 3);
  assert.equal(projectedReview.mergePolicy.name, "FindingsBySeverity");
  assert.deepEqual(projectedReview.jobs.map((job) => job.agent.name), [
    "SecurityReviewer",
    "TestGapReviewer",
    "MaintainabilityReviewer",
  ]);
  assert.ok(projectedReview.jobs.every((job) => job.contextPack.name === "DiffFocusedReadOnly"));

  const memorySkills = skillActivation.activate({
    input: "长期记忆、用户画像、偏好和知识网络怎么形成？",
  });
  assert.deepEqual(memorySkills.map((skill) => skill.name), ["MemoryFormationSkill"]);
  const memoryWorkflows = selector.select({
    input: "长期记忆、用户画像、偏好和知识网络怎么形成？",
    activeSkills: memorySkills,
  });
  assert.deepEqual(memoryWorkflows.map((entry) => entry.workflow.name), [
    "MemoryFormationWorkflow",
  ]);

  runtime.toolSearch.close();
  console.log("Agent workflow verification passed.");
}
