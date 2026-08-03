import path from "node:path";
import { isPathWithin } from "../Core/AgentPath.js";
import type {
  AgentExtensionValueBinding,
  AgentExtensionValueResolution,
  AgentExtensionValueResolver,
} from "../Extensions/AgentExtensionValueExpression.js";
import type { AgentMcpPackage, AgentMcpPackageServer, AgentMcpRuntimeEndpoint } from "./AgentMcpPackageTypes.js";
import { assertNoMissingAgentMcpInputs, resolveAgentMcpValueExpression } from "./AgentMcpValueExpression.js";

const ProcessEnvironmentInputResolver: AgentExtensionValueResolver = {
  resolve(_serverId: string, binding: AgentExtensionValueBinding): AgentExtensionValueResolution | undefined {
    if (binding.source !== "hostEnvironment" && binding.source !== "legacyEnvironment") return undefined;
    const value = process.env[binding.name];
    return value === undefined ? undefined : { value, source: "environment" };
  },
};

export function createAgentMcpPackageEndpoint(
  package_: AgentMcpPackage,
  server: AgentMcpPackageServer,
  inputs: AgentExtensionValueResolver = ProcessEnvironmentInputResolver,
  workspaceRoot?: string,
): AgentMcpRuntimeEndpoint {
  const configuration = server.configuration;
  const missing = new Set<string>();
  const resolve = (expression: Parameters<typeof resolveAgentMcpValueExpression>[1]): string =>
    resolveAgentMcpValueExpression(
      server.name,
      expression,
      server.inputs,
      inputs,
      {
        packageRoot: package_.rootPath,
        workspaceRoot,
      },
      missing,
    );
  if (configuration.type === "http") {
    const endpoint = {
      id: server.name,
      packageName: package_.name,
      packageRoot: package_.rootPath,
      revision: package_.revision,
      transport: "http" as const,
      url: resolve(configuration.url),
      headers: resolveRecord(configuration.headers, resolve),
    };
    assertNoMissingAgentMcpInputs(server.name, missing);
    return endpoint;
  }
  const endpoint = {
    id: server.name,
    packageName: package_.name,
    packageRoot: package_.rootPath,
    revision: package_.revision,
    transport: "stdio" as const,
    command: resolve(configuration.command),
    args: configuration.args.map(resolve),
    cwd: resolvePackagePath(package_.rootPath, resolve(configuration.cwd)),
    env: resolveRecord(configuration.env, resolve),
  };
  assertNoMissingAgentMcpInputs(server.name, missing);
  return endpoint;
}

function resolveRecord(
  values: Readonly<Record<string, Parameters<typeof resolveAgentMcpValueExpression>[1]>> | undefined,
  resolve: (expression: Parameters<typeof resolveAgentMcpValueExpression>[1]) => string,
): Record<string, string> | undefined {
  return values ? Object.fromEntries(Object.entries(values).map(([name, value]) => [name, resolve(value)])) : undefined;
}

function resolvePackagePath(packageRoot: string, configuredPath: string): string {
  const root = path.resolve(packageRoot);
  const candidate = path.resolve(root, configuredPath);
  if (isPathWithin(root, candidate)) return candidate;
  throw new Error(`MCP stdio cwd must remain inside its package: ${configuredPath}`);
}
