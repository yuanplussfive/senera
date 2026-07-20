import { spawn } from "node:child_process";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { rgPath } from "@vscode/ripgrep";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import { resolveAgentRipgrepWorkspaceTarget } from "./AgentRipgrepWorkspace.js";

const RipgrepTools = {
  search: "search",
  listFiles: "list-files",
} as const;

interface RipgrepExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

const server = new Server(
  {
    name: "senera-ripgrep-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: RipgrepTools.search,
      description: "Search file contents with ripgrep.",
      inputSchema: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          path: { type: "string" },
          caseSensitive: { type: "boolean" },
          filePattern: { type: "string" },
          maxResults: { type: "number" },
          context: { type: "number" },
        },
        required: ["pattern", "path"],
      },
    },
    {
      name: RipgrepTools.listFiles,
      description: "List files visible to ripgrep.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          filePattern: { type: "string" },
          fileType: { type: "string" },
          includeHidden: { type: "boolean" },
        },
        required: ["path"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const args = readRecord(request.params.arguments);
  const requestedPath = readRequiredString(args.path, "path");
  const target = await resolveAgentRipgrepWorkspaceTarget(process.cwd(), requestedPath);
  const result = await runRipgrep(ripgrepArgs(request.params.name, args, target.searchPath), target.cwd);
  const text = result.stderr && result.exitCode !== 0 ? `${result.stdout}${result.stderr}` : result.stdout;

  return {
    content: [{ type: "text", text }],
    structuredContent: {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      signal: result.signal,
    },
    isError: ![0, 1].includes(result.exitCode ?? 1),
  };
});

await server.connect(new StdioServerTransport());

function ripgrepArgs(toolName: string, args: Record<string, unknown>, searchPath: string): string[] {
  const toolArgs: Record<string, () => string[]> = {
    [RipgrepTools.search]: () => searchArgs(args, searchPath),
    [RipgrepTools.listFiles]: () => listFilesArgs(args, searchPath),
  };
  const createArgs = toolArgs[toolName];
  if (!createArgs) {
    throw new Error(agentErrorMessage("mcp.ripgrepUnsupportedTool", { toolName }));
  }

  return createArgs();
}

function searchArgs(args: Record<string, unknown>, searchPath: string): string[] {
  return [
    "--color",
    "never",
    "--line-number",
    "--column",
    ...optionalFlag(args.caseSensitive === false, "--ignore-case"),
    ...optionalValueFlag("--glob", readString(args.filePattern)),
    ...optionalValueFlag("--max-count", readPositiveInteger(args.maxResults)),
    ...optionalValueFlag("--context", readNonNegativeInteger(args.context)),
    "--regexp",
    readRequiredString(args.pattern, "pattern"),
    "--",
    searchPath,
  ];
}

function listFilesArgs(args: Record<string, unknown>, searchPath: string): string[] {
  return [
    "--files",
    "--color",
    "never",
    ...optionalFlag(args.includeHidden === true, "--hidden"),
    ...optionalValueFlag("--glob", readString(args.filePattern)),
    ...optionalValueFlag("--type", readString(args.fileType)),
    "--",
    searchPath,
  ];
}

function runRipgrep(args: readonly string[], cwd: string): Promise<RipgrepExecutionResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(rgPath, [...args], {
      cwd,
      windowsHide: true,
    });
    const chunks = {
      stdout: [] as Buffer[],
      stderr: [] as Buffer[],
    };

    child.stdout.on("data", (chunk: Buffer) => chunks.stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => chunks.stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (exitCode, signal) =>
      resolve({
        stdout: Buffer.concat(chunks.stdout).toString("utf8"),
        stderr: Buffer.concat(chunks.stderr).toString("utf8"),
        exitCode,
        signal,
      }),
    );
  });
}

function optionalFlag(enabled: boolean, flag: string): string[] {
  return enabled ? [flag] : [];
}

function optionalValueFlag(flag: string, value: string | undefined): string[] {
  return value ? [flag, value] : [];
}

function readRequiredString(value: unknown, name: string): string {
  const text = readString(value);
  if (!text) {
    throw new Error(agentErrorMessage("mcp.requiredNonEmptyString", { name }));
  }

  return text;
}

function readString(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > 0 ? text : undefined;
}

function readPositiveInteger(value: unknown): string | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? String(value) : undefined;
}

function readNonNegativeInteger(value: unknown): string | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? String(value) : undefined;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
