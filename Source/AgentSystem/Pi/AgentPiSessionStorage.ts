import path from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";

export function resolveAgentPiSessionsRoot(workspaceRoot: string, sessionsRoot: string): string {
  return path.resolve(workspaceRoot, sessionsRoot);
}

export async function findAgentPiSessionFile(
  workspaceRoot: string,
  sessionsRoot: string,
  sessionId: string,
): Promise<{ readonly id: string; readonly path: string } | undefined> {
  const resolvedSessionsRoot = resolveAgentPiSessionsRoot(workspaceRoot, sessionsRoot);
  const sessions = await SessionManager.list(workspaceRoot, resolvedSessionsRoot);
  return sessions.find((session) => session.id === sessionId);
}
