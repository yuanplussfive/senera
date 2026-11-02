import { describe, expect, test } from "vitest";
import {
  AgentNativeBrowserCommandError,
  executeAgentBrowserCommand,
} from "../../../Source/AgentSystem/Browser/AgentNativeBrowserCommand.js";

function execute(script: string, options: { timeoutMs: number; signal?: AbortSignal } = { timeoutMs: 5_000 }) {
  return executeAgentBrowserCommand({
    controller: process.execPath,
    command: ["--input-type=module", "-e", script],
    cwd: process.cwd(),
    defaultTimeoutMs: 180_000,
    options,
  });
}

describe("native browser process boundary", () => {
  test("reads a chunked JSON response after diagnostic output", async () => {
    await expect(
      execute(`
        process.stdout.write("starting controller\\n");
        process.stdout.write('{"success":true,"data":');
        setTimeout(() => process.stdout.write('{"title":"页面","url":"https://example.com"}}\\n'), 10);
      `),
    ).resolves.toEqual({ title: "页面", url: "https://example.com" });
  });

  test("retains structured failure codes and redacts internal endpoints", async () => {
    await expect(
      execute(`console.log(JSON.stringify({
        success: false,
        code: "tab_gone",
        error: "Cannot reach ws://127.0.0.1:9222/devtools/browser/private"
      }))`),
    ).rejects.toMatchObject({
      name: "AgentNativeBrowserCommandError",
      commandCode: "tab_gone",
      message: "Cannot reach [internal browser endpoint]",
    });
  });

  test("does not invent a failure code when the controller omits it", async () => {
    await expect(execute('console.log(JSON.stringify({success:false,error:"Rejected"}))')).rejects.toMatchObject({
      name: "AgentNativeBrowserCommandError",
      commandCode: undefined,
      message: "Rejected",
    });
  });

  test.each(["console.log('not JSON')", "process.exit(0)"])(
    "rejects a missing or malformed envelope: %s",
    async (script) => {
      await expect(execute(script)).rejects.toBeInstanceOf(AgentNativeBrowserCommandError);
    },
  );

  test("cancels an active child process with the caller's reason", async () => {
    const controller = new AbortController();
    const reason = new Error("User cancelled browser work");
    const pending = execute("setInterval(() => {}, 1000)", { timeoutMs: 5_000, signal: controller.signal });
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });

  test("rejects an already cancelled command before launching it", async () => {
    const reason = new Error("Already cancelled");
    await expect(execute("process.exit(1)", { timeoutMs: 5_000, signal: AbortSignal.abort(reason) })).rejects.toBe(
      reason,
    );
  });
});
