import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { relativePathWithin } from "../Core/AgentPath.js";
import { writeFileAtomicSync } from "../Core/AgentFs.js";
import { AgentWorkspaceCatalogSchema, type AgentWorkspaceDescriptor } from "./AgentWorkspaceCatalogContract.js";

export type { AgentWorkspaceDescriptor } from "./AgentWorkspaceCatalogContract.js";

export class AgentWorkspaceNotFoundError extends Error {
  constructor(readonly workspaceId: string) {
    super(`Unknown workspace: ${workspaceId}`);
    this.name = "AgentWorkspaceNotFoundError";
  }
}

/** Application-owned identities; registering a folder never copies its configuration or data. */
export class AgentWorkspaceCatalog {
  private readonly filePath: string;
  private readonly roots: readonly string[];
  private readonly records: AgentWorkspaceDescriptor[];

  constructor(options: { stateRoot: string; allowedRoots?: readonly string[] }) {
    this.filePath = path.join(options.stateRoot, "workspaces.json");
    this.roots = options.allowedRoots?.map((root) => fs.realpathSync.native(root)) ?? [];
    this.records = fs.existsSync(this.filePath)
      ? AgentWorkspaceCatalogSchema.parse(JSON.parse(fs.readFileSync(this.filePath, "utf8"))).workspaces
      : [];
  }

  list(): readonly AgentWorkspaceDescriptor[] {
    return this.records.map((record) => ({ ...record }));
  }

  get(id: string): AgentWorkspaceDescriptor {
    const record = this.records.find((workspace) => workspace.id === id);
    if (!record) throw new AgentWorkspaceNotFoundError(id);
    return record;
  }

  resolveDirectory(value: string): string {
    const root = fs.realpathSync.native(path.resolve(value));
    if (!fs.statSync(root).isDirectory()) throw new Error("Workspace must be a directory.");
    if (this.roots.length && !this.roots.some((allowed) => relativePathWithin(allowed, root) !== undefined)) {
      throw new Error("Directory is outside the deployment's workspace roots.");
    }
    return root;
  }

  register(value: string): AgentWorkspaceDescriptor {
    const root = this.resolveDirectory(value);
    const existing = this.records.find((record) => sameDirectory(record.root, root));
    if (existing) return existing;
    const record = { id: randomUUID(), root, name: path.basename(root) || root };
    const next = [record, ...this.records];
    this.persist(next);
    this.records.unshift(record);
    return record;
  }

  recordOpened(value: string): AgentWorkspaceDescriptor {
    const record = this.register(value);
    const index = this.records.indexOf(record);
    if (index > 0) {
      const next = [record, ...this.records.filter((entry) => entry !== record)];
      this.persist(next);
      this.records.splice(index, 1);
      this.records.unshift(record);
    }
    return record;
  }

  private persist(next: readonly AgentWorkspaceDescriptor[]): void {
    writeFileAtomicSync(this.filePath, `${JSON.stringify({ workspaces: next }, null, 2)}\n`, { fsync: true });
  }

  browse(value: string): {
    path: string;
    parent: string | null;
    directories: readonly { path: string; name: string }[];
  } {
    const root = this.resolveDirectory(value);
    const parent = path.dirname(root);
    return {
      path: root,
      parent:
        parent !== root &&
        (!this.roots.length || this.roots.some((allowed) => relativePathWithin(allowed, parent) !== undefined))
          ? parent
          : null,
      directories: fs
        .readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
        .map((entry) => ({ path: path.join(root, entry.name), name: entry.name }))
        .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true })),
    };
  }
}

function sameDirectory(left: string, right: string): boolean {
  return path.relative(left, right) === "";
}
