import fs from "node:fs";
import { AgentConfigLoader } from "./AgentConfigLoader.js";
import type { AgentSystemConfig } from "./Types/AgentConfigTypes.js";
import { AgentEventKinds, type AgentEventSink } from "./AgentEvent.js";
import { emitAgentEvent } from "./AgentEvent.js";
import { serializeError } from "./AgentErrorSerializer.js";

export interface AgentConfigSnapshot {
  path: string;
  version: number;
  value: AgentSystemConfig;
}

export interface AgentConfigWatcherOptions {
  configPath: string;
  enabled: boolean;
  onEvent?: AgentEventSink;
}

export class AgentConfigWatcher {
  private snapshotValue: AgentConfigSnapshot;
  private watching = false;

  constructor(private readonly options: AgentConfigWatcherOptions) {
    this.snapshotValue = {
      path: options.configPath,
      version: 1,
      value: AgentConfigLoader.load(options.configPath),
    };
  }

  snapshot(): AgentConfigSnapshot {
    return this.snapshotValue;
  }

  start(): void {
    if (!this.options.enabled || this.watching) {
      return;
    }

    this.watching = true;
    fs.watchFile(this.options.configPath, { interval: 500 }, () => {
      void this.reload();
    });
  }

  stop(): void {
    if (!this.watching) {
      return;
    }

    fs.unwatchFile(this.options.configPath);
    this.watching = false;
  }

  private async reload(): Promise<void> {
    try {
      this.snapshotValue = {
        path: this.options.configPath,
        version: this.snapshotValue.version + 1,
        value: AgentConfigLoader.load(this.options.configPath),
      };

      await emitAgentEvent(this.options.onEvent, {
        kind: AgentEventKinds.ConfigReloaded,
        context: {},
        data: {
          configPath: this.options.configPath,
        },
      });
    } catch (error) {
      await emitAgentEvent(this.options.onEvent, {
        kind: AgentEventKinds.ConfigFailed,
        context: {},
        data: {
          configPath: this.options.configPath,
          message: error instanceof Error ? error.message : String(error),
          details: serializeError(error),
        },
      });
    }
  }
}
