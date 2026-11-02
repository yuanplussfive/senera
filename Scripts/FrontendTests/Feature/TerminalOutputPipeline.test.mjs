import { expect, test, vi } from "vitest";
import { ExecutionResourceOutputStore } from "../../../Frontend/src/app/executionResourceOutputStore.ts";
import { TerminalOutputWriter } from "../../../Frontend/src/features/terminal/TerminalOutputWriter.ts";

function slowTerminal() {
  const completions = [];
  const terminal = { write: vi.fn((_text, done) => completions.push(done)), reset: vi.fn() };
  return { terminal, complete: () => completions.shift()?.() };
}

test("large output uses bounded writes without cutting a Unicode pair", () => {
  const { terminal, complete } = slowTerminal();
  const writer = new TerminalOutputWriter(terminal);
  const text = `${"a".repeat(32 * 1024 - 1)}🌽${"b".repeat(48 * 1024)}`;
  writer.accept({ kind: "append", cursor: 1, generation: 0, text });
  expect(terminal.write).toHaveBeenCalledOnce();
  expect(terminal.write.mock.calls[0][0].endsWith("a")).toBe(true);
  for (let index = 0; index < 3; index++) complete();
  const writes = terminal.write.mock.calls.map(([part]) => part);
  expect(writes.every((part) => part.length <= 32 * 1024)).toBe(true);
  expect(writes.join("")).toBe(text);
});

test("recovery replaces queued output only after an in-flight write has finished", () => {
  const { terminal, complete } = slowTerminal();
  const writer = new TerminalOutputWriter(terminal);
  const store = new ExecutionResourceOutputStore();
  writer.accept({ kind: "append", cursor: 1, generation: 0, text: "old in flight" });
  writer.accept({ kind: "append", cursor: 2, generation: 0, text: "old queued" });
  store.append("terminal", 7, "recovered prompt");
  writer.restore(store.read("terminal"));
  writer.accept({ kind: "append", cursor: 8, generation: 0, text: " live" });
  expect(terminal.reset).not.toHaveBeenCalled();
  complete();
  expect(terminal.reset).toHaveBeenCalledOnce();
  expect(terminal.write.mock.calls.map(([text]) => text)).toEqual(["old in flight", "recovered prompt live"]);
});

test("removal clears pending output and disposal makes late write callbacks inert", () => {
  const { terminal, complete } = slowTerminal();
  const writer = new TerminalOutputWriter(terminal);
  writer.accept({ kind: "append", cursor: 1, generation: 0, text: "first" });
  writer.accept({ kind: "append", cursor: 2, generation: 0, text: "second" });
  writer.accept({ kind: "removed" });
  complete();
  expect(terminal.reset).toHaveBeenCalledOnce();
  expect(terminal.write).toHaveBeenCalledOnce();
  writer.accept({ kind: "append", cursor: 3, generation: 0, text: "third" });
  writer.accept({ kind: "append", cursor: 4, generation: 0, text: "fourth" });
  writer.dispose();
  complete();
  expect(terminal.write).toHaveBeenCalledTimes(2);
});

test("retention trims only replay history while live subscribers receive every delta", () => {
  const store = new ExecutionResourceOutputStore();
  const listener = vi.fn();
  store.subscribe("terminal", listener);
  const chunk = "x".repeat(64 * 1024);
  for (let cursor = 1; cursor <= 8; cursor++) store.append("terminal", cursor, chunk);
  expect(listener).toHaveBeenCalledTimes(8);
  expect(listener.mock.calls.every(([update]) => update.kind === "append" && update.text === chunk)).toBe(true);
  const replay = store.read("terminal");
  expect(replay).toMatchObject({ cursor: 8, generation: 0, characterCount: 256 * 1024, truncated: true });
  expect(store.read("terminal")).toBe(replay);
});

test("a truncated recovery replaces history once and ignores stale snapshots", () => {
  const store = new ExecutionResourceOutputStore();
  const listener = vi.fn();
  store.subscribe("terminal", listener);
  store.append("terminal", 1, "old");
  const snapshot = {
    resourceId: "terminal",
    cursor: 8,
    oldestCursor: 7,
    truncated: true,
    events: [
      { kind: "output", cursor: 7, text: "new" },
      { kind: "state", cursor: 8, state: "running" },
    ],
  };
  store.merge(snapshot);
  expect(store.read("terminal")).toMatchObject({ cursor: 8, generation: 1, truncated: true });
  expect(store.read("terminal").text).toContain("new");
  expect(store.read("terminal").text).not.toContain("old");
  expect(listener.mock.calls.at(-1)[0].kind).toBe("replay");
  listener.mockClear();
  store.merge(snapshot);
  expect(listener).not.toHaveBeenCalled();
});
