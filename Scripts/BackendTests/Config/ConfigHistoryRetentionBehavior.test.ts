import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, test } from "vitest";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import {
  AgentConfigCommandIdConflictError,
  AgentConfigSqliteRepository,
} from "../../../Source/AgentSystem/Config/AgentConfigSqliteRepository.js";
import type { AgentConfigHistoryRetentionPolicy } from "../../../Source/AgentSystem/Config/AgentConfigHistoryRetention.js";
import { AgentConfigService } from "../../../Source/AgentSystem/Config/AgentConfigService.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const Retention: AgentConfigHistoryRetentionPolicy = {
  revisionRetentionCount: 1,
  commandReceiptRetentionHours: 1,
  commandReceiptMaxCount: 2,
};

describe("Configuration history retention", () => {
  test("bounds command receipts while retaining every revision referenced by the idempotency window", () => {
    const fixture = createRepository();
    try {
      fixture.repository.appendRevision({
        config: config(0),
        source: "seed",
        createdAt: timestamp(0),
        retention: Retention,
      });
      for (let index = 1; index <= 3; index += 1) {
        fixture.repository.executeCommand(
          {
            commandId: `command-${index}`,
            operationKind: "config.update",
            payloadHash: `payload-${index}`,
            source: "ui_update",
            createdAt: timestamp(index),
            retention: Retention,
          },
          () => config(index),
        );
      }

      expect(readHistory(fixture.databasePath)).toEqual({
        receipts: [
          { command_id: "command-2", revision: 3 },
          { command_id: "command-3", revision: 4 },
        ],
        revisions: [3, 4],
      });
    } finally {
      fixture.cleanup();
    }
  });

  test("treats an evicted command id as a new command but still detects conflicts inside the window", () => {
    const fixture = createRepository();
    try {
      fixture.repository.appendRevision({ config: config(0), source: "seed", retention: Retention });
      for (let index = 1; index <= 3; index += 1) {
        fixture.repository.executeCommand(command(`command-${index}`, `payload-${index}`, timestamp(index)), () =>
          config(index),
        );
      }

      expect(() =>
        fixture.repository.executeCommand(command("command-3", "different", timestamp(4)), () => config(4)),
      ).toThrow(AgentConfigCommandIdConflictError);

      const reapplied = fixture.repository.executeCommand(command("command-1", "different", timestamp(5)), () =>
        config(5),
      );
      expect(reapplied).toMatchObject({ replayed: false, revision: { revision: 5 } });
      expect(readHistory(fixture.databasePath).receipts.map((receipt) => receipt.command_id)).toEqual([
        "command-3",
        "command-1",
      ]);
    } finally {
      fixture.cleanup();
    }
  });

  test("expires receipts by age before checking command idempotency", () => {
    const fixture = createRepository();
    try {
      fixture.repository.appendRevision({ config: config(0), source: "seed", retention: Retention });
      fixture.repository.executeCommand(command("expired-command", "first", timestamp(0)), () => config(1));

      const reapplied = fixture.repository.executeCommand(command("expired-command", "second", timestamp(61)), () =>
        config(2),
      );

      expect(reapplied.replayed).toBe(false);
      expect(readHistory(fixture.databasePath).receipts).toEqual([{ command_id: "expired-command", revision: 3 }]);
    } finally {
      fixture.cleanup();
    }
  });

  test("applies the same bounded receipt policy to the JSON configuration source", () => {
    const directory = createTemporaryDirectory("senera-json-config-retention");
    const configPath = path.join(directory, "senera.config.json");
    fs.writeFileSync(configPath, `${JSON.stringify(jsonSourceConfig(), null, 2)}\n`, "utf8");
    const service = new AgentConfigService({
      workspaceRoot: directory,
      source: { kind: "json", configPath },
    });
    try {
      service.setDefaultProviderModel({ commandId: "command-a", modelId: "custom/a" });
      service.setDefaultProviderModel({ commandId: "command-b", modelId: "custom/b" });
      service.setDefaultProviderModel({ commandId: "command-c", modelId: "custom/a" });

      expect(() => service.setDefaultProviderModel({ commandId: "command-a", modelId: "custom/b" })).not.toThrow();
      expect(service.snapshot().value.DefaultModelProviderId).toBe("custom/b");
    } finally {
      service.close();
      removeDirectory(directory);
    }
  });
});

function command(commandId: string, payloadHash: string, createdAt: string) {
  return {
    commandId,
    operationKind: "config.update",
    payloadHash,
    source: "ui_update" as const,
    createdAt,
    retention: Retention,
  };
}

function config(index: number): AgentSystemConfig {
  return { ModelProviders: [], DefaultModelProviderId: `model-${index}` };
}

function jsonSourceConfig(): AgentSystemConfig {
  return {
    ConfigStore: {
      Enabled: false,
      RevisionRetentionCount: 1,
      CommandReceiptRetentionHours: 1,
      CommandReceiptMaxCount: 2,
    },
    DefaultModelProviderId: "custom/a",
    ModelProviderEndpoints: [{ Id: "custom", BaseUrl: "https://models.example.test/v1" }],
    ModelProviders: [
      {
        Id: "custom/a",
        ProviderId: "custom",
        Endpoint: "ChatCompletions",
        Model: "model-a",
        Capabilities: { Chat: true },
      },
      {
        Id: "custom/b",
        ProviderId: "custom",
        Endpoint: "ChatCompletions",
        Model: "model-b",
        Capabilities: { Chat: true },
      },
    ],
  };
}

function timestamp(offsetMinutes: number): string {
  return new Date(Date.UTC(2026, 0, 1, 0, offsetMinutes)).toISOString();
}

function readHistory(databasePath: string): {
  receipts: Array<{ command_id: string; revision: number }>;
  revisions: number[];
} {
  const database = new Database(databasePath, { readonly: true });
  try {
    return {
      receipts: database
        .prepare("SELECT command_id, revision FROM config_command_receipts ORDER BY created_at, command_id")
        .all() as Array<{ command_id: string; revision: number }>,
      revisions: (
        database.prepare("SELECT revision FROM config_revisions ORDER BY revision").all() as Array<{
          revision: number;
        }>
      ).map((row) => row.revision),
    };
  } finally {
    database.close();
  }
}

function createRepository(): {
  repository: AgentConfigSqliteRepository;
  databasePath: string;
  cleanup: () => void;
} {
  const directory = createTemporaryDirectory("senera-config-retention");
  const databasePath = path.join(directory, "config.db");
  const repository = new AgentConfigSqliteRepository(databasePath);
  return {
    repository,
    databasePath,
    cleanup: () => {
      repository.close();
      removeDirectory(directory);
    },
  };
}
