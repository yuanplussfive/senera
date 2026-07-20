import { describe, expect, test } from "vitest";
import {
  AgentToolExecutionReporter,
  type AgentToolOutputSink,
} from "../../../Source/AgentSystem/ToolRuntime/AgentToolExecutionReporter.js";

describe("tool execution reporter output sink", () => {
  test("persists plugin output even when live output projection is disabled", async () => {
    const chunks: Buffer[] = [];
    const sink: AgentToolOutputSink = {
      write: (_stream, data) => {
        chunks.push(Buffer.from(data));
        return true;
      },
      waitForDrain: async () => undefined,
    };
    const reporter = new AgentToolExecutionReporter({
      toolName: "WeatherTool",
      outputSink: sink,
      capabilities: { progress: false, outputStreaming: false },
    });

    reporter.outputText({ stream: "stdout", text: "complete plugin output" });
    await reporter.flush();

    expect(Buffer.concat(chunks).toString("utf8")).toBe("complete plugin output");
  });
});
