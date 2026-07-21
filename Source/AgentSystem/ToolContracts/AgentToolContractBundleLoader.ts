import path from "node:path";
import { AgentJsonFileLoader } from "../Config/AgentJsonFileLoader.js";
import { resolveFrom } from "../Core/AgentPath.js";
import { assertToolContractSchema } from "../ToolRuntime/AgentToolSignatureArgumentValidator.js";
import { AgentToolContractBundleSchema } from "./AgentToolContractSchema.js";
import type { AgentToolContractBundle } from "./AgentToolContractTypes.js";

export class AgentToolContractBundleLoader {
  private readonly bundles = new Map<string, AgentToolContractBundle>();

  load(pluginRoot: string, contractFile: string): AgentToolContractBundle {
    const bundlePath = resolveInsidePluginRoot(pluginRoot, contractFile);
    const cached = this.bundles.get(bundlePath);
    if (cached) return cached;

    const bundle = deepFreeze(new AgentJsonFileLoader().load(bundlePath, AgentToolContractBundleSchema));
    for (const definition of Object.values(bundle.tools)) {
      assertToolContractSchema(definition.inputSchema);
      if (definition.outputSchema) assertToolContractSchema(definition.outputSchema);
    }
    this.bundles.set(bundlePath, bundle);
    return bundle;
  }
}

function resolveInsidePluginRoot(pluginRoot: string, contractFile: string): string {
  const absoluteRoot = path.resolve(pluginRoot);
  const absoluteFile = resolveFrom(absoluteRoot, contractFile);
  const relative = path.relative(absoluteRoot, absoluteFile);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Tool contract bundle must stay inside its plugin root: ${contractFile}`);
  }
  return absoluteFile;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  return Object.freeze(value);
}
