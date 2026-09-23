import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { discoverAgentSystemExtensionPackages } from "../../../Source/AgentSystem/SystemTools/AgentSystemExtensionDiscovery.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

describe("System extension domain discovery", () => {
  test("recursively discovers packages owned by one declared domain", () => {
    const root = createTemporaryDirectory("senera-extension-discovery-nested");
    try {
      const domainRoot = writeDomain(root, "explore");
      const packageRoot = writePackage(domainRoot, ["workspace", "workspace-tools"], "workspace-tools", "explore");

      expect(discoverAgentSystemExtensionPackages(root)).toEqual([
        expect.objectContaining({
          domain: expect.objectContaining({ id: "explore" }),
          packageRoot,
          manifest: expect.objectContaining({ id: "workspace-tools", domain: "explore" }),
        }),
      ]);
    } finally {
      removeDirectory(root);
    }
  });

  test("rejects package declarations that disagree with their domain directory", () => {
    const root = createTemporaryDirectory("senera-extension-discovery-domain-mismatch");
    try {
      const domainRoot = writeDomain(root, "explore");
      writePackage(domainRoot, ["workspace-tools"], "workspace-tools", "knowledge");

      expect(() => discoverAgentSystemExtensionPackages(root)).toThrow(
        /declares domain 'knowledge' but is located in domain 'explore'/u,
      );
    } finally {
      removeDirectory(root);
    }
  });

  test("rejects duplicate domain and extension identities", () => {
    const duplicateDomainRoot = createTemporaryDirectory("senera-extension-discovery-duplicate-domain");
    try {
      writeDomain(duplicateDomainRoot, "first", "shared");
      writeDomain(duplicateDomainRoot, "second", "shared");
      expect(() => discoverAgentSystemExtensionPackages(duplicateDomainRoot)).toThrow(
        /Duplicate System extension domain id 'shared'/u,
      );
    } finally {
      removeDirectory(duplicateDomainRoot);
    }

    const duplicatePackageRoot = createTemporaryDirectory("senera-extension-discovery-duplicate-package");
    try {
      const first = writeDomain(duplicatePackageRoot, "first");
      const second = writeDomain(duplicatePackageRoot, "second");
      writePackage(first, ["shared"], "shared", "first");
      writePackage(second, ["shared"], "shared", "second");
      expect(() => discoverAgentSystemExtensionPackages(duplicatePackageRoot)).toThrow(
        /Duplicate System extension id 'shared'/u,
      );
    } finally {
      removeDirectory(duplicatePackageRoot);
    }
  });

  test("rejects nested domain roots so package ownership remains unambiguous", () => {
    const root = createTemporaryDirectory("senera-extension-discovery-nested-domain");
    try {
      const domainRoot = writeDomain(root, "explore");
      writeDomain(domainRoot, "nested");

      expect(() => discoverAgentSystemExtensionPackages(root)).toThrow(
        /Nested System extension domain is not allowed/u,
      );
    } finally {
      removeDirectory(root);
    }
  });
});

function writeDomain(root: string, directory: string, id = directory): string {
  const domainRoot = path.join(root, directory);
  fs.mkdirSync(domainRoot, { recursive: true });
  writeJson(path.join(domainRoot, "domain.json"), {
    schemaVersion: 1,
    id,
    displayName: localized(`${id} domain`),
    description: localized(`${id} System extension domain.`),
    presentation: presentation(id),
  });
  return domainRoot;
}

function writePackage(domainRoot: string, directoryParts: readonly string[], id: string, domain: string): string {
  const packageRoot = path.join(domainRoot, ...directoryParts);
  fs.mkdirSync(packageRoot, { recursive: true });
  writeJson(path.join(packageRoot, "extension.json"), {
    schemaVersion: 1,
    id,
    domain,
    settingsSurface: "system-tools",
    version: "1.0.0",
    displayName: localized(`${id} extension`),
    description: localized(`${id} extension description.`),
  });
  return packageRoot;
}

function presentation(id: string) {
  return {
    category: id,
    icon: "tools",
    group: { id, title: localized(`${id} tools`) },
    activity: { action: localized(`Use ${id}`) },
  };
}

function localized(value: string) {
  return { "zh-CN": value, "en-US": value };
}

function writeJson(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
