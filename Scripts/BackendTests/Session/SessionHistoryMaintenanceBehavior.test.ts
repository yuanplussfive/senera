import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, test } from "vitest";
import {
  AgentEventChannels,
  AgentEventKinds,
  AgentEventLayers,
  AgentEventPhases,
} from "../../../Source/AgentSystem/Events/AgentEventCatalog.js";
import { AgentSessionHistoryMaintenance } from "../../../Source/AgentSystem/SessionPersistence/AgentSessionHistoryMaintenance.js";
import { installAgentSessionSchema } from "../../../Source/AgentSystem/SessionPersistence/AgentSessionSqlSchema.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("session history maintenance", () => {
  test("analyzes by default and rewrites old Pi traces only when explicitly applied", async () => {
    const databasePath = createHistoryDatabase();
    const maintenance = new AgentSessionHistoryMaintenance();
    const progress: number[] = [];

    const analysis = await maintenance.compact({
      databasePath,
      batchSize: 1,
      onBatch: (entry) => {
        progress.push(entry.scannedEvents);
      },
    });

    expect(analysis).toMatchObject({
      dryRun: true,
      scannedEvents: 2,
      rewritableEvents: 2,
      rewrittenEvents: 0,
      invalidEvents: 0,
      unchangedEvents: 0,
    });
    expect(analysis.reclaimableBytes).toBeGreaterThan(1_000_000);
    expect(progress).toEqual([1, 2]);
    expect(readStoredEvents(databasePath)[0]?.event_json).toContain("large-transcript");

    const applied = await maintenance.compact({
      databasePath,
      batchSize: 1,
      dryRun: false,
      vacuum: true,
    });

    expect(applied).toMatchObject({
      dryRun: false,
      scannedEvents: 2,
      rewritableEvents: 2,
      rewrittenEvents: 2,
      vacuumed: true,
    });
    const stored = readStoredEvents(databasePath);
    expect(stored).toHaveLength(3);
    expect(stored[0]?.event_json).not.toContain("large-transcript");
    expect(JSON.parse(stored[0]!.event_json).data).toEqual({
      source: "proxy",
      eventType: "provider_response",
      summary: "provider response",
      payload: {
        durationMs: 1500,
        model: "planner-model",
      },
    });
    expect(stored[2]?.event_json).toContain("keep-this-model-summary");
  });

  test("rejects vacuum in analysis mode", async () => {
    await expect(
      new AgentSessionHistoryMaintenance().compact({
        databasePath: createHistoryDatabase(),
        vacuum: true,
      }),
    ).rejects.toThrow("VACUUM requires an applied maintenance run");
  });
});

function createHistoryDatabase(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "senera-session-maintenance-"));
  temporaryDirectories.push(directory);
  const databasePath = path.join(directory, "senera.db");
  const db = new Database(databasePath);
  installAgentSessionSchema(db);
  db.prepare(
    "INSERT INTO sessions (id, title, status, created_at, updated_at, metadata) VALUES (?, ?, ?, ?, ?, ?)",
  ).run("session-1", "Maintenance", "idle", timestamp(), timestamp(), "{}");
  const insert = db.prepare(`
    INSERT INTO run_events
      (session_id, request_id, kind, timestamp, event_sequence, step, detail_id, event_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const sequence of [1, 2]) {
    insert.run(
      "session-1",
      `request-${sequence}`,
      AgentEventKinds.PiTrace,
      timestamp(),
      sequence,
      1,
      null,
      JSON.stringify(piTraceEvent(sequence)),
    );
  }
  insert.run(
    "session-1",
    "request-2",
    AgentEventKinds.ModelCompleted,
    timestamp(),
    3,
    1,
    null,
    JSON.stringify({
      ...eventEnvelope(AgentEventKinds.ModelCompleted, 3),
      data: { text: "keep-this-model-summary" },
    }),
  );
  db.close();
  return databasePath;
}

function piTraceEvent(sequence: number) {
  return {
    ...eventEnvelope(AgentEventKinds.PiTrace, sequence),
    data: {
      source: "proxy",
      eventType: "provider_response",
      summary: "provider response",
      payload: {
        durationMs: 1500,
        model: "planner-model",
        transcript: `large-transcript-${"x".repeat(600_000)}`,
      },
    },
  };
}

function eventEnvelope(kind: string, sequence: number) {
  return {
    channel: AgentEventChannels.AgentEvent,
    kind,
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Model,
    sequence,
    timestamp: timestamp(),
    sessionId: "session-1",
    requestId: `request-${Math.min(sequence, 2)}`,
    step: 1,
  };
}

function readStoredEvents(databasePath: string): Array<{ event_json: string }> {
  const db = new Database(databasePath, { readonly: true });
  try {
    return db.prepare<[], { event_json: string }>("SELECT event_json FROM run_events ORDER BY id").all();
  } finally {
    db.close();
  }
}

function timestamp(): string {
  return "2026-07-17T00:00:00.000Z";
}
