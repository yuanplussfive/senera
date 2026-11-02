"use strict";

const fs = require("node:fs");
const { spawn } = require("cross-spawn");
const koffi = require("koffi");

const LaunchControlFd = 3;
const LaunchStatusFd = 4;
const MaxLaunchRequestBytes = 1024 * 1024;
const SupervisorFailureExitCode = 1;
const WindowsTargetLaunchConfirmationDelayMs = 100;
const WindowsExecutableRegExp = /\.(?:com|exe)$/i;
const JobObjectQuery = 0x0004;
const JobObjectBasicAccountingInformationClass = 1;
const JobPollIntervalMs = 100;
const Kernel32 = koffi.load("kernel32.dll");
koffi.pointer("SENERA_SUPERVISOR_WINDOWS_HANDLE", koffi.opaque());
const JobObjectBasicAccountingInformation = koffi.struct("SENERA_SUPERVISOR_JOB_OBJECT_BASIC_ACCOUNTING_INFORMATION", {
  TotalUserTime: "int64_t",
  TotalKernelTime: "int64_t",
  ThisPeriodTotalUserTime: "int64_t",
  ThisPeriodTotalKernelTime: "int64_t",
  TotalPageFaultCount: "uint32_t",
  TotalProcesses: "uint32_t",
  ActiveProcesses: "uint32_t",
  TotalTerminatedProcesses: "uint32_t",
});
const OpenJobObjectW = Kernel32.func(
  "SENERA_SUPERVISOR_WINDOWS_HANDLE __stdcall OpenJobObjectW(uint32_t desiredAccess, bool inheritHandle, str16 name)",
);
const QueryInformationJobObject = Kernel32.func(
  "bool __stdcall QueryInformationJobObject(SENERA_SUPERVISOR_WINDOWS_HANDLE job, int informationClass, SENERA_SUPERVISOR_JOB_OBJECT_BASIC_ACCOUNTING_INFORMATION *information, uint32_t informationLength, uint32_t *returnLength)",
);
const CloseHandle = Kernel32.func("bool __stdcall CloseHandle(SENERA_SUPERVISOR_WINDOWS_HANDLE handle)");
const GetLastError = Kernel32.func("uint32_t __stdcall GetLastError()");

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
  const job = openJobObject(request.jobObjectName);
  const target = spawn(request.command, request.args, {
    cwd: request.cwd,
    env: request.env,
    shell: false,
    stdio: "inherit",
    windowsHide: request.windowsHide,
  });
  let started = false;
  let failed = false;
  let targetExitCode = SupervisorFailureExitCode;
  let confirmationTimer;
  const confirmStarted = () => {
    if (failed || started) return;
    started = true;
    writeStatus({ ok: true, pid: target.pid });
  };
  target.once("spawn", () => {
    // cross-spawn reports missing Windows command shims after the spawn event.
    // ponytail: fixed confirmation window; cross-spawn exposes no synchronous ENOENT signal.
    if (WindowsExecutableRegExp.test(request.command) && fs.existsSync(request.command)) {
      confirmStarted();
      return;
    }
    confirmationTimer = setTimeout(confirmStarted, WindowsTargetLaunchConfirmationDelayMs);
  });
  target.once("error", (error) => {
    failed = true;
    if (confirmationTimer !== undefined) clearTimeout(confirmationTimer);
    if (!started) failSupervisor(error);
    else process.stderr.write(`${error.stack || error.message}\n`);
  });
  target.once("exit", (exitCode) => {
    targetExitCode = normalizeExitCode(exitCode);
    void waitForJobChildren(job).then(
      () => finishTargetJob(job, targetExitCode),
      (error) => finishTargetJob(job, targetExitCode, error),
    );
  });
}

function openJobObject(name) {
  const job = OpenJobObjectW(JobObjectQuery, false, name);
  if (!job) throw windowsJobError("OpenJobObjectW");
  return job;
}

async function waitForJobChildren(job) {
  // The supervisor is also in the Job; the tree is finished once it is the sole member.
  while (activeProcessCount(job) > 1) {
    await new Promise((resolve) => setTimeout(resolve, JobPollIntervalMs));
  }
}

function activeProcessCount(job) {
  const information = {
    TotalUserTime: 0n,
    TotalKernelTime: 0n,
    ThisPeriodTotalUserTime: 0n,
    ThisPeriodTotalKernelTime: 0n,
    TotalPageFaultCount: 0,
    TotalProcesses: 0,
    ActiveProcesses: 0,
    TotalTerminatedProcesses: 0,
  };
  if (
    !QueryInformationJobObject(
      job,
      JobObjectBasicAccountingInformationClass,
      information,
      koffi.sizeof(JobObjectBasicAccountingInformation),
      null,
    )
  ) {
    throw windowsJobError("QueryInformationJobObject");
  }
  return information.ActiveProcesses;
}

function closeJobObject(job) {
  if (!CloseHandle(job)) throw windowsJobError("CloseHandle");
}

function finishTargetJob(job, exitCode, error) {
  try {
    closeJobObject(job);
  } catch (closeError) {
    failSupervisor(closeError);
    return;
  }
  if (error) {
    failSupervisor(error);
    return;
  }
  process.exitCode = exitCode;
}

function windowsJobError(operation) {
  return Object.assign(new Error(`${operation} failed with Windows error ${GetLastError()}.`), {
    code: "SENERA_WINDOWS_JOB_QUERY_FAILED",
  });
}

function parseLaunchRequest(source) {
  const value = JSON.parse(source);
  if (
    !isRecord(value) ||
    typeof value.command !== "string" ||
    value.command.length === 0 ||
    typeof value.jobObjectName !== "string" ||
    value.jobObjectName.length === 0
  ) {
    throw new TypeError("Launch request must contain a command and its Job Object name.");
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
