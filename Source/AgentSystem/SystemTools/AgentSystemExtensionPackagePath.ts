import fs from "node:fs";
import path from "node:path";
import { isPathWithin } from "../Core/AgentPath.js";

export function resolveSystemExtensionPackageFile(packageRoot: string, configuredPath: string, label: string): string {
  const resolved = resolvePackagePath(packageRoot, configuredPath, label);
  assertSystemExtensionRegularFile(resolved, label);
  return resolved;
}

export function resolveSystemExtensionPackageDirectory(
  packageRoot: string,
  configuredPath: string,
  label: string,
): string {
  const resolved = resolvePackagePath(packageRoot, configuredPath, label);
  assertSystemExtensionRegularDirectory(resolved, label);
  return resolved;
}

export function assertSystemExtensionRegularDirectory(directoryPath: string, label: string): void {
  const stat = fs.lstatSync(directoryPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a regular directory: ${directoryPath}`);
  }
}

export function assertSystemExtensionRegularFile(filePath: string, label: string): void {
  if (!fs.existsSync(filePath)) throw new Error(`${label} does not exist: ${filePath}`);
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file: ${filePath}`);
  }
}

function resolvePackagePath(packageRoot: string, configuredPath: string, label: string): string {
  if (path.isAbsolute(configuredPath)) throw new Error(`${label} path must be relative: ${configuredPath}`);
  const resolved = path.resolve(packageRoot, configuredPath);
  if (!isPathWithin(packageRoot, resolved) || resolved === path.resolve(packageRoot)) {
    throw new Error(`${label} path must remain inside its extension package: ${configuredPath}`);
  }
  return resolved;
}
