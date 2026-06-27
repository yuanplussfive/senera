"use strict";

const fsp = require("node:fs/promises");
const { resolveExistingWorkspacePath, toWorkspacePath } = require("./Context.js");
const { createScoutCommandRegistry } = require("./ScoutCommandRegistry.js");

async function runLlmScoutPlanner(options) {
  const {
    context,
    config,
    prepared,
    args,
    deps,
    queryPlan,
    directCandidates
  } = options;
  const plannerConfig = config.scout.llmPlanner;
  const diagnostics = createDiagnostics(plannerConfig);
  if (!plannerConfig.enabled) {
    diagnostics.status = "disabled";
    return { candidates: [], diagnostics };
  }

  const registry = createScoutCommandRegistry(context, config, prepared, deps);
  const planner = deps.llmScoutPlanner;
  if (!planner || typeof planner.plan !== "function") {
    throw new Error("FastContextScoutTool 的 llm 模式需要宿主提供 llmScoutPlanner。");
  }

  const plannerInput = initialPlannerInput({
    context,
    config,
    args,
    queryPlan,
    directCandidates,
    commandDefinitions: registry.enabledDefinitions()
  });
  const candidates = [];
  const observations = [];
  diagnostics.status = "running";

  for (let round = 1; round <= plannerConfig.maxRounds; round += 1) {
    diagnostics.rounds = round;
    let decision;
    try {
      const planned = await planner.plan({
        ...plannerInput,
        round,
        observations: {
          item: observations
        }
      }, {
        signal: deps.signal
      });
      decision = planned.decision;
      if (planned.repaired) {
        diagnostics.repairs += 1;
      }
    } catch (error) {
      diagnostics.status = "failed";
      diagnostics.errors.item.push(error instanceof Error ? error.message : String(error));
      throw error;
    }

    if (decision.action === "final") {
      const finalCandidates = await finalSelectionCandidates(context, config, decision.files ?? []);
      candidates.push(...finalCandidates);
      diagnostics.finalFiles = finalCandidates.length;
      diagnostics.status = "completed";
      break;
    }

    if (decision.action !== "commands") {
      diagnostics.status = "failed";
      diagnostics.errors.item.push(`未知 LLM Scout Planner action：${String(decision.action)}`);
      break;
    }

    const commands = (decision.commands ?? []).slice(0, plannerConfig.maxCommandsPerRound);
    diagnostics.commands += commands.length;
    for (const command of commands) {
      const observation = await registry.execute(command);
      observations.push(projectObservation(config, observation, round));
      candidates.push(...observation.candidates);
    }
  }

  if (diagnostics.status === "running") {
    diagnostics.status = "max_rounds_reached";
  }

  return { candidates, diagnostics };
}

function initialPlannerInput(options) {
  const { context, config, args, queryPlan, directCandidates, commandDefinitions } = options;
  return {
    stage: "planFastContextScout",
    workspaceRoot: context.workspaceRoot,
    virtualRoot: "/codebase",
    question: args.question,
    queryPlan: {
      item: queryPlan.item
    },
    commandBudget: {
      maxRounds: config.scout.llmPlanner.maxRounds,
      maxCommandsPerRound: config.scout.llmPlanner.maxCommandsPerRound
    },
    allowedCommands: {
      item: commandDefinitions
    },
    deterministicCandidates: {
      item: directCandidates
        .slice(0, config.scout.llmPlanner.maxCandidateSummaries)
        .map(projectCandidateSummary)
    }
  };
}

async function finalSelectionCandidates(context, config, files) {
  const candidates = [];
  for (const file of files) {
    const workspacePath = normalizePlannerPath(file.path);
    if (!workspacePath) {
      continue;
    }
    const resolved = await resolveExistingWorkspacePath(context, workspacePath, fsp);
    if (!resolved) {
      continue;
    }
    let stat;
    try {
      stat = await fsp.stat(resolved);
    } catch {
      continue;
    }
    if (!stat.isFile()) {
      continue;
    }
    const startLine = Number.isInteger(file.startLine) && file.startLine > 0 ? file.startLine : 1;
    const endLine = Number.isInteger(file.endLine) && file.endLine >= startLine
      ? file.endLine
      : startLine + config.scout.llmPlanner.readLineWindow - 1;
    candidates.push({
      path: toWorkspacePath(context, resolved),
      score: config.scout.llmPlanner.finalCandidateScore,
      startLine,
      endLine,
      line: startLine,
      reasons: [`LLM Scout final: ${String(file.reason ?? "").trim() || "selected by planner"}`],
      snippets: [String(file.reason ?? "").trim()].filter(Boolean),
      focus: String(file.reason ?? "").trim()
    });
  }
  return candidates;
}

function normalizePlannerPath(value) {
  const path = typeof value === "string" ? value.trim() : "";
  if (!path) {
    return "";
  }
  if (path === "/codebase") {
    return ".";
  }
  if (path.startsWith("/codebase/")) {
    return path.slice("/codebase/".length);
  }
  return path;
}

function projectObservation(config, observation, round) {
  return {
    round,
    command: observation.command,
    ok: observation.ok,
    output: limitText(observation.text, config.scout.llmPlanner.maxObservationChars),
    candidateCount: observation.candidates.length
  };
}

function projectCandidateSummary(candidate) {
  return {
    path: candidate.path,
    score: candidate.score,
    line: candidate.line,
    startLine: candidate.startLine,
    endLine: candidate.endLine,
    reason: candidate.reasons?.join("; ") ?? "",
    focus: candidate.focus ?? ""
  };
}

function limitText(value, maxChars) {
  const text = String(value);
  return text.length > maxChars
    ? `${text.slice(0, maxChars)}\n... truncated ...`
    : text;
}

function createDiagnostics(config) {
  return {
    status: "not_started",
    mode: config.mode,
    rounds: 0,
    commands: 0,
    finalFiles: 0,
    repairs: 0,
    errors: {
      item: []
    }
  };
}

module.exports = {
  runLlmScoutPlanner
};
