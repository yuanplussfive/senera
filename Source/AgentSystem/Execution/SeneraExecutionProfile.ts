export type SeneraProcessNetworkMode = "disabled" | "default";
export type SeneraProcessWorkspaceMountMode = "readonly" | "writable";
export type SeneraProcessBackendPreference = "local" | "sandbox";

export interface SeneraProcessWritableMount {
  hostPath: string;
  guestPath: string;
  quotaMiB?: number;
}

export interface SeneraProcessRootfsCopy {
  hostPath: string;
  guestPath: string;
}

export interface SeneraProcessRootfsBundle {
  workspaceRoot: string;
  packageRoot: string;
  guestPath: string;
}

export interface SeneraProcessMicrosandboxProfile {
  image?: string;
  guestWorkspaceRoot?: string;
  guestWorkdir?: string;
  network?: SeneraProcessNetworkMode;
  workspaceMount?: SeneraProcessWorkspaceMountMode;
  writableMounts?: readonly SeneraProcessWritableMount[];
  rootfsCopies?: readonly SeneraProcessRootfsCopy[];
  rootfsBundles?: readonly SeneraProcessRootfsBundle[];
  env?: Record<string, string>;
}

export interface SeneraProcessExecutionProfile {
  name: string;
  kind: "shell" | "mcp-server";
  backend?: SeneraProcessBackendPreference;
  microsandbox?: SeneraProcessMicrosandboxProfile;
}
