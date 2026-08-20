import type { AgentRuntimeUpdateFailureCode } from "../../Source/AgentSystem/Runtime/AgentRuntimeUpdateContract.js";

export const DesktopUpdateStates = {
  Unsupported: "unsupported",
  Idle: "idle",
  Checking: "checking",
  Available: "available",
  NotAvailable: "not-available",
  Downloading: "downloading",
  Downloaded: "downloaded",
  Error: "error",
} as const;

export type DesktopUpdateState = (typeof DesktopUpdateStates)[keyof typeof DesktopUpdateStates];

export interface DesktopUpdateSnapshot {
  state: DesktopUpdateState;
  currentVersion: string;
  availableVersion?: string;
  releaseName?: string;
  releaseDate?: string;
  percent?: number;
  transferredBytes?: number;
  totalBytes?: number;
  bytesPerSecond?: number;
  errorCode?: AgentRuntimeUpdateFailureCode | "update_failed";
  errorMessage?: string;
}
