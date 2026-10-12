import path from "node:path";
import fs from "node:fs/promises";
import { z } from "zod";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import { writeFileAtomic } from "../Core/AgentFs.js";
import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import type { AgentMcpToolDeclaration } from "../Mcp/AgentMcpToolCatalogChange.js";
import type { AgentMcpPackage, AgentMcpPackageServer, AgentMcpRuntimeEndpoint } from "./AgentMcpPackageTypes.js";

const CacheIdentitySchema = z
  .object({
    packageName: z.string().min(1),
    packageRevision: z.string().min(1),
    serverName: z.string().min(1),
    configurationDigest: z.string().min(1),
  })
  .strict();
const CacheDocumentSchema = z
  .object({
    version: z.literal(2),
    identity: CacheIdentitySchema,
    connectionDigest: z.string().min(1),
    declarations: z.array(
      z
        .object({
          name: z.string().min(1),
          description: z.string().optional(),
          inputSchema: z.record(z.string(), z.unknown()),
        })
        .passthrough(),
    ),
  })
  .strict();

export interface AgentMcpCachedDeclarations {
  readonly declarations: readonly AgentMcpToolDeclaration[];
  readonly connectionDigest: string;
}

/** Persist real protocol declarations independently of credentials and connection readiness. */
export class AgentMcpPackageSchemaCache {
  constructor(
    private readonly rootPath: string,
    private readonly logger?: Pick<AgentLogger, "warn" | "info">,
  ) {}

  async load(
    package_: AgentMcpPackage,
    server: AgentMcpPackageServer,
  ): Promise<AgentMcpCachedDeclarations | undefined> {
    const identity = declarationIdentity(package_, server);
    let source: string;
    try {
      source = await fs.readFile(this.filePath(identity), "utf8");
    } catch (error) {
      if (isMissingFile(error)) return undefined;
      throw error;
    }
    const document = CacheDocumentSchema.parse(JSON.parse(source));
    if (sha256HexOfCanonicalJson(document.identity) !== sha256HexOfCanonicalJson(identity))
      throw new Error(`MCP declaration cache identity mismatch for ${server.name}.`);
    this.logger?.info("mcp.schema_cache.hit", {
      packageName: package_.name,
      serverName: server.name,
      tools: document.declarations.length,
    });
    return { declarations: document.declarations, connectionDigest: document.connectionDigest };
  }

  async save(
    package_: AgentMcpPackage,
    server: AgentMcpPackageServer,
    endpoint: AgentMcpRuntimeEndpoint,
    declarations: readonly AgentMcpToolDeclaration[],
  ): Promise<void> {
    const identity = declarationIdentity(package_, server);
    const document = CacheDocumentSchema.parse({
      version: 2,
      identity,
      connectionDigest: agentMcpConnectionDigest(endpoint),
      declarations,
    });
    await writeFileAtomic(this.filePath(identity), `${JSON.stringify(document)}\n`, {
      mode: 0o600,
      directoryMode: 0o700,
    });
    this.logger?.info("mcp.schema_cache.saved", {
      packageName: package_.name,
      serverName: server.name,
      tools: declarations.length,
    });
  }

  private filePath(identity: z.infer<typeof CacheIdentitySchema>): string {
    return path.join(this.rootPath, `${sha256HexOfCanonicalJson({ version: 2, ...identity })}.json`);
  }
}

export function agentMcpConnectionDigest(endpoint: AgentMcpRuntimeEndpoint): string {
  return sha256HexOfCanonicalJson(endpoint);
}

function declarationIdentity(package_: AgentMcpPackage, server: AgentMcpPackageServer) {
  return {
    packageName: package_.name,
    packageRevision: package_.revision,
    serverName: server.name,
    configurationDigest: sha256HexOfCanonicalJson(server.configuration),
  };
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
