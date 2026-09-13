import { describe, expect, test } from "vitest";
import { parseSeneraCliInvocation, parseSeneraSelfCommand, type SeneraCliInvocation } from "../../../Apps/SeneraCli.js";

describe("senera CLI self-service command parsing", () => {
  test("config history parses without arguments", () => {
    expect(parseSeneraSelfCommand(["config", "history"])).toEqual({ command: "config", action: "history" });
  });

  test("config rollback parses a positive integer revision", () => {
    expect(parseSeneraSelfCommand(["config", "rollback", "3"])).toEqual({
      command: "config",
      action: "rollback",
      revision: 3,
    });
  });

  test("config rollback rejects non-positive and non-numeric revisions", () => {
    expect(() => parseSeneraSelfCommand(["config", "rollback", "0"])).toThrow(/正整数/);
    expect(() => parseSeneraSelfCommand(["config", "rollback", "abc"])).toThrow(/正整数/);
    expect(() => parseSeneraSelfCommand(["config", "rollback"])).toThrow(/requires a revision/);
  });

  test("approval resolve parses approve and deny", () => {
    expect(parseSeneraSelfCommand(["approval", "resolve", "a-1", "approve"])).toEqual({
      command: "approval",
      action: "resolve",
      approvalId: "a-1",
      decision: "approve",
    });
    expect(parseSeneraSelfCommand(["approval", "resolve", "a-1", "deny"])).toEqual({
      command: "approval",
      action: "resolve",
      approvalId: "a-1",
      decision: "deny",
    });
    expect(() => parseSeneraSelfCommand(["approval", "resolve", "a-1", "maybe"])).toThrow(/expected approve or deny/);
  });

  test("full invocation keeps self command, flags and workspace", () => {
    const invocation = parseSeneraCliInvocation(
      ["config", "rollback", "5", "--workspace", "ws", "--yes", "--json"],
      {},
      "C:\\work",
    );
    expect(invocation).toMatchObject({
      command: "self",
      self: { command: "config", action: "rollback", revision: 5 },
      yes: true,
      json: true,
    });
    const self = invocation as Extract<SeneraCliInvocation, { command: "self" }>;
    expect(self.workspaceRoot.endsWith("ws")).toBe(true);
  });

  test("config env-path and check parse without arguments", () => {
    expect(parseSeneraSelfCommand(["config", "env-path"])).toEqual({ command: "config", action: "env-path" });
    expect(parseSeneraSelfCommand(["config", "check"])).toEqual({ command: "config", action: "check" });
  });

  test("sessions list parses", () => {
    expect(parseSeneraSelfCommand(["sessions", "list"])).toEqual({ command: "sessions", action: "list" });
    expect(() => parseSeneraSelfCommand(["sessions", "show"])).toThrow(/Unknown sessions action/);
  });

  test("logs list and tail parse", () => {
    expect(parseSeneraSelfCommand(["logs", "list"])).toEqual({ command: "logs", action: "list" });
    expect(parseSeneraSelfCommand(["logs", "tail", "agent.log"])).toEqual({
      command: "logs",
      action: "tail",
      name: "agent.log",
    });
    expect(parseSeneraSelfCommand(["logs", "tail", "agent.log", "50"])).toEqual({
      command: "logs",
      action: "tail",
      name: "agent.log",
      lines: 50,
    });
    expect(() => parseSeneraSelfCommand(["logs", "tail"])).toThrow(/requires a log name/);
    expect(() => parseSeneraSelfCommand(["logs", "tail", "agent.log", "0"])).toThrow(/1-2000/);
    expect(() => parseSeneraSelfCommand(["logs", "tail", "agent.log", "abc"])).toThrow(/1-2000/);
  });

  test("status parses without action and rejects extra arguments", () => {
    expect(parseSeneraSelfCommand(["status"])).toEqual({ command: "status" });
    expect(() => parseSeneraSelfCommand(["status", "extra"])).toThrow(/Unknown status argument/);
  });

  test("new roots reachable through full invocation", () => {
    expect(parseSeneraCliInvocation(["status", "--json"], {}, "C:\\work")).toMatchObject({
      command: "self",
      self: { command: "status" },
      json: true,
    });
    expect(parseSeneraCliInvocation(["sessions", "list"], {}, "C:\\work")).toMatchObject({
      command: "self",
      self: { command: "sessions", action: "list" },
    });
    expect(parseSeneraCliInvocation(["logs", "list"], {}, "C:\\work")).toMatchObject({
      command: "self",
      self: { command: "logs", action: "list" },
    });
    expect(parseSeneraCliInvocation(["unknown"], {}, "C:\\work")).toMatchObject({
      command: "self",
      self: { command: "unknown", args: [] },
    });
  });

  test("capabilities parses as a root command without an action", () => {
    expect(parseSeneraSelfCommand(["capabilities"])).toEqual({ command: "capabilities" });
    expect(() => parseSeneraSelfCommand(["capabilities", "list"])).toThrow(/Unknown capabilities argument/);
  });
});
