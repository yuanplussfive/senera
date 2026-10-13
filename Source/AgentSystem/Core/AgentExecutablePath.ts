import fs from "node:fs";
import path from "node:path";

/** Native binaries packaged by Electron live outside its archive. */
export function resolveAsarUnpackedExecutablePath(
  candidate: string,
  fileExists: (file: string) => boolean = fs.existsSync,
): string {
  const asarSegment = `${path.sep}app.asar${path.sep}`;
  const segmentIndex = candidate.indexOf(asarSegment);
  if (segmentIndex < 0) return candidate;
  const unpacked = `${candidate.slice(0, segmentIndex)}${path.sep}app.asar.unpacked${path.sep}${candidate.slice(segmentIndex + asarSegment.length)}`;
  if (!fileExists(unpacked)) throw new Error(`Packaged native resource is missing: ${unpacked}`);
  return unpacked;
}
