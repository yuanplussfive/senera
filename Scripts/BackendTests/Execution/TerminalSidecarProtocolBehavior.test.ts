import { describe, expect, it } from "vitest";
import {
  SeneraTerminalSidecarProtocolVersion,
  TerminalSidecarClientFrameDecoder,
  TerminalSidecarServerFrameDecoder,
  encodeTerminalSidecarClientMessage,
  encodeTerminalSidecarServerMessage,
} from "@senera/terminal-sidecar";

describe("terminal sidecar protocol", () => {
  it("decodes fragmented and coalesced MessagePack frames without losing boundaries", () => {
    const open = encodeTerminalSidecarClientMessage({
      type: "open",
      protocolVersion: SeneraTerminalSidecarProtocolVersion,
      command: "/bin/sh",
      args: ["-lc", "printf ready"],
      cwd: "/workspace",
      env: { TERM: "xterm-256color" },
      columns: 120,
      rows: 30,
      terminalName: "xterm-256color",
    });
    const write = encodeTerminalSidecarClientMessage({ type: "write", requestId: 1, input: "continue\n" });
    const decoder = new TerminalSidecarClientFrameDecoder();

    expect(decoder.push(open.subarray(0, 7))).toEqual([]);
    expect(decoder.push(Buffer.concat([open.subarray(7), write]))).toEqual([
      expect.objectContaining({ type: "open", command: "/bin/sh", columns: 120, rows: 30 }),
      { type: "write", requestId: 1, input: "continue\n" },
    ]);
  });

  it("preserves terminal output and acknowledgements as typed server messages", () => {
    const decoder = new TerminalSidecarServerFrameDecoder();
    const frames = Buffer.concat([
      encodeTerminalSidecarServerMessage({
        type: "ready",
        protocolVersion: SeneraTerminalSidecarProtocolVersion,
        pid: 42,
      }),
      encodeTerminalSidecarServerMessage({ type: "output", sequence: 1, data: "ready> " }),
      encodeTerminalSidecarServerMessage({ type: "ack", requestId: 2, operation: "resize" }),
    ]);

    expect(decoder.push(frames)).toEqual([
      { type: "ready", protocolVersion: 1, pid: 42 },
      { type: "output", sequence: 1, data: "ready> " },
      { type: "ack", requestId: 2, operation: "resize" },
    ]);
  });

  it("rejects invalid dimensions before a frame reaches the sidecar", () => {
    expect(() =>
      encodeTerminalSidecarClientMessage({
        type: "resize",
        requestId: 1,
        columns: 5,
        rows: 1,
      }),
    ).toThrow();
  });
});
