#!/usr/bin/env node
import pty from "@lydell/node-pty";
import {
  SeneraTerminalSidecarProtocolVersion,
  TerminalSidecarClientFrameDecoder,
  encodeTerminalSidecarServerMessage,
} from "../protocol.js";

const decoder = new TerminalSidecarClientFrameDecoder();
let terminal;
let outputSequence = 0;
let commandQueue = Promise.resolve();

process.stdin.on("data", (chunk) => {
  commandQueue = commandQueue
    .then(async () => {
      for (const message of decoder.push(chunk)) await dispatch(message);
    })
    .catch((error) => fail("sidecar_command_failed", error, true));
});
process.stdin.on("end", () => terminateTerminal("kill"));
process.stdin.on("error", (error) => fail("sidecar_stdin_failed", error, true));

const commandHandlers = {
  open: openTerminal,
  write: ({ requestId, input }) => withTerminal(requestId, "write", (active) => active.write(input)),
  resize: ({ requestId, columns, rows }) => withTerminal(requestId, "resize", (active) => active.resize(columns, rows)),
  signal: ({ requestId, signal }) => withTerminal(requestId, "signal", () => terminateTerminal(signal)),
  close: ({ requestId }) => withTerminal(requestId, "close", () => terminateTerminal("terminate")),
};

async function dispatch(message) {
  await commandHandlers[message.type](message);
}

async function openTerminal(message) {
  if (terminal) throw new Error("Terminal sidecar accepts exactly one open request.");
  terminal = pty.spawn(message.command, message.args, {
    cwd: message.cwd,
    env: message.env,
    cols: message.columns,
    rows: message.rows,
    name: message.terminalName,
    useConpty: process.platform === "win32",
  });
  terminal.onData((data) => send({ type: "output", sequence: ++outputSequence, data }));
  terminal.onExit(({ exitCode, signal }) => {
    send({ type: "exit", exitCode, ...(signal ? { signal } : {}) }, () => process.exit(0));
    terminal = undefined;
  });
  send({
    type: "ready",
    protocolVersion: SeneraTerminalSidecarProtocolVersion,
    pid: terminal.pid,
  });
}

async function withTerminal(requestId, operation, action) {
  if (!terminal) {
    send({
      type: "error",
      code: "terminal_not_running",
      message: "Terminal sidecar has no active PTY.",
      fatal: false,
      requestId,
    });
    return;
  }
  await action(terminal);
  send({ type: "ack", requestId, operation });
}

function terminateTerminal(signal) {
  if (!terminal) return;
  const strategies = {
    interrupt: () => (process.platform === "win32" ? terminal.write("\u0003") : terminal.kill("SIGINT")),
    terminate: () => terminal.kill("SIGTERM"),
    kill: () => terminal.kill("SIGKILL"),
  };
  strategies[signal]();
}

function send(message, onFlushed) {
  process.stdout.write(encodeTerminalSidecarServerMessage(message), onFlushed);
}

function fail(code, error, fatal) {
  const message = error instanceof Error ? error.message : String(error);
  send({ type: "error", code, message, fatal });
  if (fatal) {
    terminateTerminal("kill");
    process.exitCode = 1;
  }
}
