import koffi from "koffi";

const JobObjectExtendedLimitInformationClass = 9;
const JobObjectLimitKillOnJobClose = 0x0000_2000;
const ProcessSetQuota = 0x0100;
const ProcessTerminate = 0x0001;
const SupervisorTerminationExitCode = 1;

const Kernel32 = koffi.load("kernel32.dll");
koffi.pointer("SENERA_WINDOWS_HANDLE", koffi.opaque());

const JobObjectBasicLimitInformation = koffi.struct("SENERA_JOB_OBJECT_BASIC_LIMIT_INFORMATION", {
  PerProcessUserTimeLimit: "int64_t",
  PerJobUserTimeLimit: "int64_t",
  LimitFlags: "uint32_t",
  MinimumWorkingSetSize: "uintptr_t",
  MaximumWorkingSetSize: "uintptr_t",
  ActiveProcessLimit: "uint32_t",
  Affinity: "uintptr_t",
  PriorityClass: "uint32_t",
  SchedulingClass: "uint32_t",
});

const IoCounters = koffi.struct("SENERA_IO_COUNTERS", {
  ReadOperationCount: "uint64_t",
  WriteOperationCount: "uint64_t",
  OtherOperationCount: "uint64_t",
  ReadTransferCount: "uint64_t",
  WriteTransferCount: "uint64_t",
  OtherTransferCount: "uint64_t",
});

const JobObjectExtendedLimitInformation = koffi.struct("SENERA_JOB_OBJECT_EXTENDED_LIMIT_INFORMATION", {
  BasicLimitInformation: JobObjectBasicLimitInformation,
  IoInfo: IoCounters,
  ProcessMemoryLimit: "uintptr_t",
  JobMemoryLimit: "uintptr_t",
  PeakProcessMemoryUsed: "uintptr_t",
  PeakJobMemoryUsed: "uintptr_t",
});

type WindowsHandleValue = bigint;

const CreateJobObjectW = Kernel32.func(
  "SENERA_WINDOWS_HANDLE __stdcall CreateJobObjectW(void *attributes, str16 name)",
) as unknown as (attributes: null, name: null) => WindowsHandleValue;
const SetInformationJobObject = Kernel32.func(
  "bool __stdcall SetInformationJobObject(SENERA_WINDOWS_HANDLE job, int informationClass, SENERA_JOB_OBJECT_EXTENDED_LIMIT_INFORMATION *information, uint32_t informationLength)",
) as unknown as (
  job: WindowsHandleValue,
  informationClass: number,
  information: ReturnType<typeof createExtendedLimitInformation>,
  informationLength: number,
) => boolean;
const OpenProcess = Kernel32.func(
  "SENERA_WINDOWS_HANDLE __stdcall OpenProcess(uint32_t desiredAccess, bool inheritHandle, uint32_t processId)",
) as unknown as (desiredAccess: number, inheritHandle: boolean, processId: number) => WindowsHandleValue;
const AssignProcessToJobObject = Kernel32.func(
  "bool __stdcall AssignProcessToJobObject(SENERA_WINDOWS_HANDLE job, SENERA_WINDOWS_HANDLE process)",
) as unknown as (job: WindowsHandleValue, process: WindowsHandleValue) => boolean;
const TerminateJobObject = Kernel32.func(
  "bool __stdcall TerminateJobObject(SENERA_WINDOWS_HANDLE job, uint32_t exitCode)",
) as unknown as (job: WindowsHandleValue, exitCode: number) => boolean;
const CloseHandle = Kernel32.func("bool __stdcall CloseHandle(SENERA_WINDOWS_HANDLE handle)") as unknown as (
  handle: WindowsHandleValue,
) => boolean;
const GetLastError = Kernel32.func("uint32_t __stdcall GetLastError()") as unknown as () => number;

export class AgentWindowsJobObjectError extends Error {
  constructor(
    readonly operation: string,
    readonly windowsErrorCode: number,
  ) {
    super(`${operation} failed with Windows error ${windowsErrorCode}.`);
    this.name = "AgentWindowsJobObjectError";
  }
}

export class AgentWindowsJobObject {
  private handle: WindowsHandleValue | undefined;

  constructor() {
    const handle = CreateJobObjectW(null, null);
    if (!handle) throw windowsJobError("CreateJobObjectW");
    this.handle = handle;

    const information = createExtendedLimitInformation();
    if (
      !SetInformationJobObject(
        handle,
        JobObjectExtendedLimitInformationClass,
        information,
        koffi.sizeof(JobObjectExtendedLimitInformation),
      )
    ) {
      const error = windowsJobError("SetInformationJobObject");
      CloseHandle(handle);
      this.handle = undefined;
      throw error;
    }
  }

  assign(processId: number): void {
    const job = this.requireHandle();
    const processHandle = OpenProcess(ProcessSetQuota | ProcessTerminate, false, processId);
    if (!processHandle) throw windowsJobError("OpenProcess");
    try {
      if (!AssignProcessToJobObject(job, processHandle)) {
        throw windowsJobError("AssignProcessToJobObject");
      }
    } finally {
      CloseHandle(processHandle);
    }
  }

  terminate(): void {
    const handle = this.requireHandle();
    if (!TerminateJobObject(handle, SupervisorTerminationExitCode)) {
      throw windowsJobError("TerminateJobObject");
    }
  }

  close(): void {
    const handle = this.handle;
    if (handle === undefined) return;
    this.handle = undefined;
    if (!CloseHandle(handle)) throw windowsJobError("CloseHandle");
  }

  private requireHandle(): WindowsHandleValue {
    if (this.handle === undefined) throw new Error("Windows Job Object is already closed.");
    return this.handle;
  }
}

function createExtendedLimitInformation() {
  return {
    BasicLimitInformation: {
      PerProcessUserTimeLimit: 0n,
      PerJobUserTimeLimit: 0n,
      LimitFlags: JobObjectLimitKillOnJobClose,
      MinimumWorkingSetSize: 0,
      MaximumWorkingSetSize: 0,
      ActiveProcessLimit: 0,
      Affinity: 0,
      PriorityClass: 0,
      SchedulingClass: 0,
    },
    IoInfo: {
      ReadOperationCount: 0n,
      WriteOperationCount: 0n,
      OtherOperationCount: 0n,
      ReadTransferCount: 0n,
      WriteTransferCount: 0n,
      OtherTransferCount: 0n,
    },
    ProcessMemoryLimit: 0,
    JobMemoryLimit: 0,
    PeakProcessMemoryUsed: 0,
    PeakJobMemoryUsed: 0,
  };
}

function windowsJobError(operation: string): AgentWindowsJobObjectError {
  return new AgentWindowsJobObjectError(operation, GetLastError());
}
