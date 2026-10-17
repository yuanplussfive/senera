import fs from "node:fs";
import path from "node:path";
import { AgentJsonFileLoader } from "../Config/AgentJsonFileLoader.js";
import {
  AgentSystemExtensionDomainManifestFileName,
  AgentSystemExtensionDomainManifestSchema,
  type AgentSystemExtensionDomainManifest,
} from "./AgentSystemExtensionDomain.js";
import {
  AgentSystemExtensionManifestFileName,
  AgentSystemExtensionManifestSchema,
  type AgentSystemExtensionManifest,
} from "./AgentSystemExtensionManifest.js";
import {
  assertSystemExtensionRegularDirectory,
  assertSystemExtensionRegularFile,
} from "./AgentSystemExtensionPackagePath.js";

export interface AgentSystemExtensionPackageSource {
  readonly domain: AgentSystemExtensionDomainManifest;
  readonly domainRoot: string;
  readonly packageRoot: string;
  readonly manifestPath: string;
  readonly manifest: AgentSystemExtensionManifest;
}

/**
 * Discovers packages below explicit domain directories. Directory hierarchy is
 * intentionally only an ownership structure: each package also declares the
 * domain identity it belongs to, and the two declarations must agree.
 */
export function discoverAgentSystemExtensionPackages(rootPath: string): readonly AgentSystemExtensionPackageSource[] {
  const root = path.resolve(rootPath);
  if (!fs.existsSync(root)) return [];
  assertSystemExtensionRegularDirectory(root, "System extension collection");

  const loader = new AgentJsonFileLoader();
  const domains = new Map<string, string>();
  const packages: AgentSystemExtensionPackageSource[] = [];
  const packageIds = new Map<string, string>();

  for (const entry of readDirectories(root, "System extension collection")) {
    const domainRoot = path.join(root, entry.name);
    const domainPath = path.join(domainRoot, AgentSystemExtensionDomainManifestFileName);
    assertSystemExtensionRegularFile(domainPath, `System extension domain '${entry.name}' manifest`);
    const domain = loader.load(domainPath, AgentSystemExtensionDomainManifestSchema);
    const existingDomainPath = domains.get(domain.id);
    if (existingDomainPath) {
      throw new Error(`Duplicate System extension domain id '${domain.id}': ${existingDomainPath} and ${domainRoot}.`);
    }
    domains.set(domain.id, domainRoot);
    discoverDomainPackages({ root, domainRoot, domain, loader, packages, packageIds });
  }

  return packages.sort((left, right) => left.manifest.id.localeCompare(right.manifest.id));
}

function discoverDomainPackages({
  root,
  domainRoot,
  domain,
  loader,
  packages,
  packageIds,
}: {
  readonly root: string;
  readonly domainRoot: string;
  readonly domain: AgentSystemExtensionDomainManifest;
  readonly loader: AgentJsonFileLoader;
  readonly packages: AgentSystemExtensionPackageSource[];
  readonly packageIds: Map<string, string>;
}): void {
  const visit = (directory: string): void => {
    for (const entry of readDirectories(directory, `System extension domain '${domain.id}'`)) {
      const candidateRoot = path.join(directory, entry.name);
      if (fs.existsSync(path.join(candidateRoot, AgentSystemExtensionDomainManifestFileName))) {
        throw new Error(`Nested System extension domain is not allowed: ${candidateRoot}.`);
      }
      const manifestPath = path.join(candidateRoot, AgentSystemExtensionManifestFileName);
      if (!fs.existsSync(manifestPath)) {
        visit(candidateRoot);
        continue;
      }

      assertSystemExtensionRegularFile(manifestPath, `System extension package '${entry.name}' manifest`);
      const manifest = loader.load(manifestPath, AgentSystemExtensionManifestSchema);
      if (manifest.id !== entry.name) {
        throw new Error(
          `System extension id '${manifest.id}' must match its package directory '${entry.name}' at ${candidateRoot}.`,
        );
      }
      if (manifest.domain !== domain.id) {
        throw new Error(
          `System extension '${manifest.id}' declares domain '${manifest.domain}' but is located in domain '${domain.id}'.`,
        );
      }
      const existingPackagePath = packageIds.get(manifest.id);
      if (existingPackagePath) {
        throw new Error(`Duplicate System extension id '${manifest.id}': ${existingPackagePath} and ${candidateRoot}.`);
      }
      packageIds.set(manifest.id, candidateRoot);
      packages.push({ domain, domainRoot, packageRoot: candidateRoot, manifestPath, manifest });
    }
  };

  // A domain cannot be its own collection root. The ordinary caller passes
  // System/Extensions, while this guard keeps the recursive API unambiguous.
  if (path.resolve(root) === path.resolve(domainRoot)) {
    throw new Error("System extension domain cannot be the extension root.");
  }
  visit(domainRoot);
}

function readDirectories(directory: string, label: string): fs.Dirent[] {
  assertSystemExtensionRegularDirectory(directory, label);
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      if (entry.name.startsWith(".")) return [];
      const entryPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`${label} cannot contain symbolic links: ${entryPath}`);
      }
      return entry.isDirectory() ? [entry] : [];
    });
}
