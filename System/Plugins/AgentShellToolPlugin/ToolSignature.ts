export type ShellCommandToolArguments = {
  // executionTarget=Sandbox uses Linux/posix-sh; executionTarget=Local uses the host shell.
  command: {
    mode: "shell";
    dialect: "posix-sh" | "powershell";
    script: string;
  };

  // 执行目录，相对工作区根目录；默认 "."。必须留在工作区内。优先使用工作区相对路径。
  cwd?: string;

  // 超时时间，毫秒；默认使用系统 ToolExecution.TimeoutMs，最大 1800000。
  timeoutMs?: number;

  // 简短说明为什么需要执行该命令，便于用户查看执行记录。
  justification?: string;
};
