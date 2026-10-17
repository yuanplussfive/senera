import { resolvePersistenceConfig } from "../Source/AgentSystem/AgentDefaults.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";
import type { AgentWorkspaceLogPolicy } from "../Source/AgentSystem/Diagnostics/AgentWorkspaceLogStore.js";

export function createSeneraWorkspaceLogPolicy(configSnapshot: () => AgentSystemConfig): () => AgentWorkspaceLogPolicy {
  return () => {
    const logs = resolvePersistenceConfig(configSnapshot()).Logs;
    return {
      enabled: logs.Enabled,
      detailMaxBytes: logs.DetailMaxBytes,
      projectionMaxBytes: logs.ProjectionMaxBytes,
      retentionHours: logs.RetentionHours,
      queryPageSize: logs.QueryPageSize,
      tailLineCount: logs.TailLineCount,
    };
  };
}
