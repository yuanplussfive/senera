import fs from "node:fs";
import path from "node:path";
import {
  AgentRuntimeVersionMarkerSchema,
  AgentUpgradeManifestSchema,
  type AgentRuntimeVersionMarker,
  type AgentUpgradeManifest,
} from "./AgentUpgradeContract.js";
import { writeFileAtomicSync } from "../Core/AgentFs.js";
import { parseJsonText } from "../Core/AgentJsonParsing.js";

const UpgradeDirectoryName = "upgrades";
const RuntimeMarkerFileName = "runtime.json";
const ManifestFileName = "manifest.json";

export class AgentUpgradeJournal {
  readonly root: string;

  constructor(stateRoot: string) {
    this.root = path.resolve(stateRoot, UpgradeDirectoryName);
  }

  operationRoot(upgradeId: string): string {
    return resolveInside(this.root, upgradeId);
  }

  manifestPath(upgradeId: string): string {
    return path.join(this.operationRoot(upgradeId), ManifestFileName);
  }

  readRuntimeMarker(): AgentRuntimeVersionMarker | undefined {
    const markerPath = path.join(this.root, RuntimeMarkerFileName);
    if (!fs.existsSync(markerPath)) return undefined;
    return AgentRuntimeVersionMarkerSchema.parse(
      parseJsonText(fs.readFileSync(markerPath, "utf8"), "Runtime version marker"),
    );
  }

  writeRuntimeMarker(marker: AgentRuntimeVersionMarker): void {
    writePrivateJson(path.join(this.root, RuntimeMarkerFileName), AgentRuntimeVersionMarkerSchema.parse(marker));
  }

  clearRuntimeMarker(): void {
    fs.rmSync(path.join(this.root, RuntimeMarkerFileName), { force: true });
  }

  listManifests(): AgentUpgradeManifest[] {
    if (!fs.existsSync(this.root)) return [];
    return fs
      .readdirSync(this.root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        const manifestPath = this.manifestPath(entry.name);
        return fs.existsSync(manifestPath) ? [this.readManifest(entry.name)] : [];
      })
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  }

  readManifest(upgradeId: string): AgentUpgradeManifest {
    return AgentUpgradeManifestSchema.parse(
      parseJsonText(fs.readFileSync(this.manifestPath(upgradeId), "utf8"), "Upgrade manifest"),
    );
  }

  writeManifest(manifest: AgentUpgradeManifest): void {
    writePrivateJson(this.manifestPath(manifest.upgradeId), AgentUpgradeManifestSchema.parse(manifest));
  }

  pruneCompleted(retain: number): void {
    if (!Number.isSafeInteger(retain) || retain < 1) throw new RangeError("Upgrade retention must be positive.");
    const completed = this.listManifests().filter(({ status }) => status === "healthy");
    for (const manifest of completed.slice(0, Math.max(0, completed.length - retain))) {
      const operationRoot = this.operationRoot(manifest.upgradeId);
      assertInside(this.root, operationRoot, "Upgrade operation");
      fs.rmSync(operationRoot, { recursive: true, force: true });
    }
  }
}

export function writePrivateJson(filePath: string, value: unknown): void {
  writeFileAtomicSync(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    directoryMode: 0o700,
    mode: 0o600,
  });
}

export function resolveInside(root: string, ...segments: string[]): string {
  const candidate = path.resolve(root, ...segments);
  assertInside(root, candidate, "Path");
  return candidate;
}

export function assertInside(root: string, candidate: string, label: string): void {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} is outside its allowed root: ${candidate}`);
  }
}
