"use strict";

const fs = require("node:fs");
const { spawn } = require("node:child_process");

const LaunchControlFd = 3;
const LaunchStatusFd = 4;
const MaxLaunchRequestBytes = 1024 * 1024;
const SupervisorFailureExitCode = 1;

const launchControl = fs.createReadStream("", { fd: LaunchControlFd, autoClose: true });
const launchStatus = fs.createWriteStream("", { fd: LaunchStatusFd, autoClose: true });
let retainedBytes = 0;
const chunks = [];
let launchRequestReceived = false;

launchControl.on("data", (chunk) => {
  if (launchRequestReceived) {
    if (chunk.byteLength > 0) failSupervisor(new Error("Launch control contains data after the request frame."));
    return;
  }
  const delimiterIndex = chunk.indexOf(0x0a);
  const requestChunk = delimiterIndex < 0 ? chunk : chunk.subarray(0, delimiterIndex);
  retainedBytes += requestChunk.byteLength;
  if (retainedBytes > MaxLaunchRequestBytes) {
    failSupervisor(new Error(`Launch request exceeds ${MaxLaunchRequestBytes} bytes.`));
    return;
  }
  chunks.push(requestChunk);
  if (delimiterIndex < 0) return;
  if (delimiterIndex !== chunk.byteLength - 1) {
    failSupervisor(new Error("Launch control contains data after the request frame."));
    return;
  }
  launchRequestReceived = true;
  try {
    launchTarget(parseLaunchRequest(Buffer.concat(chunks).toString("utf8")));
  } catch (error) {
    failSupervisor(error);
  }
});

launchControl.once("error", failSupervisor);
launchControl.once("end", () => {
  if (!launchRequestReceived) failSupervisor(new Error("Launch control closed before a complete request frame."));
});

function launchTarget(request) {
  const target = spawn(request.command, request.args, {
    cwd: request.cwd,
    env: request.env,
    shell: false,
    stdio: "inherit",
    windowsHide: request.windowsHide,
  });
  let started = false;
  target.once("spawn", () => {
    started = true;
    writeStatus({ ok: true, pid: target.pid });
  });
  target.once("error", (error) => {
    if (!started) failSupervisor(error);
    else process.stderr.write(`${error.stack || error.message}\n`);
  });
  target.once("exit", (exitCode) => {
    process.exitCode = normalizeExitCode(exitCode);
  });
}

function parseLaunchRequest(source) {
  const value = JSON.parse(source);
  if (!isRecord(value) || typeof value.command !== "string" || value.command.length === 0) {
    throw new TypeError("Launch request must contain a non-empty command.");
  }
  if (!Array.isArray(value.args) || value.args.some((argument) => typeof argument !== "string")) {
    throw new TypeError("Launch request args must be an array of strings.");
  }
  if (typeof value.cwd !== "string" || value.cwd.length === 0) {
    throw new TypeError("Launch request must contain a working directory.");
  }
  if (!isStringRecord(value.env)) {
    throw new TypeError("Launch request env must contain only string values.");
  }
  if (typeof value.windowsHide !== "boolean") {
    throw new TypeError("Launch request windowsHide must be boolean.");
  }
  return value;
}

function failSupervisor(error) {
  const normalized = error instanceof Error ? error : new Error(String(error));
  writeStatus({
    ok: false,
    error: {
      name: normalized.name,
      message: normalized.message,
      code: typeof normalized.code === "string" ? normalized.code : undefined,
    },
  });
  process.stderr.write(`${normalized.stack || normalized.message}\n`);
  process.exitCode = SupervisorFailureExitCode;
}

function writeStatus(status) {
  if (launchStatus.destroyed || launchStatus.writableEnded) return;
  launchStatus.end(`${JSON.stringify(status)}\n`);
}

function normalizeExitCode(exitCode) {
  return Number.isInteger(exitCode) && exitCode >= 0 ? exitCode : SupervisorFailureExitCode;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value) {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}
