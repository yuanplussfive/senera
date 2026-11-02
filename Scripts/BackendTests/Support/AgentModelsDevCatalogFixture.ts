import { AgentModelsDevCatalog } from "../../../Source/AgentSystem/ModelEndpoints/AgentModelsDevCatalog.js";

/** Seed the real cache so protocol fixtures never depend on the public network. */
export async function seedTestModelsDevCatalog(workspaceRoot: string): Promise<void> {
  const catalog = new AgentModelsDevCatalog({
    workspaceRoot,
    fetchImpl: async () => Response.json({ models: { "test-model": { name: "Test model" } } }),
  });
  await catalog.snapshot();
}
