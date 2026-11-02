import { toCodemodeIdentifier, type CodemodeTool } from "@earendil-works/pi-codemode";
import { z } from "zod";
import { projectAgentToolScriptDeclaration } from "../ToolContracts/AgentToolScriptContract.js";
import type { AgentToolComposition } from "../ToolRuntime/AgentToolComposition.js";

const Name = z.string().trim().min(1);
const SearchArguments = z.tuple([
  Name,
  z.object({ limit: z.number().int().positive().safe().optional(), namespace: Name.optional() }).strict().optional(),
]);

const DeclarationType =
  "{ name: string; description: string; inputSchema: Record<string, unknown>; outputSchema?: Record<string, unknown>; namespace?: { name: string; title?: string; description?: string }; declaration: string }";

/** One authorized catalog supplies invocation, discovery and declarations for the entire script. */
export function createAgentCodemodeToolCatalog(composition: AgentToolComposition) {
  const declarations = new Map(composition.tools.map((tool) => [tool.name, projectAgentToolScriptDeclaration(tool)]));
  const identifiers = new Map(composition.tools.map((tool) => [toCodemodeIdentifier(tool.name), tool.name]));
  if (identifiers.size !== composition.tools.length)
    throw new Error("Authorized tools contain conflicting JavaScript identifiers.");
  const namespaces = new Map(
    composition.tools.flatMap((tool) => (tool.namespace ? [[tool.namespace.name, tool.namespace] as const] : [])),
  );
  const describe = (value: unknown) => {
    const name = Name.parse(value);
    const tool = declarations.get(identifiers.get(name) ?? name);
    if (!tool) throw new Error(`Tool ${name} is outside this script's authorized catalog.`);
    return tool;
  };
  const describeNamespace = (value: unknown) => {
    const name = Name.parse(value);
    const namespace = namespaces.get(name);
    if (!namespace) throw new Error(`Namespace ${name} is outside this script's authorized catalog.`);
    return {
      ...namespace,
      tools: composition.tools.filter((tool) => tool.namespace?.name === name).map((tool) => tool.name),
    };
  };
  const tools: CodemodeTool[] = [...declarations.values()].map((tool) => ({
    ...tool,
    description: tool.declaration,
    execute: (args, call) => composition.execute(tool.name, args, call.signal),
  }));
  const globals: CodemodeTool[] = [
    {
      name: "describeTool",
      description: "Read the current input/output schemas and declaration when a tool contract is unknown.",
      signature: `(name: string): Promise<${DeclarationType}>`,
      execute: describe,
    },
    {
      name: "describeNamespace",
      description: "List authorized tools belonging to a producer namespace returned by tool discovery.",
      signature: "(name: string): Promise<{ name: string; title?: string; description?: string; tools: string[] }>",
      execute: describeNamespace,
    },
    {
      name: "searchTools",
      description: "Search the frozen callable catalog with Senera's shared tool retrieval service.",
      signature: `(query: string, options?: { limit?: number; namespace?: string }): Promise<{ tools: ${DeclarationType}[]; hasMore: boolean; status?: string; reason?: string; diagnostics?: string[] }>`,
      spread: true,
      execute: async (args, call) => {
        const [query, options] = SearchArguments.parse(args);
        if (!composition.search) throw new Error("Tool retrieval is unavailable in this runtime.");
        if (options?.namespace) describeNamespace(options.namespace);
        const names = composition.tools
          .filter((tool) => !options?.namespace || tool.namespace?.name === options.namespace)
          .map((tool) => tool.name);
        const allowed = new Set(names);
        const result = await composition.search(query, names, call.signal);
        const matches = [...new Set(result.names)].filter((name) => allowed.has(name));
        const selected = options?.limit === undefined ? matches : matches.slice(0, options.limit);
        return {
          tools: selected.map(describe),
          hasMore: selected.length < matches.length,
          ...(result.status ? { status: result.status } : {}),
          ...(result.reason ? { reason: result.reason } : {}),
          ...(result.diagnostics?.length ? { diagnostics: result.diagnostics } : {}),
        };
      },
    },
  ];
  return { tools, globals };
}
