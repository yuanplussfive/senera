import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { MemOS } from "@mem-os/sdk";
import { z } from "zod";
import { WorkspaceAgentIdSchema } from "../Core/AgentDirectoryContract.js";
import { writeFileAtomicSync } from "../Core/AgentFs.js";
import type { AgentWorkspaceLayout } from "../Core/AgentWorkspaceLayout.js";

/** A UUID owns a complete learning store; names, presets and QQ numbers never select storage. */
export function agentLearningPaths(layout: AgentWorkspaceLayout, agentId: string) {
  const id = WorkspaceAgentIdSchema.parse(agentId);
  const root = path.join(layout.dataRoot, "agents", id);
  return {
    root,
    databasePath: path.join(root, "memory.sqlite"),
    memosDatabasePath: path.join(root, "memos.sqlite"),
    identityPath: path.join(root, "continuity-identity.json"),
    diaryRoot: path.join(root, "diary"),
  };
}

const MigrationSchema = z
  .object({ version: z.literal(1), agentId: WorkspaceAgentIdSchema, complete: z.boolean() })
  .strict();

/** The old store had workspace ownership. Preserve it once for the original Agent, never clone it into new Agents. */
export async function migrateWorkspaceLearning(layout: AgentWorkspaceLayout, originalAgentId: string): Promise<void> {
  const journal = path.join(layout.dataRoot, "agent-learning-migration.json");
  const state = fs.existsSync(journal)
    ? MigrationSchema.parse(JSON.parse(fs.readFileSync(journal, "utf8")))
    : MigrationSchema.parse({ version: 1, agentId: originalAgentId, complete: false });
  if (state.complete) return;
  const persist = () => writeFileAtomicSync(journal, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  persist();
  const target = agentLearningPaths(layout, state.agentId);
  fs.mkdirSync(target.root, { recursive: true, mode: 0o700 });
  for (const [source, destination] of [
    [layout.databases.memory, target.databasePath],
    [layout.databases.memos, target.memosDatabasePath],
  ]) {
    if (!fs.existsSync(source)) continue;
    if (fs.existsSync(destination)) throw new Error(`Both legacy and Agent learning stores exist: ${source}`);
    const database = new Database(source);
    try {
      const checkpoint = database.pragma("wal_checkpoint(TRUNCATE)") as { busy: number }[];
      if (checkpoint.some((result) => result.busy !== 0)) throw new Error(`Learning store is still in use: ${source}`);
    } finally {
      database.close();
    }
    fs.renameSync(source, destination);
  }
  if (fs.existsSync(layout.continuityIdentity)) {
    if (fs.existsSync(target.identityPath)) throw new Error("Both legacy and Agent continuity identities exist.");
    fs.renameSync(layout.continuityIdentity, target.identityPath);
  }
  if (fs.existsSync(target.memosDatabasePath)) {
    const memos = new MemOS({ dbPath: target.memosDatabasePath, experimental: { namespaces: true } });
    try {
      await memos.init();
      for (const namespace of await memos.listNamespaces()) {
        if (namespace === state.agentId) continue;
        const nodes = await memos.search({ namespace, limit: Math.max(memos.count, 1), includeHistorical: true });
        for (const { node } of nodes) await memos.update(node.id, { namespace: state.agentId });
      }
    } finally {
      await memos.close();
    }
  }
  state.complete = true;
  persist();
}
