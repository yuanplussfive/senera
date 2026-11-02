import path from "node:path";
import assert from "node:assert/strict";
import { networkInterfaces } from "node:os";
import { expect, test as base } from "@playwright/test";
import { createRealRuntimeIntegrationHarness } from "../../Dist/Scripts/IntegrationTests/RuntimeIntegration/RealRuntimeIntegrationHarness.js";
import { isDeviceLanHost } from "../../Dist/Source/AgentSystem/Auth/AgentDeviceAuthenticationContract.js";

/** @typedef {"disabled" | "required"} AuthenticationMode */

/**
 * Starts the production frontend and real runtime in one of the two supported
 * deployment authentication modes.
 *
 * @param {{ authenticationMode: AuthenticationMode, workspaceMode?: "standalone" | "single-workspace", staticFrontendRoot?: string, host?: string }} options
 */
export function createBrowserE2eHarness({
  authenticationMode,
  workspaceMode = "standalone",
  staticFrontendRoot,
  host,
}) {
  return createRealRuntimeIntegrationHarness({
    authenticationMode,
    staticFrontendRoot: staticFrontendRoot ?? path.resolve(process.cwd(), "Frontend", "dist"),
    workspaceMode,
    host,
  });
}

export function createLanBrowserE2eHarness(options) {
  const network = Object.values(networkInterfaces())
    .flat()
    .find((entry) => entry?.family === "IPv4" && !entry.internal && isDeviceLanHost(entry.address));
  assert.ok(network, "LAN browser coverage requires a local IPv4 network interface.");
  return createBrowserE2eHarness({ ...options, host: network.address });
}

export const test = base.extend({
  runtimeDiagnostics: [
    async ({ page }, use) => {
      const failures = [];
      page.on("pageerror", (error) => failures.push(`pageerror: ${error.stack ?? error.message}`));
      page.on("response", (response) => {
        if (response.status() >= 500) failures.push(`HTTP ${response.status()}: ${response.url()}`);
      });

      await use();

      expect(failures, failures.join("\n")).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
