import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import type { AgentToolComposition, AgentToolCompositionDeclaration } from "../ToolRuntime/AgentToolComposition.js";
import { isAgentToolComposable } from "../ToolRuntime/AgentToolCompositionPolicy.js";
import { isAgentToolAuthorized } from "../ToolRuntime/AgentToolAccessGrant.js";
import { isAgentToolAvailableForInteraction } from "../ToolRuntime/AgentToolInteractionAvailability.js";
import type { AgentExtensionRegistry } from "../Extensions/AgentExtensionRegistry.js";
import type { AgentPiToolProjectionContext } from "./AgentPiTypes.js";
import { readAgentUnknownRecord } from "../Core/AgentUnknownValue.js";
import type { AgentToolSearchRuntime } from "../ToolSearch/AgentToolSearchRuntime.js";

/** Freeze the session's callable catalog for one script; all calls still cross Pi's tool pipeline. */
export function createAgentPiToolComposition(
  registry: AgentExtensionRegistry,
  context: AgentPiToolProjectionContext,
  execution: ExtensionToolContext,
  discovery?: Pick<AgentToolSearchRuntime, "discoverAvailable">,
): AgentToolComposition {
  const grant = context.toolAccessGrant;
  const state = context.compositionState;
  if (!grant || !state) throw new Error("Tool composition requires session authorization and branch state.");
  const tools: AgentToolCompositionDeclaration[] = execution.tools.flatMap((descriptor) => {
    const tool = registry.getTool(descriptor.name);
    if (
      !tool ||
      !isAgentToolComposable(tool) ||
      !isAgentToolAuthorized(grant, tool) ||
      !isAgentToolAvailableForInteraction(tool, context.interaction)
    )
      return [];
    return [
      {
        name: descriptor.name,
        description: descriptor.description,
        inputSchema: { ...descriptor.parameters },
        ...(tool.contract?.outputSchema ? { outputSchema: tool.contract.outputSchema } : {}),
        namespace: {
          name: `${tool.owner.kind}:${tool.owner.name}`,
          title: tool.owner.title,
          description: tool.owner.description,
        },
      },
    ];
  });
  const names = new Set(tools.map((tool) => tool.name));
  const cancellation = new AbortController();
  const pending = new Set<Promise<unknown>>();
  function track<T>(signal: AbortSignal, run: () => Promise<T>): Promise<T> {
    const abort = () => cancellation.abort(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    const operation = run();
    pending.add(operation);
    void operation
      .finally(() => {
        pending.delete(operation);
        signal.removeEventListener("abort", abort);
      })
      .catch(() => undefined);
    return operation;
  }
  return {
    tools,
    state,
    signal: cancellation.signal,
    ...(discovery
      ? {
          search: (query: string, toolNames: readonly string[], signal: AbortSignal) =>
            track(signal, async () => {
              const result = await discovery.discoverAvailable({
                query,
                authorizedToolNames: toolNames.filter((name) => names.has(name)),
                interaction: context.interaction,
                signal,
              });
              return {
                names: [...result.match, ...result.maybe].map((entry) => entry.toolName),
                status: result.status,
                reason: result.reason,
                diagnostics: result.diagnostics,
              };
            }),
        }
      : {}),
    execute(name, args, signal) {
      return track(signal, async () => {
        if (!names.has(name)) throw new Error(`Tool ${name} is outside this script's authorized catalog.`);
        const input = readAgentUnknownRecord(args);
        if (!input) throw new Error(`Tool ${name} requires an argument object.`);
        const outcome = await execution.executeTool(name, input, { signal });
        if (outcome.isError) {
          const message = outcome.result.content
            .flatMap((part) => (part.type === "text" ? [part.text] : []))
            .join("\n");
          throw new Error(message || `Tool ${name} failed.`);
        }
        if (outcome.result.structuredContent === undefined)
          throw new Error(`Tool ${name} completed without a structured result.`);
        return outcome.result.structuredContent;
      });
    },
    async settle() {
      await Promise.allSettled([...pending]);
    },
  };
}
