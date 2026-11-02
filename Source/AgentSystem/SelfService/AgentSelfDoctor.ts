import fs from "node:fs";
import type { AgentSelfDoctorReport, AgentSelfServicePort } from "./AgentSelfServiceTypes.js";
import { resolveAgentWorkspaceLayout } from "../Core/AgentWorkspaceLayout.js";

/** Local read-only health snapshot. Network probes are intentionally absent:
 * the command vocabulary must never require an external boundary. */
export async function projectAgentSelfDoctorReport(port: AgentSelfServicePort): Promise<AgentSelfDoctorReport> {
  const layout = resolveAgentWorkspaceLayout(port.workspaceRoot);
  const configIssues = readConfigIssues(port);
  const workspaceIssues = readWorkspaceIssues(port);
  const stateIssues = readStateIssues(layout.stateRoot);
  return {
    config: {
      valid: configIssues.length === 0,
      issues: configIssues,
    },
    workspace: {
      writable: workspaceIssues.length === 0,
      issues: workspaceIssues,
    },
    state: {
      readonly: stateIssues.length === 0,
      issues: stateIssues,
    },
  };
}

export function describeAgentSelfDoctor(report: AgentSelfDoctorReport): string {
  const line = (label: string, ok: boolean, issues: readonly string[]): string =>
    `${ok ? "✓" : "✗"} ${label}${issues.length > 0 ? `: ${issues.join("; ")}` : ""}`;
  return [
    line("config", report.config.valid, report.config.issues),
    line("workspace", report.workspace.writable, report.workspace.issues),
    line("state", report.state.readonly, report.state.issues),
  ].join("\n");
}

function readConfigIssues(port: AgentSelfServicePort): string[] {
  try {
    const value = port.config.getSnapshot().value;
    if (!value.DefaultModelProviderId) return ["No default model provider is configured."];
    return [];
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
}

function readWorkspaceIssues(port: AgentSelfServicePort): string[] {
  const issues: string[] = [];
  try {
    const access = fs.accessSync(port.workspaceRoot, fs.constants.R_OK | fs.constants.W_OK);
    void access;
  } catch {
    issues.push("Workspace root is not readable/writable.");
  }
  return issues;
}

function readStateIssues(stateRoot: string): string[] {
  const issues: string[] = [];
  if (!fs.existsSync(stateRoot)) {
    issues.push("State directory has not been created yet (first run).");
  }
  return issues;
}
