import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CodemodeSandbox, loadQuickJSWasm } from "@earendil-works/pi-codemode";
import { createAgentCodemodeToolCatalog } from "./AgentCodemodeToolCatalog.js";
import { AgentCodemodeConfigurationSchema } from "./AgentCodemodeContract.js";
import { AgentConcurrencyGate } from "../Core/AgentConcurrencyGate.js";
import { throwIfAborted } from "../Core/AgentCancellation.js";
import { AgentKeyedLeaseQueue } from "../Core/AgentKeyedLeaseQueue.js";
import { resolveAsarUnpackedExecutablePath } from "../Core/AgentExecutablePath.js";
import { defineSystemTool, systemToolArguments, systemToolExecutionResult } from "./AgentSystemToolDefinition.js";
import type { AgentHostToolContext } from "../ToolRuntime/AgentToolHostCapabilityRegistry.js";
import { AgentExecutionErrorCodes, AgentToolProcessErrorPhases } from "../Xml/AgentXmlStatus.js";

/** The official VM owns JavaScript; Senera owns every external capability and result. */
export function createCodemodeSystemTool(configuration?: Record<string, unknown>) {
  const settings = AgentCodemodeConfigurationSchema.parse(configuration ?? {});
  const workers = new AgentConcurrencyGate(settings.maxConcurrentScripts);
  const sessions = new AgentKeyedLeaseQueue<string>();

  async function execute(input: Record<string, unknown>, context: AgentHostToolContext) {
    const { code } = systemToolArguments<{ code: string }>(input);
    const composition = context.composition;
    if (!composition || !context.sessionId) throw new Error("Codemode requires an authorized active Pi session.");
    return sessions.run(
      context.sessionId,
      async () => {
        const codemodeRequire = createRequire(import.meta.resolve("@earendil-works/pi-codemode"));
        const wasmPath = resolveAsarUnpackedExecutablePath(codemodeRequire.resolve("quickjs-wasi/quickjs.wasm"));
        const workerUrl = pathToFileURL(
          resolveAsarUnpackedExecutablePath(fileURLToPath(import.meta.resolve("@earendil-works/pi-codemode/worker"))),
        );
        const { tools, globals } = createAgentCodemodeToolCatalog(composition);
        const release = await workers.acquire(context.signal);
        let started = false;
        let sandbox: CodemodeSandbox | undefined;
        try {
          sandbox = new CodemodeSandbox({
            tools,
            globals,
            timeoutMs: Infinity,
            memoryLimitBytes: settings.memoryLimitMiB * 1024 * 1024,
            wasm: loadQuickJSWasm(wasmPath),
            workerUrl,
            acquireWorker: () => {
              throwIfAborted(context.signal);
              started = true;
              return release;
            },
          });
          const startedAt = performance.now();
          const result = await sandbox.execute(code, { signal: context.signal, store: composition.state.read() });
          await composition.settle();
          const output = {
            status: result.ok ? "completed" : "failed",
            output: result.output,
            ...(result.ok && result.value !== undefined ? { value: result.value } : {}),
            calls: result.calls.map((call) => ({ ...call, durationMs: Math.round(call.durationMs) })),
            durationMs: Math.round(performance.now() - startedAt),
            ...(!result.ok ? { error: result.error } : {}),
          };
          if (result.ok) composition.state.commit(result.storeWrites);
          return systemToolExecutionResult(output, {
            ...(!result.ok
              ? {
                  artifactPayload: { rawResponse: output },
                  failure: {
                    code: AgentExecutionErrorCodes.ToolExecutionError,
                    message: result.error.message,
                    details: {
                      phase: AgentToolProcessErrorPhases.RuntimeExecution,
                      kind: result.error.kind,
                      partialOutput: result.output,
                      calls: result.calls,
                    },
                  },
                }
              : {}),
          });
        } finally {
          try {
            await sandbox?.close();
          } finally {
            if (!started) release();
          }
        }
      },
      context.signal,
    );
  }

  return defineSystemTool({
    capability: "system.tool.codemode.run",
    execute: async (input, context) => (await execute(input, context)).result,
    executeWithArtifacts: execute,
  });
}
