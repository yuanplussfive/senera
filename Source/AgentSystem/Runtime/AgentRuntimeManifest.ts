import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveAgentWorkspaceLayout } from "../Core/AgentWorkspaceLayout.js";
import { AgentWorkspaceIdSchema, type AgentWorkspaceId } from "../WorkspaceResources/AgentWorkspaceCatalogContract.js";
import { z } from "zod/mini";

export const AgentSelfProtocolVersion = 1 as const;

const AgentRuntimeManifestFileName = "runtime.json" as const;

export const AgentRuntimeManifestSchema = z.strictObject({
  pid: z.number().check(z.int(), z.positive()),
  startedAt: z.iso.datetime(),
  host: z.string().check(z.trim(), z.minLength(1)),
  port: z.number().check(z.int(), z.minimum(1), z.maximum(65_535)),
  token: z.string().check(z.minLength(1)),
  protocol: z.literal(AgentSelfProtocolVersion),
  workspaceId: z.optional(AgentWorkspaceIdSchema),
});

export type AgentRuntimeManifest = z.infer<typeof AgentRuntimeManifestSchema>;

export function resolveAgentRuntimeManifestPath(workspaceRoot: string): string {
  return path.join(resolveAgentWorkspaceLayout(workspaceRoot).stateRoot, AgentRuntimeManifestFileName);
}

export function readAgentRuntimeManifest(workspaceRoot: string): AgentRuntimeManifest | undefined {
  try {
    const raw = fs.readFileSync(resolveAgentRuntimeManifestPath(workspaceRoot), "utf8");
    const parsed = AgentRuntimeManifestSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** Detects whether the process that wrote the manifest is still alive. */
export function isAgentRuntimeAlive(manifest: AgentRuntimeManifest): boolean {
  if (manifest.pid <= 0) return false;
  try {
    process.kill(manifest.pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export interface AgentRuntimeManifestStoreOptions {
  readonly now?: () => Date;
  readonly stateRoot?: string;
}

/**
 * Owns the per-workspace `.senera/runtime.json` file that lets the standalone
 * `senera` CLI discover and authenticate against the running service. The
 * token is generated per process start; `stop()` only removes the file when
 * this process still owns it, so a newer instance on the same workspace is
 * never clobbered.
 */
export class AgentRuntimeManifestStore {
  private readonly workspaceRoot: string;
  private readonly now: () => Date;
  private readonly manifestPath: string;
  private token: string | undefined;

  constructor(workspaceRoot: string, options: AgentRuntimeManifestStoreOptions = {}) {
    this.workspaceRoot = workspaceRoot;
    this.now = options.now ?? (() => new Date());
    this.manifestPath = options.stateRoot
      ? path.join(options.stateRoot, AgentRuntimeManifestFileName)
      : resolveAgentRuntimeManifestPath(workspaceRoot);
  }

  get isBound(): boolean {
    return this.token !== undefined;
  }

  start(input: { host: string; port: number; workspaceId?: AgentWorkspaceId }): { readonly token: string } {
    const token = randomBytes(32).toString("base64url");
    const manifest = AgentRuntimeManifestSchema.parse({
      pid: process.pid,
      startedAt: this.now().toISOString(),
      host: input.host,
      port: input.port,
      token,
      protocol: AgentSelfProtocolVersion,
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    });
    fs.mkdirSync(path.dirname(this.manifestPath), { recursive: true });
    fs.writeFileSync(this.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      mode: 0o600,
      encoding: "utf8",
    });
    this.token = token;
    return { token };
  }

  stop(): void {
    if (!this.token) return;
    const manifest = readAgentRuntimeManifest(this.workspaceRoot);
    if (!manifest || manifest.pid !== process.pid) return;
    try {
      fs.unlinkSync(this.manifestPath);
    } catch {
      // best effort on Windows
    }
    this.token = undefined;
  }
}
