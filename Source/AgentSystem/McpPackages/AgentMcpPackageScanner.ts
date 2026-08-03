import fs from "node:fs";
import path from "node:path";
import { z, ZodError } from "zod";
import { AgentJsonFileError, AgentJsonFileLoader } from "../Config/AgentJsonFileLoader.js";
import { agentDirectoryRevision } from "../Core/AgentDirectoryRevision.js";
import type { AgentSourceDiagnostic } from "../Diagnostics/AgentSourceDiagnostic.js";
import { AgentExtensionNameSchema } from "../Extensions/AgentExtensionIdentity.js";
import { AgentMcpBundleDescriptorAdapter } from "./AgentMcpBundleDescriptorAdapter.js";
import {
  AgentMcpDescriptorError,
  type AgentMcpDescriptorAdapter,
  type AgentMcpDescriptorProjection,
} from "./AgentMcpDescriptorAdapter.js";
import { AgentMcpLegacyDescriptorAdapter } from "./AgentMcpLegacyDescriptorAdapter.js";
import { AgentMcpRegistryDescriptorAdapter } from "./AgentMcpRegistryDescriptorAdapter.js";
import type { AgentMcpPackage, AgentMcpPackageSourceKind } from "./AgentMcpPackageTypes.js";
import { AgentMcpPackageValidationError } from "./AgentMcpPackageTypes.js";

const DescriptorAdapters: readonly AgentMcpDescriptorAdapter[] = [
  AgentMcpRegistryDescriptorAdapter,
  AgentMcpBundleDescriptorAdapter,
  AgentMcpLegacyDescriptorAdapter,
];

/** Discovers portable MCP descriptors and normalizes them without taking a first matching route. */
export class AgentMcpPackageScanner {
  private readonly json = new AgentJsonFileLoader();

  scanRoot(
    rootPath: string,
    source: AgentMcpPackageSourceKind,
    options: { excludeNames?: ReadonlySet<string> } = {},
  ): AgentMcpPackage[] {
    const root = path.resolve(rootPath);
    if (!fs.existsSync(root)) return [];
    assertRegularDirectory(root, "MCP package collection");
    const packages = fs
      .readdirSync(root, { withFileTypes: true })
      .filter(
        (entry) =>
          !entry.name.startsWith(".") &&
          !options.excludeNames?.has(entry.name) &&
          entry.isDirectory() &&
          !entry.isSymbolicLink(),
      )
      .sort((left, right) => left.name.localeCompare(right.name))
      .flatMap((entry) => {
        const packageRoot = path.join(root, entry.name);
        const descriptor = this.readDescriptor(packageRoot, source, entry.name, false);
        return descriptor ? [descriptor] : [];
      });
    assertUniqueServerNames(packages);
    return packages;
  }

  readPackage(
    packageRoot: string,
    source: AgentMcpPackageSourceKind,
    directoryName = path.basename(packageRoot),
  ): AgentMcpPackage {
    const package_ = this.readDescriptor(packageRoot, source, directoryName, true);
    if (!package_) throw validationError("MCP package does not contain a supported descriptor.", packageRoot);
    return package_;
  }

  static sourceRevision(rootPath: string): string {
    return agentDirectoryRevision(rootPath);
  }

  private readDescriptor(
    packageRoot: string,
    source: AgentMcpPackageSourceKind,
    directoryName: string,
    required: boolean,
  ): AgentMcpPackage | undefined {
    const rootPath = path.resolve(packageRoot);
    assertRegularDirectory(rootPath, "MCP package");
    const nameResult = AgentExtensionNameSchema.safeParse(directoryName);
    if (!nameResult.success) {
      throw validationError(`MCP package directory ${directoryName} must use lowercase kebab-case.`, rootPath);
    }

    const candidates: Array<{
      adapter: AgentMcpDescriptorAdapter;
      descriptorPath: string;
      document: unknown;
    }> = [];
    for (const adapter of DescriptorAdapters) {
      const descriptorPath = path.join(rootPath, adapter.fileName);
      if (!fs.existsSync(descriptorPath)) continue;
      assertRegularFile(descriptorPath, `${adapter.kind} MCP descriptor`);
      const document = this.loadUnknown(descriptorPath);
      if (adapter.recognizes(document)) candidates.push({ adapter, descriptorPath, document });
    }
    if (candidates.length === 0) {
      if (required) throw validationError("MCP package does not contain a supported descriptor.", rootPath);
      return undefined;
    }
    if (candidates.length > 1) {
      const labels = candidates.map((candidate) => candidate.adapter.fileName).join(", ");
      throw validationError(
        `MCP package declares conflicting runnable descriptors: ${labels}. Keep exactly one portable descriptor.`,
        candidates[1]!.descriptorPath,
      );
    }

    const candidate = candidates[0]!;
    let projection: AgentMcpDescriptorProjection;
    try {
      projection = candidate.adapter.project(
        {
          packageRoot: rootPath,
          directoryName,
          source,
          descriptorPath: candidate.descriptorPath,
        },
        candidate.document,
      );
    } catch (error) {
      throw projectDescriptorFailure(error, candidate.descriptorPath);
    }
    return {
      rootPath,
      configurationPath: candidate.descriptorPath,
      revision: agentDirectoryRevision(rootPath),
      name: projection.name,
      source,
      descriptorKind: projection.descriptorKind,
      execution: projection.execution,
      servers: projection.servers,
    };
  }

  private loadUnknown(filePath: string): unknown {
    try {
      return this.json.load(filePath, z.unknown());
    } catch (error) {
      if (!(error instanceof AgentJsonFileError)) throw error;
      throw new AgentMcpPackageValidationError(error.message, error.diagnostics.map(toMcpDiagnostic));
    }
  }
}

export function assertUniqueAgentMcpServerNames(packages: readonly AgentMcpPackage[]): void {
  assertUniqueServerNames(packages);
}

function assertUniqueServerNames(packages: readonly AgentMcpPackage[]): void {
  const declarations = new Map<string, string>();
  for (const package_ of packages) {
    for (const server of package_.servers) {
      const first = declarations.get(server.name);
      if (first) {
        throw validationError(
          `MCP server ${server.name} is already declared by ${first}.`,
          package_.configurationPath,
          ["servers", server.name],
        );
      }
      declarations.set(server.name, package_.configurationPath);
    }
  }
}

function projectDescriptorFailure(error: unknown, filePath: string): AgentMcpPackageValidationError {
  if (error instanceof AgentMcpPackageValidationError) return error;
  if (error instanceof ZodError) {
    return new AgentMcpPackageValidationError(
      `Invalid MCP descriptor: ${filePath}`,
      error.issues.map((issue) => ({
        severity: "error",
        code: "mcp.package.configuration",
        message: issue.message,
        filePath,
        pointer: issue.path.length > 0 ? `/${issue.path.map(escapePointerToken).join("/")}` : undefined,
        path: issue.path.map(String),
      })),
    );
  }
  if (error instanceof AgentMcpDescriptorError) {
    return validationError(error.message, filePath, error.path.map(String));
  }
  return validationError(error instanceof Error ? error.message : String(error), filePath);
}

function assertRegularDirectory(directoryPath: string, label: string): void {
  const stat = fs.lstatSync(directoryPath);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw validationError(`${label} must be a regular directory.`, directoryPath);
}

function assertRegularFile(filePath: string, label: string): void {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw validationError(`${label} must be a regular file.`, filePath);
}

function validationError(
  message: string,
  filePath: string,
  pathParts: readonly string[] = [],
): AgentMcpPackageValidationError {
  return new AgentMcpPackageValidationError(message, [
    {
      severity: "error",
      code: "mcp.package.configuration",
      message,
      filePath,
      pointer: pathParts.length > 0 ? `/${pathParts.map(escapePointerToken).join("/")}` : undefined,
      path: pathParts,
    },
  ]);
}

function toMcpDiagnostic(diagnostic: {
  filePath: string;
  message: string;
  pointer?: string;
  location?: AgentSourceDiagnostic["position"];
  frame?: AgentSourceDiagnostic["frame"];
}): AgentSourceDiagnostic {
  return {
    severity: "error",
    code: "mcp.package.configuration",
    message: diagnostic.message,
    filePath: diagnostic.filePath,
    pointer: diagnostic.pointer,
    position: diagnostic.location,
    frame: diagnostic.frame,
  };
}

function escapePointerToken(value: PropertyKey): string {
  return String(value).replaceAll("~", "~0").replaceAll("/", "~1");
}
