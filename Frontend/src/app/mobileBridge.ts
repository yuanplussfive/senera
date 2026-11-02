import type { ServerAuthenticatedSession } from "../api/authClient";
import { readHostCapabilities, type SeneraHostCapabilities } from "@senera/resource-links";

export interface SeneraMobileBridge extends SeneraHostCapabilities {
  login?(serverUrl: string, credentials: { loginName: string; password: string }): Promise<ServerAuthenticatedSession>;
  logout?(): Promise<void>;
}

export function readMobileBridge(): SeneraMobileBridge | undefined {
  return readHostCapabilities();
}
