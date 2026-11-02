import { schemaToType, toCodemodeIdentifier, type CodemodeTool } from "@earendil-works/pi-codemode";
import { z } from "zod";
import { projectAgentToolScriptDeclaration } from "../ToolContracts/AgentToolScriptContract.js";
import type { AgentToolComposition } from "../ToolRuntime/AgentToolComposition.js";

const Name = z.string().trim().min(1);
const SearchOptions = z
  .object({ limit: z.number().int().positive().safe().optional(), namespace: Name.optional() })
  .strict();
const SearchArguments = z.tuple([Name, SearchOptions.optional()]);

const Namespace = z.object({ name: Name, title: z.string().optional(), description: z.string().optional() });
const ToolSummary = z.object({ name: Name, description: z.string(), namespace: Namespace.optional() });
const JsonSchema = z.record(z.string(), z.unknown());
const ToolDescription = ToolSummary.extend({
  inputSchema: JsonSchema,
  outputSchema: JsonSchema.optional(),
  declaration: z.string(),
});
const SearchResult = z.object({
  tools: z.array(ToolSummary),
  hasMore: z.boolean(),
  status: z.string().optional(),
  reason: z.string().optional(),
  diagnostics: z.array(z.string()).optional(),
});

/** One authorized catalog supplies invocation, discovery and declarations for the entire script. */
export function createAgentCodemodeToolCatalog(composition: AgentToolComposition) {
  const declarations = new Map(composition.tools.map((tool) => [tool.name, tool]));
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
    return projectAgentToolScriptDeclaration(tool);
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
  const tools: CodemodeTool[] = composition.tools.map((tool) => ({
    ...tool,
    execute: (args, call) => composition.execute(tool.name, args, call.signal),
  }));
  const globals: CodemodeTool[] = [
    {
      name: "describeTool",
      description: "Read the current input/output schemas and declaration when a tool contract is unknown.",
      inputSchema: z.toJSONSchema(Name),
      outputSchema: z.toJSONSchema(ToolDescription),
      execute: describe,
    },
    {
      name: "describeNamespace",
      description: "List authorized tools belonging to a producer namespace returned by tool discovery.",
      inputSchema: z.toJSONSchema(Name),
      outputSchema: z.toJSONSchema(Namespace.extend({ tools: z.array(Name) })),
      execute: describeNamespace,
    },
    {
      name: "searchTools",
      description:
        "Search authorized tool names and summaries. Read exact contracts with describeTool(name) before invoking an unknown tool.",
      signature: `(query: string, options?: ${schemaToType(z.toJSONSchema(SearchOptions))}): Promise<${schemaToType(z.toJSONSchema(SearchResult))}>`,
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
          tools: selected.map((name) => {
            const { description, namespace } = declarations.get(name)!;
            return { name, description, ...(namespace ? { namespace } : {}) };
          }),
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
