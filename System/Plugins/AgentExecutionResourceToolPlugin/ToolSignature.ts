export type ShellStartToolArguments = {
  command: {
    mode: "shell";
    dialect: "posix-sh" | "powershell";
    script: string;
  };
  cwd?: string;
  justification?: string;
  columns?: number;
  rows?: number;
};

export type ExecutionResourceInspectArguments = {
  resourceId: string;
  cursor?: number;
};

export type ExecutionResourceWaitArguments = {
  resourceId: string;
  cursor?: number;
  timeoutMs?: number;
};

export type ExecutionResourceWriteArguments = {
  resourceId: string;
  input: string;
  appendNewline?: boolean;
};

export type ExecutionResourceSignalArguments = {
  resourceId: string;
  signal: "interrupt" | "terminate" | "kill";
};

export type ExecutionResourceListArguments = Record<string, never>;

export type ExecutionResourceResizeArguments = {
  resourceId: string;
  columns: number;
  rows: number;
};

export type ExecutionResourceStopAllArguments = Record<string, never>;
