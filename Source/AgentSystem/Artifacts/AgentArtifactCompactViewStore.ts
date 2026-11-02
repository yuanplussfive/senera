import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { defineSeneraProtocol } from "../Core/AgentProtocolIdentity.js";
import { AgentResourceAccessIntents } from "../Safety/AgentResourceAccessPolicy.js";
import { SeneraWorkspaceBoundary } from "../Execution/SeneraWorkspaceBoundary.js";
import { parseAgentArtifactUri } from "./AgentArtifactLocator.js";
import { AgentArtifactFileWriter } from "./AgentArtifactFileWriter.js";

export const AgentArtifactCompactViewProtocol = defineSeneraProtocol("artifact_compact_view", 1);

const CompactViewFileName = ".llm-compact-view.json";

const StoredCompactViewSchema = z
  .object({
    type: z.literal(AgentArtifactCompactViewProtocol.type),
    artifactUri: z.string().min(1),
    summary: z.string().trim().min(1),
  })
  .strict();

export type StoredAgentArtifactCompactView = z.infer<typeof StoredCompactViewSchema>;

export class AgentArtifactCompactViewStore {
  private readonly boundary: SeneraWorkspaceBoundary;
  private readonly writer: AgentArtifactFileWriter;

  constructor(workspaceRoot: string) {
    this.boundary = new SeneraWorkspaceBoundary({ workspaceRoot, linkPolicy: "deny" });
    this.writer = new AgentArtifactFileWriter(workspaceRoot);
  }

  async write(input: { artifactUri: string; artifactPath: string; summary: string }): Promise<void> {
    assertArtifactIdentity(input.artifactUri, input.artifactPath);
    const targetPath = path.join(input.artifactPath, CompactViewFileName);
    const target = await this.boundary.resolve(targetPath, AgentResourceAccessIntents.Replace);
    await this.writer.writeJson(target.absolutePath, {
      type: AgentArtifactCompactViewProtocol.type,
      artifactUri: input.artifactUri,
      summary: input.summary,
    });
  }

  async read(artifactUri: string, artifactPath: string): Promise<StoredAgentArtifactCompactView | undefined> {
    assertArtifactIdentity(artifactUri, artifactPath);
    const filePath = path.join(artifactPath, CompactViewFileName);
    try {
      await fs.access(filePath);
    } catch (error) {
      if (isMissingFile(error)) return undefined;
      throw error;
    }
    const opened = await this.boundary.openFile(filePath, AgentResourceAccessIntents.Read);
    try {
      const parsed = StoredCompactViewSchema.parse(JSON.parse(await opened.handle.readFile({ encoding: "utf8" })));
      if (parsed.artifactUri !== artifactUri) {
        throw new Error(`Compact view identity does not match ${artifactUri}.`);
      }
      return parsed;
    } finally {
      await opened.handle.close();
    }
  }
}

function assertArtifactIdentity(artifactUri: string, artifactPath: string): void {
  if (!parseAgentArtifactUri(artifactUri)) throw new TypeError("Compact view requires a canonical Artifact URI.");
  if (!path.isAbsolute(artifactPath)) throw new TypeError("Compact view requires an absolute Artifact directory.");
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
