import { createRequire } from "node:module";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { SeneraProcessExecutionProfile } from "../Execution/SeneraExecutionProfile.js";
import type { SeneraPersistentProcessSpawner } from "../Execution/SeneraPersistentProcessTypes.js";
import {
  AgentMcpDefaultFrameBytes,
  AgentMcpDefaultStderrBytes,
  AgentMcpStdioTransport,
} from "./AgentMcpStdioTransport.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";

const nodeRequire = createRequire(import.meta.url);

const McpFilesystemServerPackageName = "@modelcontextprotocol/server-filesystem";

const McpFilesystemToolNames = {
  readTextFile: "read_text_file",
  listDirectory: "list_directory",
  directoryTree: "directory_tree",
  searchFiles: "search_files",
  getFileInfo: "get_file_info",
  listAllowedDirectories: "list_allowed_directories",
} as const;

const DirectoryEntryPrefixes = [
  { prefix: "[DIR] ", kind: "directory" },
  { prefix: "[FILE] ", kind: "file" },
] as const;

export interface AgentMcpFilesystemClientOptions {
  workspaceRoot: string;
  requestTimeoutMs: number;
  spawnPersistentProcess: SeneraPersistentProcessSpawner;
  executionProfile: SeneraProcessExecutionProfile;
  terminationGraceMs: number;
  signal?: AbortSignal;
}

export interface AgentMcpDirectoryEntry {
  name: string;
  kind: "directory" | "file";
}

export interface AgentMcpFileInfo {
  size: number;
  isDirectory: boolean;
  isFile: boolean;
  raw: Record<string, string>;
}

interface NodePackageJson {
  bin?: string | Record<string, string>;
}

export async function withAgentMcpFilesystemClient<TValue>(
  options: AgentMcpFilesystemClientOptions,
  operation: (client: AgentMcpFilesystemClient) => Promise<TValue>,
): Promise<TValue> {
  const transport = new AgentMcpStdioTransport({
    command: process.execPath,
    args: [resolveMcpFilesystemServerEntry(), options.workspaceRoot],
    cwd: options.workspaceRoot,
    signal: options.signal,
    profile: options.executionProfile,
    spawnPersistentProcess: options.spawnPersistentProcess,
    terminationGraceMs: options.terminationGraceMs,
    maxFrameBytes: AgentMcpDefaultFrameBytes,
    maxStderrBytes: AgentMcpDefaultStderrBytes,
  });
  const client = new Client(
    {
      name: "senera-mcp-filesystem-client",
      version: "0.1.0",
    },
    {
      capabilities: {},
      enforceStrictCapabilities: true,
    },
  );

  await client.connect(transport, mcpRequestOptions(options));
  try {
    return await operation(new AgentMcpFilesystemClient(client, options));
  } finally {
    await client.close();
  }
}

export class AgentMcpFilesystemClient {
  constructor(
    private readonly client: Client,
    private readonly options: AgentMcpFilesystemClientOptions,
  ) {}

  readTextFile(filePath: string): Promise<string> {
    return this.callText(McpFilesystemToolNames.readTextFile, { path: filePath });
  }

  async listDirectory(directoryPath: string): Promise<AgentMcpDirectoryEntry[]> {
    const text = await this.callText(McpFilesystemToolNames.listDirectory, { path: directoryPath });
    return text
      .split(/\r?\n/u)
      .map(readDirectoryEntryLine)
      .filter((entry): entry is AgentMcpDirectoryEntry => Boolean(entry));
  }

  async directoryTree(directoryPath: string, excludePatterns: readonly string[]): Promise<unknown[]> {
    const text = await this.callText(McpFilesystemToolNames.directoryTree, {
      path: directoryPath,
      excludePatterns: [...excludePatterns],
    });
    const parsed = JSON.parse(text) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  }

  async searchFiles(input: {
    rootPath: string;
    pattern: string;
    excludePatterns: readonly string[];
  }): Promise<string[]> {
    const text = await this.callText(McpFilesystemToolNames.searchFiles, {
      path: input.rootPath,
      pattern: input.pattern,
      excludePatterns: [...input.excludePatterns],
    });
    return text === "No matches found"
      ? []
      : text
          .split(/\r?\n/u)
          .map((line) => line.trim())
          .filter(Boolean);
  }

  async getFileInfo(filePath: string): Promise<AgentMcpFileInfo> {
    const text = await this.callText(McpFilesystemToolNames.getFileInfo, { path: filePath });
    const raw = Object.fromEntries(
      text
        .split(/\r?\n/u)
        .map(readInfoLine)
        .filter((entry): entry is [string, string] => Boolean(entry)),
    );

    return {
      raw,
      size: Number.parseInt(raw.size ?? "0", 10) || 0,
      isDirectory: raw.isDirectory === "true",
      isFile: raw.isFile === "true",
    };
  }

  listAllowedDirectories(): Promise<string[]> {
    return this.callText(McpFilesystemToolNames.listAllowedDirectories, {}).then((text) =>
      text
        .split(/\r?\n/u)
        .slice(1)
        .map((line) => line.trim())
        .filter(Boolean),
    );
  }

  private async callText(name: string, args: Record<string, unknown>): Promise<string> {
    const result = await this.client.callTool({ name, arguments: args }, undefined, mcpRequestOptions(this.options));
    return extractMcpText(result);
  }
}

function resolveMcpFilesystemServerEntry(): string {
  const packageJsonPath = nodeRequire.resolve(`${McpFilesystemServerPackageName}/package.json`);
  const packageRoot = path.dirname(packageJsonPath);
  const packageJson = nodeRequire(packageJsonPath) as NodePackageJson;
  const binEntry = readPackageBinEntry(packageJson);
  if (!binEntry) {
    throw new Error(
      agentErrorMessage("mcp.packageMissingBin", {
        packageName: McpFilesystemServerPackageName,
      }),
    );
  }

  return path.resolve(packageRoot, binEntry);
}

function readPackageBinEntry(packageJson: NodePackageJson): string | undefined {
  return typeof packageJson.bin === "string" ? packageJson.bin : Object.values(packageJson.bin ?? {})[0];
}

function mcpRequestOptions(options: AgentMcpFilesystemClientOptions): RequestOptions {
  return {
    signal: options.signal,
    timeout: options.requestTimeoutMs,
  };
}

function extractMcpText(value: unknown): string {
  const record = readRecord(value);
  const structured = readRecord(record.structuredContent);
  if (typeof structured.content === "string") {
    return structured.content;
  }

  const content = Array.isArray(record.content) ? record.content : [];
  return content
    .map((item) => readRecord(item).text)
    .filter((text): text is string => typeof text === "string")
    .join("\n");
}

function readDirectoryEntryLine(line: string): AgentMcpDirectoryEntry | undefined {
  const prefix = DirectoryEntryPrefixes.find((item) => line.startsWith(item.prefix));
  return prefix
    ? {
        kind: prefix.kind,
        name: line.slice(prefix.prefix.length).trim(),
      }
    : undefined;
}

function readInfoLine(line: string): [string, string] | undefined {
  const separatorIndex = line.indexOf(":");
  return separatorIndex > 0 ? [line.slice(0, separatorIndex).trim(), line.slice(separatorIndex + 1).trim()] : undefined;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
