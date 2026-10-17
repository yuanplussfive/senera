import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { AgentWorkspaceLogStore } from "../../../Source/AgentSystem/Diagnostics/AgentWorkspaceLogStore.js";
import { AgentLogPolicyLimits } from "../../../Source/AgentSystem/Types/AgentLogPolicyLimits.js";

const roots: string[] = [];

describe("workspace log store", () => {
  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  test("projects redacted details and follows a bounded cursor across records", () => {
    const root = createRoot();
    const store = new AgentWorkspaceLogStore({
      root,
      policy: {
        enabled: true,
        detailMaxBytes: 16_384,
        projectionMaxBytes: 1_024 * 1_024,
        retentionHours: 24,
        queryPageSize: 1,
        tailLineCount: 10,
      },
    });

    store.append({
      recordId: "event_first",
      timestamp: "2026-10-16T00:00:00.000Z",
      level: "event",
      message: "skill.started",
      requestId: "run_one",
      scope: "background",
      details: { apiKey: "secret", nested: { authorization: "Bearer token" } },
    });
    store.append({
      recordId: "event_second",
      timestamp: "2026-10-16T00:01:00.000Z",
      level: "info",
      message: "skill.completed",
      requestId: "run_one",
    });

    const first = store.query({ requestId: "run_one" });
    expect(first.items).toHaveLength(1);
    expect(first.items[0]?.detailId).toMatch(/^detail_/u);
    expect(first.items[0]?.details).toBeUndefined();
    expect(first.nextCursor).toBeDefined();

    const second = store.query({ requestId: "run_one", after: first.nextCursor });
    expect(second.items.map((item) => item.message)).toEqual(["skill.completed"]);

    const detail = store.detail(first.items[0]?.detailId ?? "");
    expect(detail.status).toBe("found");
    if (detail.status === "found") {
      expect(detail.value).toEqual({ apiKey: "***", nested: { authorization: "***" } });
    }
  });

  test("keeps log file reads workspace-bounded and reports expired cursors", () => {
    const root = createRoot();
    const store = new AgentWorkspaceLogStore({
      root,
      policy: {
        enabled: true,
        detailMaxBytes: 4_096,
        projectionMaxBytes: 1_024,
        retentionHours: 24,
        queryPageSize: 8,
        tailLineCount: 10,
      },
    });
    store.append({ recordId: "log_one", timestamp: new Date().toISOString(), level: "info", message: "ok" });

    expect(store.readFile("../events.jsonl", 10).status).toBe("rejected");
    expect(store.readFile("missing.jsonl")).toMatchObject({ status: "missing" });
    expect(store.readFile("events.jsonl", 1)).toMatchObject({
      status: "found",
      content: expect.stringContaining('"message":"ok"'),
    });
    expect(() => store.readFile("events.jsonl", AgentLogPolicyLimits.maximumTailLineCount + 1)).toThrow(
      /日志读取行数必须是/u,
    );
    expect(() => store.query({ limit: AgentLogPolicyLimits.maximumQueryPageSize + 1 })).toThrow(/日志查询 limit/u);
    expect(() => store.query({ after: Buffer.from("log_missing").toString("base64url") })).toThrow(/游标已过期/iu);
    expect(store.listFiles().some((file) => file.name === "events.jsonl")).toBe(true);
  });

  test("keeps bounded reads streaming-safe for unicode and oversized details", () => {
    const root = createRoot();
    const store = new AgentWorkspaceLogStore({
      root,
      policy: {
        enabled: true,
        detailMaxBytes: 512,
        projectionMaxBytes: 1_024 * 1_024,
        retentionHours: 24,
        queryPageSize: 8,
        tailLineCount: 2,
      },
    });
    store.append({
      recordId: "unicode_one",
      timestamp: new Date().toISOString(),
      level: "info",
      message: "第一行\n第二行",
      details: { payload: "上海".repeat(2_000) },
    });

    const tail = store.readFile("events.jsonl", 1);
    expect(tail.status).toBe("found");
    if (tail.status === "found") expect(tail.content).toContain('"message":"第一行\\n第二行"');

    const item = store.query().items[0];
    expect(item?.detailId).toMatch(/^detail_/u);
    const detail = store.detail(item?.detailId ?? "");
    expect(detail.status).toBe("found");
    if (detail.status === "found") {
      expect(Buffer.byteLength(JSON.stringify(detail.value) + "\n", "utf8")).toBeLessThanOrEqual(512);
      expect(detail.value).toMatchObject({ truncated: true });
    }
  });

  test("keeps background streams separate while exposing them through one query contract", () => {
    const root = createRoot();
    const store = new AgentWorkspaceLogStore({
      root,
      policy: {
        enabled: true,
        detailMaxBytes: 4_096,
        projectionMaxBytes: 1_024,
        retentionHours: 24,
        queryPageSize: 8,
        tailLineCount: 10,
      },
    });

    store.append({
      recordId: "foreground_one",
      timestamp: new Date().toISOString(),
      level: "info",
      message: "foreground.event",
    });
    store.append({
      recordId: "memos_one",
      timestamp: new Date().toISOString(),
      level: "info",
      message: "memory.event",
      stream: "background/memos",
    });

    expect(store.listFiles().some((file) => file.name === "background/memos/events.jsonl")).toBe(true);
    expect(store.query({ stream: "background/memos" }).items.map((item) => item.message)).toEqual(["memory.event"]);
    expect(store.health().projectionFiles).toBe(2);
    expect(store.listStreams().map((stream) => stream.name)).toEqual(["background/memos", "foreground"]);
  });

  test("reacts to runtime policy changes without a second log store", () => {
    const root = createRoot();
    let enabled = false;
    const store = new AgentWorkspaceLogStore({
      root,
      policy: () => ({
        enabled,
        detailMaxBytes: 4_096,
        projectionMaxBytes: 1_024,
        retentionHours: 24,
        queryPageSize: 8,
        tailLineCount: 10,
      }),
    });

    expect(store.health().enabled).toBe(false);
    enabled = true;
    store.append({ recordId: "runtime_one", timestamp: new Date().toISOString(), level: "info", message: "enabled" });
    expect(store.query().items.map((item) => item.message)).toEqual(["enabled"]);
  });

  test("isolates an invalid runtime policy from the active run", () => {
    const root = createRoot();
    const store = new AgentWorkspaceLogStore({
      root,
      policy: () => ({
        enabled: true,
        detailMaxBytes: 0,
        projectionMaxBytes: 1_024,
        retentionHours: 24,
        queryPageSize: 8,
        tailLineCount: 10,
      }),
    });

    expect(() =>
      store.append({
        recordId: "invalid_policy",
        timestamp: new Date().toISOString(),
        level: "info",
        message: "ignored",
      }),
    ).not.toThrow();
    expect(store.health()).toMatchObject({ enabled: false, lastError: expect.stringContaining("日志策略无效") });
  });
});

function createRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "senera-log-store-"));
  roots.push(root);
  return root;
}
